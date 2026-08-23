import type {
  ActivityRepository,
  ActivityResource,
} from "../../../packages/activity/src/repository";

type ActivityError = Error & { readonly code?: unknown };
type ActivityRecorder = {
  readonly activity: ActivityRepository;
  readonly activityRecordError: (error: unknown) => void;
};

const safeError = (error: unknown): { readonly code: string; readonly message: string } => {
  if (!(error instanceof Error)) {
    return { code: "operation_failed", message: "operation failed" };
  }
  const coded = error as ActivityError;
  const code = typeof coded.code === "string" ? coded.code : "operation_failed";
  return {
    code,
    message:
      code === "operation_failed"
        ? "operation failed"
        : error.message.replace(/(?:\/[^/\s:"']+){2,}/g, "[local path]"),
  };
};

export const recordActivity = async <Result>(
  recorder: ActivityRecorder,
  action: string,
  resource: ActivityResource,
  operation: () => Promise<Result>,
): Promise<Result> => {
  let result: Result;
  try {
    result = await operation();
  } catch (error) {
    try {
      recorder.activity.record({
        action,
        error: safeError(error),
        outcome: "failure",
        resource,
      });
    } catch (recordError) {
      recorder.activityRecordError(recordError);
    }
    throw error;
  }
  try {
    recorder.activity.record({ action, outcome: "success", resource });
  } catch (error) {
    recorder.activityRecordError(error);
  }
  return result;
};
