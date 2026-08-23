import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "../../database/src/migrations";
import { ProtectionIncidentStore } from "./incidents";
import { MaintenanceCoordinator } from "./maintenance";
import { MaintenanceRepository } from "./repository";

describe("MaintenanceCoordinator", () => {
  let backupDirectory: string;
  let database: Database;
  let dataDir: string;
  let incidents: ProtectionIncidentStore;
  let repository: MaintenanceRepository;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-maintenance-coordinator-"));
    dataDir = join(root, "data");
    backupDirectory = join(root, "backups");
    await Promise.all([mkdir(dataDir), mkdir(backupDirectory)]);
    database = new Database(":memory:");
    migrate(database);
    repository = new MaintenanceRepository(database, () => new Date("2026-08-11T10:00:00.000Z"));
    incidents = new ProtectionIncidentStore(database, () => new Date("2026-08-11T10:00:00.000Z"));
  });

  afterEach(async () => {
    database.close();
    await rm(root, { force: true, recursive: true });
  });

  test("refuses overlap while preserving the first exact run", async () => {
    let releaseBackup: (() => void) | undefined;
    let reportBackupStarted: (() => void) | undefined;
    const backupStarted = new Promise<void>((resolve) => {
      reportBackupStarted = resolve;
    });
    const backupReleased = new Promise<void>((resolve) => {
      releaseBackup = resolve;
    });
    const coordinator = new MaintenanceCoordinator({
      backup: async (outputPath) => {
        reportBackupStarted?.();
        await backupReleased;
        await writeFile(outputPath, "verified backup");
      },
      dataDir,
      incidents,
      now: () => new Date("2026-08-11T10:00:00.000Z"),
      repository,
      volumes: {
        listIds: () => [],
        scrub: async () => ({ healthy: 0, issues: [], unrecoverable: 0 }),
      },
    });
    await coordinator.savePolicy({
      backupDirectory,
      backupIntervalHours: 24,
      enabled: true,
      retentionCount: 2,
      scrubIntervalHours: 168,
    });

    const first = coordinator.runManual();
    await backupStarted;
    await expect(coordinator.runManual()).rejects.toEqual(
      expect.objectContaining({ code: "conflict" }),
    );
    const idle = coordinator.waitForIdle();
    releaseBackup?.();
    await idle;
    expect(repository.listRuns(10).map(({ status }) => status)).toEqual(["completed", "completed"]);
    expect((await first).runs.map(({ status }) => status)).toEqual(["completed", "completed"]);
    expect(repository.listRuns(10)).toHaveLength(2);
  });

  test("records independent backup and scrub failures without false completion", async () => {
    const coordinator = new MaintenanceCoordinator({
      backup: async () => {
        throw new Error("backup device unavailable");
      },
      dataDir,
      incidents,
      now: () => new Date("2026-08-11T10:00:00.000Z"),
      repository,
      volumes: {
        listIds: () => ["photos"],
        scrub: async () => {
          throw new Error("volume unavailable");
        },
      },
    });
    await coordinator.savePolicy({
      backupDirectory,
      backupIntervalHours: 24,
      enabled: true,
      retentionCount: 2,
      scrubIntervalHours: 168,
    });

    const batch = await coordinator.runManual();
    expect(batch.runs.map(({ error, kind, status }) => ({ error, kind, status }))).toEqual([
      {
        error: "backup device unavailable",
        kind: "catalog_backup",
        status: "failed",
      },
      {
        error: "one or more volume scrubs failed",
        kind: "volume_scrub",
        status: "failed",
      },
    ]);
    expect(repository.listRuns(10).every(({ status }) => status === "failed")).toBe(true);
    expect(
      incidents.list("active", 10).map(({ kind, occurrenceCount, resourceKey }) => ({
        kind,
        occurrenceCount,
        resourceKey,
      })),
    ).toEqual([
      {
        kind: "volume_scrub_failed",
        occurrenceCount: 1,
        resourceKey: "volume_scrub",
      },
      {
        kind: "catalog_backup_failed",
        occurrenceCount: 1,
        resourceKey: "catalog_backup",
      },
    ]);
  });

  test("fails a backup when its destination is replaced during publication", async () => {
    const detached = join(root, "detached-backups");
    const coordinator = new MaintenanceCoordinator({
      backup: async (outputPath) => {
        await rename(backupDirectory, detached);
        await mkdir(backupDirectory);
        await writeFile(outputPath, "misdirected backup");
      },
      dataDir,
      incidents,
      repository,
      volumes: {
        listIds: () => [],
        scrub: async () => ({ healthy: 0, issues: [], unrecoverable: 0 }),
      },
    });
    await coordinator.savePolicy({
      backupDirectory,
      backupIntervalHours: 24,
      enabled: true,
      retentionCount: 2,
      scrubIntervalHours: 168,
    });

    const batch = await coordinator.runManual();
    expect(batch.runs.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: "catalog_backup", status: "failed" },
      { kind: "volume_scrub", status: "completed" },
    ]);
  });

  test("resolves only the matching incident after recovery", async () => {
    let backupAvailable = false;
    const coordinator = new MaintenanceCoordinator({
      backup: async (outputPath) => {
        if (!backupAvailable) {
          throw new Error("backup device unavailable");
        }
        await writeFile(outputPath, "verified backup");
      },
      dataDir,
      incidents,
      now: () => new Date("2026-08-11T10:00:00.000Z"),
      repository,
      volumes: {
        listIds: () => ["photos"],
        scrub: async () => {
          throw new Error("volume unavailable");
        },
      },
    });
    await coordinator.savePolicy({
      backupDirectory,
      backupIntervalHours: 24,
      enabled: true,
      retentionCount: 2,
      scrubIntervalHours: 168,
    });

    await coordinator.runManual();
    const backupIncident = incidents
      .list("active", 10)
      .find(({ kind }) => kind === "catalog_backup_failed");
    if (backupIncident === undefined) {
      throw new Error("backup incident was not opened");
    }
    backupAvailable = true;
    await coordinator.runScheduled(["catalog_backup"]);

    expect(incidents.list("active", 10).map(({ kind }) => kind)).toEqual(["volume_scrub_failed"]);
    expect(
      incidents.list("resolved", 10).find(({ kind }) => kind === "catalog_backup_failed"),
    ).toEqual({
      ...backupIncident,
      lastSeenAt: "2026-08-11T10:00:00.000Z",
      resolvedAt: "2026-08-11T10:00:00.000Z",
      status: "resolved",
    });
  });

  test("rolls back run completion when incident persistence fails", async () => {
    database.exec(`
      CREATE TRIGGER reject_normal_run_incident
      BEFORE INSERT ON protection_incidents
      BEGIN
        SELECT RAISE(ABORT, 'injected normal incident failure');
      END;
    `);
    const coordinator = new MaintenanceCoordinator({
      backup: async () => {
        throw new Error("backup device unavailable");
      },
      dataDir,
      incidents,
      now: () => new Date("2026-08-11T10:00:00.000Z"),
      repository,
      volumes: {
        listIds: () => [],
        scrub: async () => ({ healthy: 0, issues: [], unrecoverable: 0 }),
      },
    });
    await coordinator.savePolicy({
      backupDirectory,
      backupIntervalHours: 24,
      enabled: true,
      retentionCount: 2,
      scrubIntervalHours: 168,
    });

    await expect(coordinator.runScheduled(["catalog_backup"])).rejects.toThrow(
      "injected normal incident failure",
    );
    expect(repository.listRuns(1).map(({ status }) => status)).toEqual(["running"]);
    expect(incidents.list("active", 10)).toEqual([]);
  });
});
