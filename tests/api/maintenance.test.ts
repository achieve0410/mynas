import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readdir, rename, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import {
  createMaintenanceApiFixture,
  type MaintenanceApiFixture,
  maintenanceBatchSchema,
  maintenancePolicySchema,
  maintenanceRunSchema,
  maintenanceSnapshotSchema,
} from "./maintenance-fixture";

describe("maintenance policy API", () => {
  let app: ReturnType<typeof createApp>;
  let authorized: () => Record<string, string>;
  let backupDirectory: string;
  let database: Database;
  let dataDir: string;
  let fixture: MaintenanceApiFixture;
  let root: string;
  let savePolicy: (retentionCount?: number) => Promise<void>;

  beforeEach(async () => {
    fixture = await createMaintenanceApiFixture();
    ({ app, authorized, backupDirectory, database, dataDir, root, savePolicy } = fixture);
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  test("persists an authenticated policy across app recreation", async () => {
    expect((await app.request("/api/v1/maintenance")).status).toBe(401);

    const policy = {
      backupDirectory,
      backupIntervalHours: 24,
      enabled: true,
      retentionCount: 2,
      scrubIntervalHours: 168,
    };
    const saved = await app.request("/api/v1/maintenance/policy", {
      body: JSON.stringify(policy),
      headers: authorized(),
      method: "PUT",
    });
    expect(saved.status).toBe(200);
    expect(maintenancePolicySchema.parse(await saved.json())).toMatchObject(policy);

    const restarted = createApp({ dataDir, database, environment: {} });
    const snapshot = await restarted.request("/api/v1/maintenance", {
      headers: authorized(),
    });
    expect(snapshot.status).toBe(200);
    expect(maintenanceSnapshotSchema.parse(await snapshot.json())).toMatchObject({
      policy,
      runs: [],
    });
  });

  test("rejects unsafe policy paths and out-of-range boundaries", async () => {
    const redirectedDirectory = join(root, "redirected-backups");
    await symlink(dataDir, redirectedDirectory);
    const valid = {
      backupDirectory,
      backupIntervalHours: 24,
      enabled: true,
      retentionCount: 2,
      scrubIntervalHours: 168,
    };
    for (const override of [
      { backupDirectory: "relative/backups" },
      { backupDirectory: dataDir },
      { backupDirectory: join(dataDir, "nested") },
      { backupDirectory: redirectedDirectory },
      { backupIntervalHours: 0 },
      { backupIntervalHours: 8_761 },
      { retentionCount: 0 },
      { retentionCount: 101 },
      { scrubIntervalHours: 0 },
      { scrubIntervalHours: 8_761 },
    ]) {
      const response = await app.request("/api/v1/maintenance/policy", {
        body: JSON.stringify({ ...valid, ...override }),
        headers: authorized(),
        method: "PUT",
      });
      expect(response.status, JSON.stringify(override)).toBe(400);
    }
  });

  test("preserves permissions on an existing backup directory", async () => {
    await chmod(backupDirectory, 0o750);
    await savePolicy();
    const response = await app.request("/api/v1/maintenance/run", {
      headers: authorized(),
      method: "POST",
    });
    expect(response.status).toBe(201);
    expect((await stat(backupDirectory)).mode & 0o777).toBe(0o750);
  });

  test("fails safely when the configured backup mount identity disappears", async () => {
    await savePolicy();
    const detached = join(root, "detached-backups");
    await rename(backupDirectory, detached);

    const resave = await app.request("/api/v1/maintenance/policy", {
      body: JSON.stringify({
        backupDirectory,
        backupIntervalHours: 24,
        enabled: true,
        retentionCount: 2,
        scrubIntervalHours: 168,
      }),
      headers: authorized(),
      method: "PUT",
    });
    expect(resave.status).toBe(400);

    const response = await app.request("/api/v1/maintenance/run", {
      headers: authorized(),
      method: "POST",
    });
    const batch = maintenanceBatchSchema.parse(await response.json());
    expect(batch.runs.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: "catalog_backup", status: "failed" },
      { kind: "volume_scrub", status: "completed" },
    ]);
    await expect(stat(backupDirectory)).rejects.toBeInstanceOf(Error);
  });

  test("reconciles an abandoned running record on application startup", async () => {
    const id = crypto.randomUUID();
    database
      .query(
        `INSERT INTO maintenance_runs
         (id, kind, trigger, status, started_at)
         VALUES (?, 'catalog_backup', 'scheduled', 'running', ?)`,
      )
      .run(id, "2026-08-11T10:00:00.000Z");

    const restarted = createApp({ dataDir, database, environment: {} });
    const response = await restarted.request("/api/v1/maintenance", {
      headers: authorized(),
    });
    const snapshot = z.object({ runs: z.array(maintenanceRunSchema) }).parse(await response.json());
    expect(snapshot.runs.find((run) => run.id === id)).toMatchObject({
      error: "maintenance interrupted before completion",
      status: "failed",
    });
  });

  test("rejects a previously initialized directory substituted for the destination", async () => {
    await savePolicy();
    const secondDirectory = join(root, "second-backups");
    await mkdir(secondDirectory);
    const changed = await app.request("/api/v1/maintenance/policy", {
      body: JSON.stringify({
        backupDirectory: secondDirectory,
        backupIntervalHours: 24,
        enabled: true,
        retentionCount: 2,
        scrubIntervalHours: 168,
      }),
      headers: authorized(),
      method: "PUT",
    });
    expect(changed.status).toBe(200);
    await rename(secondDirectory, join(root, "detached-second-backups"));
    await rename(backupDirectory, secondDirectory);

    const response = await app.request("/api/v1/maintenance/run", {
      headers: authorized(),
      method: "POST",
    });
    const batch = maintenanceBatchSchema.parse(await response.json());
    expect(batch.runs.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: "catalog_backup", status: "failed" },
      { kind: "volume_scrub", status: "completed" },
    ]);
  });

  test("rejects a destination identity marker symlink", async () => {
    await savePolicy();
    const marker = (await readdir(backupDirectory)).find((entry) =>
      entry.startsWith(".mynas-maintenance-"),
    );
    if (marker === undefined) {
      throw new Error("destination marker missing");
    }
    const markerPath = join(backupDirectory, marker);
    const movedMarker = join(root, "moved-destination-marker");
    await rename(markerPath, movedMarker);
    await symlink(movedMarker, markerPath);

    const response = await app.request("/api/v1/maintenance/run", {
      headers: authorized(),
      method: "POST",
    });
    const batch = maintenanceBatchSchema.parse(await response.json());
    expect(batch.runs.find(({ kind }) => kind === "catalog_backup")?.status).toBe("failed");
  });
});
