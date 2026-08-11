import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  createMaintenanceApiFixture,
  type MaintenanceApiFixture,
  maintenanceBatchSchema,
  maintenanceSnapshotSchema,
} from "./maintenance-fixture";

describe("maintenance execution API", () => {
  let fixture: MaintenanceApiFixture;

  beforeEach(async () => {
    fixture = await createMaintenanceApiFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  test("backs up the live catalog, scrubs volumes, and records both results", async () => {
    const { app, authorized, root, savePolicy } = fixture;
    for (const id of ["disk-a", "disk-b"]) {
      const disk = join(root, id);
      await mkdir(disk);
      const backend = await app.request("/api/v1/backends", {
        body: JSON.stringify({ id, kind: "local", root: disk }),
        headers: authorized(),
        method: "POST",
      });
      expect(backend.status).toBe(201);
    }
    const volume = await app.request("/api/v1/volumes", {
      body: JSON.stringify({
        id: "photos",
        kind: "mirror",
        members: ["disk-a", "disk-b"],
      }),
      headers: authorized(),
      method: "POST",
    });
    expect(volume.status).toBe(201);
    const upload = await app.request("/api/v1/files/photos/documents/fixture.txt", {
      body: "maintenance fixture",
      headers: authorized(),
      method: "PUT",
    });
    expect(upload.status).toBe(201);
    await savePolicy();

    const triggered = await app.request("/api/v1/maintenance/run", {
      headers: authorized(),
      method: "POST",
    });
    expect(triggered.status).toBe(201);
    const batch = maintenanceBatchSchema.parse(await triggered.json());
    expect(batch.runs.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: "catalog_backup", status: "completed" },
      { kind: "volume_scrub", status: "completed" },
    ]);
    const backupPath = batch.runs[0]?.outputPath;
    if (backupPath === null || backupPath === undefined) {
      throw new Error("completed backup run must return its output path");
    }
    const backup = new Database(backupPath, { readonly: true, strict: true });
    try {
      expect(
        backup.query<{ readonly integrity_check: string }, []>("PRAGMA integrity_check").get(),
      ).toEqual({ integrity_check: "ok" });
      expect(
        backup.query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM users").get(),
      ).toEqual({ count: 1 });
      expect(
        backup.query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM files").get(),
      ).toEqual({ count: 1 });
    } finally {
      backup.close();
    }

    const snapshot = maintenanceSnapshotSchema.parse(
      await (
        await app.request("/api/v1/maintenance", {
          headers: authorized(),
        })
      ).json(),
    );
    expect(snapshot.runs).toHaveLength(2);
  });

  test("retains only the newest managed backups and preserves neighboring files", async () => {
    const { app, authorized, backupDirectory, savePolicy } = fixture;
    const neighbor = join(backupDirectory, "keep-me.sqlite");
    const foreign =
      "mynas-auto-00000000000000000000000000000000-20000101T000000000Z-00000000-0000-4000-8000-000000000000.sqlite";
    await writeFile(neighbor, "neighbor bytes");
    await writeFile(join(backupDirectory, foreign), "foreign backup");
    await savePolicy(2);

    for (let index = 0; index < 3; index += 1) {
      const response = await app.request("/api/v1/maintenance/run", {
        headers: authorized(),
        method: "POST",
      });
      expect(response.status).toBe(201);
      expect(
        maintenanceBatchSchema
          .parse(await response.json())
          .runs.every(({ status }) => status === "completed"),
      ).toBe(true);
    }

    const managedPattern =
      /^mynas-auto-[0-9a-f]{32}-\d{8}T\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.sqlite$/;
    const entries = await readdir(backupDirectory);
    expect(entries.filter((entry) => entry !== foreign && managedPattern.test(entry))).toHaveLength(
      2,
    );
    expect(await readFile(neighbor, "utf8")).toBe("neighbor bytes");
    expect(await readFile(join(backupDirectory, foreign), "utf8")).toBe("foreign backup");
  });

  test("keeps the current backup ahead of future-dated owned files", async () => {
    const { app, authorized, backupDirectory, savePolicy } = fixture;
    await savePolicy(1);
    const firstResponse = await app.request("/api/v1/maintenance/run", {
      headers: authorized(),
      method: "POST",
    });
    const first = maintenanceBatchSchema.parse(await firstResponse.json());
    const firstPath = first.runs.find(({ kind }) => kind === "catalog_backup")?.outputPath;
    if (firstPath === null || firstPath === undefined) {
      throw new Error("first backup path missing");
    }
    const owner = basename(firstPath).match(/^mynas-auto-([0-9a-f]{32})-/)?.[1];
    if (owner === undefined) {
      throw new Error("owned backup filename missing instance identity");
    }
    const future = join(
      backupDirectory,
      `mynas-auto-${owner}-20990101T000000000Z-00000000-0000-4000-8000-000000000000.sqlite`,
    );
    await writeFile(future, "future backup");

    const secondResponse = await app.request("/api/v1/maintenance/run", {
      headers: authorized(),
      method: "POST",
    });
    const second = maintenanceBatchSchema.parse(await secondResponse.json());
    const current = second.runs.find(({ kind }) => kind === "catalog_backup")?.outputPath;
    if (current === null || current === undefined) {
      throw new Error("current backup path missing");
    }
    expect((await stat(current)).isFile()).toBe(true);
    await expect(stat(future)).rejects.toBeInstanceOf(Error);
  });
});
