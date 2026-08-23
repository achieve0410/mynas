import type { TransferProgress } from "./transfer-api";
import {
  type AddedTransfer,
  isTerminalTransferStatus,
  type SettledTransferBatch,
  shouldPublishTransferProgress,
  TRANSFER_DETAIL_LIMIT,
  TRANSFER_RECENT_TASK_LIMIT,
  type TransferBatchOptions,
  type TransferBatchState,
  type TransferBatchSummary,
  type TransferRequest,
  type TransferSnapshot,
  type TransferStatus,
  type TransferTask,
  withoutTransferId,
} from "./transfer-types";

export class TransferLedger {
  private readonly batches = new Map<string, TransferBatchState>();
  private readonly lastPublishedLoaded = new Map<string, number>();
  private readonly pausedIds = new Set<string>();
  private queueHead = 0;
  private readonly readyIds: string[] = [];
  private recentPausedIds: string[] = [];
  private recentTerminalIds: string[] = [];
  private readonly tasks = new Map<string, TransferTask>();

  public addBatch(
    requests: readonly TransferRequest[],
    options: TransferBatchOptions,
  ): { readonly batchId: string; readonly transfers: readonly AddedTransfer[] } {
    const first = requests[0];
    if (first === undefined) {
      throw new Error("transfer batch is empty");
    }
    const batchId = crypto.randomUUID();
    this.batches.set(batchId, {
      bytes: 0,
      complete: 0,
      failed: 0,
      failureItems: [],
      id: batchId,
      kind: first.kind,
      onSettled: options.onSettled,
      operation: first.operation,
      paused: 0,
      queued: requests.length,
      settled: false,
      successItems: [],
      total: requests.length,
      transferring: 0,
    });
    const transfers = requests.map((request, index): AddedTransfer => {
      const id = `${batchId}:${index}:${request.id}`;
      this.tasks.set(id, {
        batchId,
        id,
        kind: request.kind,
        label: request.label,
        loaded: 0,
        operation: request.operation,
        path: request.path,
        percent: request.total === null ? null : 0,
        status: "queued",
        testId: request.testId ?? request.id,
        total: request.total,
      });
      this.readyIds.push(id);
      return { id, request };
    });
    return { batchId, transfers };
  }

  public clearFinished(blockedBatchIds: ReadonlySet<string>): void {
    for (const id of this.recentTerminalIds) {
      this.tasks.delete(id);
    }
    this.recentTerminalIds = [];
    for (const [id, batch] of this.batches) {
      if (batch.complete + batch.failed === batch.total && !blockedBatchIds.has(id)) {
        this.batches.delete(id);
      }
    }
  }

  public getTask(id: string): TransferTask | undefined {
    return this.tasks.get(id);
  }

  public resume(): boolean {
    if (this.pausedIds.size === 0) {
      return false;
    }
    for (const id of this.pausedIds) {
      const task = this.tasks.get(id);
      const batch = task === undefined ? undefined : this.batches.get(task.batchId);
      if (task === undefined || batch === undefined) {
        continue;
      }
      batch.paused -= 1;
      batch.queued += 1;
      this.tasks.set(id, { ...task, error: undefined, status: "queued" });
      this.readyIds.push(id);
    }
    this.pausedIds.clear();
    this.recentPausedIds = [];
    return true;
  }

  public settle(batchId: string): SettledTransferBatch | null {
    const batch = this.batches.get(batchId);
    if (batch === undefined || batch.settled || batch.complete + batch.failed !== batch.total) {
      return null;
    }
    batch.settled = true;
    return {
      notification: {
        items: [...batch.failureItems, ...batch.successItems].slice(0, TRANSFER_DETAIL_LIMIT),
        operation: batch.operation,
        summary: {
          bytes: batch.bytes,
          failed: batch.failed,
          succeeded: batch.complete,
          total: batch.total,
        },
      },
      onSettled: batch.onSettled,
    };
  }

  public snapshot(
    activeIds: Iterable<string>,
    notificationErrors: readonly string[],
  ): TransferSnapshot {
    const ids = [...activeIds, ...this.recentPausedIds, ...this.recentTerminalIds];
    return {
      batches: [...this.batches.values()].map(
        (batch): TransferBatchSummary => ({
          bytes: batch.bytes,
          complete: batch.complete,
          failed: batch.failed,
          id: batch.id,
          kind: batch.kind,
          operation: batch.operation,
          paused: batch.paused,
          queued: batch.queued,
          succeeded: batch.complete,
          total: batch.total,
          transferring: batch.transferring,
        }),
      ),
      notificationErrors,
      tasks: [...new Set(ids)].flatMap((id) => {
        const task = this.tasks.get(id);
        return task === undefined ? [] : [task];
      }),
    };
  }

  public takeReadyId(): string | undefined {
    while (this.queueHead < this.readyIds.length) {
      const id = this.readyIds[this.queueHead];
      this.queueHead += 1;
      if (id !== undefined && this.tasks.get(id)?.status === "queued") {
        return id;
      }
    }
    if (this.queueHead > 1_024) {
      this.readyIds.splice(0, this.queueHead);
      this.queueHead = 0;
    }
    return undefined;
  }

  public transition(
    id: string,
    status: TransferStatus,
    update: Partial<Pick<TransferTask, "error" | "loaded" | "percent">> = {},
  ): TransferTask | undefined {
    const current = this.tasks.get(id);
    const batch = current === undefined ? undefined : this.batches.get(current.batchId);
    if (current === undefined || batch === undefined || current.status === status) {
      return current;
    }
    batch[current.status] -= 1;
    batch[status] += 1;
    const task = { ...current, ...update, status };
    this.tasks.set(id, task);
    this.trackPause(id, status);
    if (isTerminalTransferStatus(status)) {
      this.lastPublishedLoaded.delete(id);
      this.recordResult(batch, task);
      const next = [id, ...withoutTransferId(this.recentTerminalIds, id)];
      for (const staleId of next.slice(TRANSFER_RECENT_TASK_LIMIT)) {
        this.tasks.delete(staleId);
      }
      this.recentTerminalIds = next.slice(0, TRANSFER_RECENT_TASK_LIMIT);
    }
    return task;
  }

  public updateProgress(id: string, progress: TransferProgress): boolean {
    const current = this.tasks.get(id);
    if (current === undefined) {
      return false;
    }
    this.tasks.set(id, { ...current, ...progress });
    const lastLoaded = this.lastPublishedLoaded.get(id) ?? 0;
    const publish = shouldPublishTransferProgress(current, progress, lastLoaded);
    if (publish) {
      this.lastPublishedLoaded.set(id, progress.loaded);
    }
    return publish;
  }

  private recordResult(batch: TransferBatchState, task: TransferTask): void {
    if (task.status === "complete") {
      batch.bytes += task.loaded;
      if (batch.successItems.length < TRANSFER_DETAIL_LIMIT) {
        batch.successItems.push({ bytes: task.loaded, outcome: "success", path: task.path });
      }
    } else if (batch.failureItems.length < TRANSFER_DETAIL_LIMIT) {
      batch.failureItems.push({
        outcome: "failure",
        path: task.path,
        reason: task.error ?? "Transfer failed",
      });
    }
  }

  private trackPause(id: string, status: TransferStatus): void {
    if (status === "paused") {
      this.pausedIds.add(id);
      this.recentPausedIds = [id, ...withoutTransferId(this.recentPausedIds, id)].slice(
        0,
        TRANSFER_RECENT_TASK_LIMIT,
      );
      return;
    }
    this.pausedIds.delete(id);
    this.recentPausedIds = withoutTransferId(this.recentPausedIds, id);
  }
}
