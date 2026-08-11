import { type MaintenanceCoordinator, MaintenanceError } from "./maintenance";
import type { MaintenanceKind, MaintenancePolicy, MaintenanceRepository } from "./repository";

const HOUR_MILLISECONDS = 60 * 60 * 1_000;
const MAX_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

export type MaintenanceTimerHandle = number | ReturnType<typeof setTimeout>;

export type MaintenanceTimer = {
  readonly clearTimer: (handle: MaintenanceTimerHandle) => void;
  readonly now: () => Date;
  readonly setTimer: (
    callback: () => Promise<void> | void,
    delayMilliseconds: number,
  ) => MaintenanceTimerHandle;
};

export type MaintenanceDue = {
  readonly backupAt: string | null;
  readonly scrubAt: string | null;
};

type MaintenanceSchedulerOptions = {
  readonly coordinator: MaintenanceCoordinator;
  readonly onError?: (error: unknown) => void;
  readonly repository: MaintenanceRepository;
  readonly timer?: MaintenanceTimer;
};

const systemTimer: MaintenanceTimer = {
  clearTimer: (handle) => {
    clearTimeout(handle);
  },
  now: () => new Date(),
  setTimer: (callback, delayMilliseconds) =>
    setTimeout(() => {
      void callback();
    }, delayMilliseconds),
};

const operationDueAt = (
  kind: MaintenanceKind,
  policy: MaintenancePolicy,
  repository: MaintenanceRepository,
): Date => {
  const lastFinished = repository.lastFinishedAt(kind);
  const base = Date.parse(lastFinished ?? policy.updatedAt);
  const hours = kind === "catalog_backup" ? policy.backupIntervalHours : policy.scrubIntervalHours;
  return new Date(base + hours * HOUR_MILLISECONDS);
};

const reportUnhandled = (error: unknown): void => {
  queueMicrotask(() => {
    throw error;
  });
};

export class MaintenanceScheduler {
  private readonly onError: (error: unknown) => void;
  private readonly timer: MaintenanceTimer;
  private handle: MaintenanceTimerHandle | null = null;
  private started = false;

  public constructor(private readonly options: MaintenanceSchedulerOptions) {
    this.onError = options.onError ?? reportUnhandled;
    this.timer = options.timer ?? systemTimer;
  }

  public nextDue(): MaintenanceDue {
    const policy = this.options.repository.getPolicy();
    if (policy === null || !policy.enabled) {
      return { backupAt: null, scrubAt: null };
    }
    return {
      backupAt: operationDueAt("catalog_backup", policy, this.options.repository).toISOString(),
      scrubAt: operationDueAt("volume_scrub", policy, this.options.repository).toISOString(),
    };
  }

  public refresh(): void {
    this.clear();
    if (!this.started) {
      return;
    }
    const due = this.nextDue();
    const timestamps = [due.backupAt, due.scrubAt]
      .filter((value): value is string => value !== null)
      .map(Date.parse);
    if (timestamps.length === 0) {
      return;
    }
    const nextTimestamp = Math.min(...timestamps);
    const delay = Math.min(
      MAX_TIMER_DELAY_MILLISECONDS,
      Math.max(0, nextTimestamp - this.timer.now().getTime()),
    );
    this.handle = this.timer.setTimer(() => this.fire(), delay);
  }

  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.refresh();
  }

  public stop(): void {
    this.started = false;
    this.clear();
  }

  private clear(): void {
    if (this.handle !== null) {
      this.timer.clearTimer(this.handle);
      this.handle = null;
    }
  }

  private async fire(): Promise<void> {
    this.handle = null;
    try {
      const policy = this.options.repository.getPolicy();
      if (policy === null || !policy.enabled) {
        return;
      }
      const now = this.timer.now().getTime();
      const kinds = (["catalog_backup", "volume_scrub"] as const).filter(
        (kind) => operationDueAt(kind, policy, this.options.repository).getTime() <= now,
      );
      if (kinds.length > 0) {
        await this.options.coordinator.runScheduled(kinds);
      }
    } catch (error) {
      if (error instanceof MaintenanceError && error.code === "conflict") {
        try {
          await this.options.coordinator.waitForIdle();
        } catch (idleError) {
          this.onError(idleError);
        }
      } else {
        this.onError(error);
      }
    } finally {
      this.refresh();
    }
  }
}
