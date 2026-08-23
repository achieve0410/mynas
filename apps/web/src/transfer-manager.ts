import { ApiError } from "./api";
import { TransferLedger } from "./transfer-ledger";
import type {
  TransferBatchNotification,
  TransferBatchOptions,
  TransferManagerOptions,
  TransferRequest,
  TransferSnapshot,
} from "./transfer-types";

export type {
  TransferBatchNotification,
  TransferBatchOptions,
  TransferBatchSummary,
  TransferExecution,
  TransferKind,
  TransferManagerOptions,
  TransferNotificationItem,
  TransferNotificationSummary,
  TransferOperation,
  TransferOutcome,
  TransferRequest,
  TransferSnapshot,
  TransferStatus,
  TransferTask,
} from "./transfer-types";

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Transfer failed";

export class TransferManager {
  private active = 0;
  private readonly controllers = new Map<string, AbortController>();
  private disposed = false;
  private readonly ledger = new TransferLedger();
  private readonly listeners = new Set<() => void>();
  private readonly notificationErrors = new Map<string, string>();
  private readonly pendingNotifications = new Map<string, TransferBatchNotification>();
  private readonly requests = new Map<string, TransferRequest>();
  private snapshot: TransferSnapshot = { batches: [], notificationErrors: [], tasks: [] };

  public constructor(private readonly options: TransferManagerOptions) {
    if (!Number.isInteger(options.concurrency ?? 3) || (options.concurrency ?? 3) < 1) {
      throw new Error("transfer concurrency must be a positive integer");
    }
  }

  public readonly getSnapshot = (): TransferSnapshot => this.snapshot;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public clearFinished(): void {
    this.ledger.clearFinished(
      new Set([...this.pendingNotifications.keys(), ...this.notificationErrors.keys()]),
    );
    this.publish();
  }

  public dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
    this.listeners.clear();
  }

  public enqueueBatch(
    requests: readonly TransferRequest[],
    options: TransferBatchOptions = {},
  ): string | null {
    if (requests.length === 0) {
      return null;
    }
    if (this.disposed) {
      throw new Error("transfer manager is disposed");
    }
    const first = requests[0];
    if (
      first === undefined ||
      requests.some(
        (request) => request.operation !== first.operation || request.kind !== first.kind,
      )
    ) {
      throw new Error("one transfer batch must use one operation and kind");
    }
    const added = this.ledger.addBatch(requests, options);
    for (const { id, request } of added.transfers) {
      this.requests.set(id, request);
    }
    this.publish();
    this.pump();
    return added.batchId;
  }

  public resume(): void {
    if (this.disposed) {
      return;
    }
    if (this.ledger.resume()) {
      this.publish();
      this.pump();
    }
    this.retryNotifications();
  }

  public retryNotifications(): void {
    for (const [batchId, notification] of this.pendingNotifications) {
      void this.deliverNotification(batchId, notification);
    }
  }

  private async deliverNotification(
    batchId: string,
    notification: TransferBatchNotification,
  ): Promise<void> {
    try {
      await this.options.notify(notification);
      this.pendingNotifications.delete(batchId);
      this.notificationErrors.delete(batchId);
    } catch (cause) {
      this.notificationErrors.set(
        batchId,
        cause instanceof Error ? cause.message : "Transfer notification failed",
      );
    }
    this.publish();
  }

  private finishBatch(batchId: string): void {
    const settled = this.ledger.settle(batchId);
    if (settled === null) {
      return;
    }
    try {
      settled.onSettled?.();
    } catch (cause) {
      this.notificationErrors.set(
        `${batchId}:settled`,
        cause instanceof Error ? cause.message : "Transfer follow-up failed",
      );
    }
    this.pendingNotifications.set(batchId, settled.notification);
    void this.deliverNotification(batchId, settled.notification);
  }

  private publish(): void {
    this.snapshot = this.ledger.snapshot(this.controllers.keys(), [
      ...this.notificationErrors.values(),
    ]);
    for (const listener of this.listeners) {
      listener();
    }
  }

  private pump(): void {
    const concurrency = this.options.concurrency ?? 3;
    while (!this.disposed && this.active < concurrency) {
      const id = this.ledger.takeReadyId();
      if (id === undefined) {
        return;
      }
      void this.start(id);
    }
  }

  private async start(id: string): Promise<void> {
    const request = this.requests.get(id);
    if (request === undefined || this.ledger.getTask(id)?.status !== "queued") {
      return;
    }
    this.active += 1;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.ledger.transition(id, "transferring");
    this.publish();
    try {
      await request.execute({
        onProgress: (progress) => {
          if (this.ledger.updateProgress(id, progress)) {
            this.publish();
          }
        },
        signal: controller.signal,
      });
      const task = this.ledger.getTask(id);
      this.ledger.transition(id, "complete", {
        loaded: task?.total ?? task?.loaded ?? 0,
        percent: 100,
      });
      this.requests.delete(id);
    } catch (cause) {
      const pause =
        cause instanceof ApiError &&
        cause.status === 0 &&
        (this.options.shouldPauseNetworkFailure?.() ??
          (!navigator.onLine || document.visibilityState === "hidden"));
      this.ledger.transition(id, pause ? "paused" : "failed", {
        error: errorMessage(cause),
      });
      if (!pause) {
        this.requests.delete(id);
      }
    } finally {
      this.active -= 1;
      this.controllers.delete(id);
      const batchId = this.ledger.getTask(id)?.batchId;
      if (batchId !== undefined) {
        this.finishBatch(batchId);
      }
      this.publish();
      this.pump();
    }
  }
}
