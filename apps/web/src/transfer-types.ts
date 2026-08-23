import type { TransferProgress } from "./transfer-api";

export const TRANSFER_DETAIL_LIMIT = 100;
export const TRANSFER_RECENT_TASK_LIMIT = 20;
export const TRANSFER_UNKNOWN_PROGRESS_STEP = 256 * 1_024;

export type TransferKind = "file" | "photo";
export type TransferOperation = "download" | "upload";
export type TransferOutcome = "failure" | "success";
export type TransferStatus = "complete" | "failed" | "paused" | "queued" | "transferring";

export type TransferNotificationItem =
  | {
      readonly bytes: number;
      readonly outcome: "success";
      readonly path: string;
    }
  | {
      readonly outcome: "failure";
      readonly path: string;
      readonly reason: string;
    };

export type TransferNotificationSummary = {
  readonly bytes: number;
  readonly failed: number;
  readonly succeeded: number;
  readonly total: number;
};

export type TransferBatchNotification = {
  readonly items: readonly TransferNotificationItem[];
  readonly operation: TransferOperation;
  readonly summary: TransferNotificationSummary;
};

export type TransferTask = TransferProgress & {
  readonly batchId: string;
  readonly error?: string | undefined;
  readonly id: string;
  readonly kind: TransferKind;
  readonly label: string;
  readonly operation: TransferOperation;
  readonly path: string;
  readonly status: TransferStatus;
  readonly testId: string;
};

export type TransferBatchSummary = TransferNotificationSummary & {
  readonly complete: number;
  readonly id: string;
  readonly kind: TransferKind;
  readonly operation: TransferOperation;
  readonly paused: number;
  readonly queued: number;
  readonly transferring: number;
};

export type TransferExecution = {
  readonly onProgress: (progress: TransferProgress) => void;
  readonly signal: AbortSignal;
};

export type TransferRequest = {
  readonly execute: (execution: TransferExecution) => Promise<void>;
  readonly id: string;
  readonly kind: TransferKind;
  readonly label: string;
  readonly operation: TransferOperation;
  readonly path: string;
  readonly testId?: string | undefined;
  readonly total: number | null;
};

export type TransferBatchOptions = {
  readonly onSettled?: (() => void) | undefined;
};

export type TransferSnapshot = {
  readonly batches: readonly TransferBatchSummary[];
  readonly notificationErrors: readonly string[];
  readonly tasks: readonly TransferTask[];
};

export type TransferManagerOptions = {
  readonly concurrency?: number;
  readonly notify: (notification: TransferBatchNotification) => Promise<void>;
  readonly shouldPauseNetworkFailure?: () => boolean;
};

export type TransferBatchState = {
  bytes: number;
  complete: number;
  failed: number;
  readonly failureItems: TransferNotificationItem[];
  readonly id: string;
  readonly kind: TransferTask["kind"];
  readonly onSettled?: (() => void) | undefined;
  readonly operation: TransferTask["operation"];
  paused: number;
  queued: number;
  settled: boolean;
  readonly successItems: TransferNotificationItem[];
  readonly total: number;
  transferring: number;
};

export type AddedTransfer = {
  readonly id: string;
  readonly request: TransferRequest;
};

export type SettledTransferBatch = {
  readonly notification: TransferBatchNotification;
  readonly onSettled?: (() => void) | undefined;
};

export const isTerminalTransferStatus = (status: TransferStatus): boolean =>
  status === "complete" || status === "failed";

export const shouldPublishTransferProgress = (
  current: TransferTask,
  progress: TransferProgress,
  lastLoaded: number,
): boolean =>
  progress.percent !== current.percent ||
  progress.total !== current.total ||
  (progress.percent === null && progress.loaded - lastLoaded >= TRANSFER_UNKNOWN_PROGRESS_STEP);

export const withoutTransferId = (ids: readonly string[], id: string): string[] =>
  ids.filter((candidate) => candidate !== id);
