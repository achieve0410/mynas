import type { SnapshotNotifier } from "./notifications";
import type { SnapshotCreationResult } from "./producer";
import type { SnapshotRetentionResult } from "./retention";

type SnapshotWorkflowOptions<Context> = {
  readonly create: (context: Context) => Promise<SnapshotCreationResult>;
  readonly notifier: SnapshotNotifier;
  readonly prepare: () => Promise<Context>;
  readonly retain: (context: Context) => Promise<SnapshotRetentionResult>;
};

export type SnapshotWorkflowResult = SnapshotCreationResult & {
  readonly retention: SnapshotRetentionResult;
};

export class SnapshotWorkflowNotificationError extends Error {
  public override readonly name = "SnapshotWorkflowNotificationError";

  public constructor(
    public readonly operationError: Error,
    notificationError: Error,
  ) {
    super(`${operationError.message}; Slack failure notification also failed`, {
      cause: notificationError,
    });
  }
}

const normalizedError = (error: unknown): Error =>
  error instanceof Error ? error : new Error("snapshot operation failed");

const reportFailure = async (
  notifier: SnapshotNotifier,
  notification: Parameters<SnapshotNotifier["send"]>[0],
  error: unknown,
): Promise<never> => {
  const operationError = normalizedError(error);
  try {
    await notifier.send(notification);
  } catch (notificationError) {
    throw new SnapshotWorkflowNotificationError(operationError, normalizedError(notificationError));
  }
  throw operationError;
};

export const runSnapshotWorkflow = async <Context>(
  options: SnapshotWorkflowOptions<Context>,
): Promise<SnapshotWorkflowResult> => {
  let context: Context;
  let created: SnapshotCreationResult;
  try {
    context = await options.prepare();
    created = await options.create(context);
  } catch (error) {
    return reportFailure(
      options.notifier,
      { kind: "backup_failure", reason: normalizedError(error).message },
      error,
    );
  }
  let retention: SnapshotRetentionResult;
  try {
    retention = await options.retain(context);
  } catch (error) {
    return reportFailure(
      options.notifier,
      {
        bundleId: created.bundleId,
        kind: "retention_failure",
        reason: normalizedError(error).message,
      },
      error,
    );
  }
  await options.notifier.send({
    ...created,
    deletedCount: retention.deletedBundleIds.length,
    kind: "success",
    retainedCount: retention.retainedCount,
  });
  return { ...created, retention };
};
