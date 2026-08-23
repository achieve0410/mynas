import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { ActivityRepository } from "../../../packages/activity/src/repository";
import { migrate } from "../../../packages/database/src/migrations";

import { recordActivity } from "./activity";

const closedRecorder = () => {
  const database = new Database(":memory:");
  migrate(database);
  const activity = new ActivityRepository(database);
  database.close();
  const errors: unknown[] = [];
  return {
    errors,
    recorder: {
      activity,
      activityRecordError: (error: unknown) => errors.push(error),
    },
  };
};

describe("recordActivity", () => {
  test("returns a completed operation when success recording fails", async () => {
    const { errors, recorder } = closedRecorder();
    const result = await recordActivity(
      recorder,
      "file.download",
      { kind: "file", path: "report.txt" },
      async () => "completed",
    );
    expect(result).toBe("completed");
    expect(errors).toHaveLength(1);
  });

  test("preserves the operation error when failure recording also fails", async () => {
    const { errors, recorder } = closedRecorder();
    const operationError = new Error("transfer failed");
    await expect(
      recordActivity(recorder, "file.upload", { kind: "file", path: "report.txt" }, async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);
    expect(errors).toHaveLength(1);
  });
});
