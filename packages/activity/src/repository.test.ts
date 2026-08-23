import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { migrate } from "../../database/src/migrations";
import { ActivityRepository } from "./repository";

describe("ActivityRepository", () => {
  let database: Database;
  let repository: ActivityRepository;

  beforeEach(() => {
    database = new Database(":memory:");
    migrate(database);
    repository = new ActivityRepository(database, () => new Date("2026-08-14T01:02:03.000Z"));
  });

  afterEach(() => {
    database.close();
  });

  test("lists newest transfer outcomes with safe failure details", () => {
    repository.record({
      action: "file.upload",
      outcome: "success",
      resource: { kind: "file", path: "reports/quarterly.txt" },
    });
    repository.record({
      action: "photo.upload",
      error: { code: "invalid_photo", message: "unsupported photo format" },
      outcome: "failure",
      resource: { kind: "photo", path: "broken.txt" },
    });

    expect(repository.list()).toEqual([
      expect.objectContaining({
        action: "photo.upload",
        errorCode: "invalid_photo",
        errorMessage: "unsupported photo format",
        outcome: "failure",
        resource: { kind: "photo", path: "broken.txt" },
      }),
      expect.objectContaining({
        action: "file.upload",
        errorCode: null,
        errorMessage: null,
        outcome: "success",
        resource: { kind: "file", path: "reports/quarterly.txt" },
      }),
    ]);
  });

  test("keeps only the newest bounded history", () => {
    for (let index = 0; index < 1_005; index += 1) {
      repository.record({
        action: "file.download",
        outcome: "success",
        resource: { kind: "file", path: `files/${index}.txt` },
      });
    }

    const events = repository.list(1_000);
    expect(events).toHaveLength(1_000);
    expect(events[0]?.resource).toEqual({ kind: "file", path: "files/1004.txt" });
    expect(events.at(-1)?.resource).toEqual({ kind: "file", path: "files/5.txt" });
  });
});
