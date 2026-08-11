import { resolve } from "node:path";

import { ManagedBackupStore } from "./backups";
import {
  type MaintenanceKind,
  type MaintenancePolicy,
  type MaintenancePolicyInput,
  type MaintenanceRepository,
  type MaintenanceRun,
  type MaintenanceTrigger,
  maintenancePolicyInputSchema,
} from "./repository";

export type MaintenanceScrubReport = {
  readonly healthy: number;
  readonly issues: readonly unknown[];
  readonly unrecoverable: number;
};

export type MaintenanceBatch = {
  readonly runs: readonly MaintenanceRun[];
  readonly trigger: MaintenanceTrigger;
};

export type MaintenanceListener = (batch: MaintenanceBatch) => void;

type MaintenanceVolumes = {
  readonly listIds: () => readonly string[];
  readonly scrub: (id: string) => Promise<MaintenanceScrubReport>;
};

type MaintenanceCoordinatorOptions = {
  readonly backup: (outputPath: string) => Promise<void>;
  readonly dataDir: string;
  readonly now?: () => Date;
  readonly repository: MaintenanceRepository;
  readonly volumes: MaintenanceVolumes;
};

export type MaintenanceErrorCode = "conflict" | "invalid_policy" | "not_configured";

export class MaintenanceError extends Error {
  public constructor(
    public readonly code: MaintenanceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MaintenanceError";
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "maintenance operation failed";

export class MaintenanceCoordinator {
  private activeRun: Promise<MaintenanceBatch> | null = null;
  private readonly backups: ManagedBackupStore;
  private readonly listeners = new Set<MaintenanceListener>();
  private readonly now: () => Date;

  public constructor(private readonly options: MaintenanceCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.backups = new ManagedBackupStore(options.dataDir, options.repository.getOwnerId());
  }

  public getPolicy(): MaintenancePolicy | null {
    return this.options.repository.getPolicy();
  }

  public listRuns(limit = 50): readonly MaintenanceRun[] {
    return this.options.repository.listRuns(limit);
  }

  public runManual(): Promise<MaintenanceBatch> {
    return this.run(["catalog_backup", "volume_scrub"], "manual");
  }

  public runScheduled(kinds: readonly MaintenanceKind[]): Promise<MaintenanceBatch> {
    return this.run(kinds, "scheduled");
  }

  public async savePolicy(input: MaintenancePolicyInput): Promise<MaintenancePolicy> {
    const policy = maintenancePolicyInputSchema.parse(input);
    const backupDirectory = resolve(policy.backupDirectory);
    const existingPolicy = this.options.repository.getPolicy();
    const createMarker =
      existingPolicy === null || existingPolicy.backupDirectory !== backupDirectory;
    const destinationId = createMarker
      ? crypto.randomUUID().replaceAll("-", "")
      : existingPolicy.destinationId;
    try {
      await this.backups.prepare(policy.backupDirectory, destinationId, createMarker);
    } catch (error) {
      throw new MaintenanceError(
        "invalid_policy",
        "backup directory must be absolute, stable, and outside the data directory",
        { cause: error },
      );
    }
    return this.options.repository.savePolicy({ ...policy, backupDirectory }, destinationId);
  }

  public subscribe(listener: MaintenanceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async waitForIdle(): Promise<void> {
    await this.activeRun;
  }

  private async executeBackup(
    policy: MaintenancePolicy,
    trigger: MaintenanceTrigger,
  ): Promise<MaintenanceRun> {
    const started = this.options.repository.startRun("catalog_backup", trigger);
    const outputPath = this.backups.outputPath(policy.backupDirectory, this.now());
    try {
      await this.backups.verify(policy.backupDirectory, policy.destinationId);
      await this.options.backup(outputPath);
      await this.backups.verify(policy.backupDirectory, policy.destinationId);
      const removedBackups = await this.backups.prune(
        policy.backupDirectory,
        policy.retentionCount,
        outputPath,
      );
      await this.backups.verify(policy.backupDirectory, policy.destinationId);
      return this.options.repository.completeRun(started.id, {
        error: null,
        outputPath,
        status: "completed",
        summary: { removedBackups, retentionCount: policy.retentionCount },
      });
    } catch (error) {
      return this.options.repository.completeRun(started.id, {
        error: messageOf(error),
        outputPath: null,
        status: "failed",
        summary: null,
      });
    }
  }

  private async executeScrub(trigger: MaintenanceTrigger): Promise<MaintenanceRun> {
    const started = this.options.repository.startRun("volume_scrub", trigger);
    const volumes: Record<string, unknown>[] = [];
    let failed = false;
    for (const id of this.options.volumes.listIds()) {
      try {
        const report = await this.options.volumes.scrub(id);
        const unhealthy = report.issues.length > 0 || report.unrecoverable > 0;
        failed ||= unhealthy;
        volumes.push({ id, report, status: unhealthy ? "failed" : "completed" });
      } catch (error) {
        failed = true;
        volumes.push({ error: messageOf(error), id, status: "failed" });
      }
    }
    return this.options.repository.completeRun(started.id, {
      error: failed ? "one or more volume scrubs failed" : null,
      outputPath: null,
      status: failed ? "failed" : "completed",
      summary: { volumes },
    });
  }

  private run(
    kinds: readonly MaintenanceKind[],
    trigger: MaintenanceTrigger,
  ): Promise<MaintenanceBatch> {
    if (this.activeRun !== null) {
      return Promise.reject(new MaintenanceError("conflict", "maintenance is already running"));
    }
    const policy = this.options.repository.getPolicy();
    if (policy === null) {
      return Promise.reject(
        new MaintenanceError("not_configured", "maintenance policy is not configured"),
      );
    }
    const activeRun = this.executeRun(kinds, trigger, policy);
    this.activeRun = activeRun;
    return activeRun.finally(() => {
      if (this.activeRun === activeRun) {
        this.activeRun = null;
      }
    });
  }

  private async executeRun(
    kinds: readonly MaintenanceKind[],
    trigger: MaintenanceTrigger,
    policy: MaintenancePolicy,
  ): Promise<MaintenanceBatch> {
    const runs: MaintenanceRun[] = [];
    for (const kind of kinds) {
      runs.push(
        kind === "catalog_backup"
          ? await this.executeBackup(policy, trigger)
          : await this.executeScrub(trigger),
      );
    }
    const batch = { runs, trigger } satisfies MaintenanceBatch;
    for (const listener of this.listeners) {
      listener(batch);
    }
    return batch;
  }
}
