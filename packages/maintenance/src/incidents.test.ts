import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "../../database/src/migrations";
import { ProtectionIncidentStore } from "./incidents";

describe("protection incident persistence", () => {
  test("migrates a durable incident lifecycle table", () => {
    const database = new Database(":memory:");
    try {
      migrate(database);

      expect(
        database
          .query<{ readonly name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'protection_incidents'",
          )
          .get(),
      ).toEqual({ name: "protection_incidents" });
      expect(
        database
          .query<{ readonly name: string }, []>(
            "SELECT name FROM pragma_table_info('protection_incidents') ORDER BY cid",
          )
          .all()
          .map(({ name }) => name),
      ).toEqual([
        "sequence",
        "id",
        "kind",
        "resource_key",
        "first_seen_at",
        "last_seen_at",
        "occurrence_count",
        "resolved_at",
      ]);
    } finally {
      database.close();
    }
  });

  test("preserves stable failure identity and resolution across reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "mynas-incidents-"));
    const path = join(root, "catalog.sqlite");
    try {
      const firstDatabase = new Database(path, { create: true });
      migrate(firstDatabase);
      const firstStore = new ProtectionIncidentStore(
        firstDatabase,
        () => new Date("2026-08-23T00:00:00.000Z"),
      );
      const first = firstStore.record("catalog_backup_failed", "catalog_backup");
      firstDatabase.close();

      const secondDatabase = new Database(path);
      const secondStore = new ProtectionIncidentStore(
        secondDatabase,
        () => new Date("2026-08-23T01:00:00.000Z"),
      );
      const repeated = secondStore.record("catalog_backup_failed", "catalog_backup");
      expect(repeated).toEqual({
        firstSeenAt: "2026-08-23T00:00:00.000Z",
        id: first.id,
        kind: "catalog_backup_failed",
        lastSeenAt: "2026-08-23T01:00:00.000Z",
        occurrenceCount: 2,
        resolvedAt: null,
        resourceKey: "catalog_backup",
        status: "active",
      });

      const resolved = secondStore.resolve("catalog_backup_failed", "catalog_backup");
      if (resolved === null) {
        throw new Error("active incident was not resolved");
      }
      expect(resolved).toEqual({
        ...repeated,
        lastSeenAt: "2026-08-23T01:00:00.000Z",
        resolvedAt: "2026-08-23T01:00:00.000Z",
        status: "resolved",
      });
      expect(secondStore.list("resolved", 10)).toEqual([resolved]);
      expect(secondStore.list("active", 10)).toEqual([]);
      secondDatabase.close();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
