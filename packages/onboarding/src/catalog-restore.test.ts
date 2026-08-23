import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthService } from "../../auth/src/auth";
import { migrate } from "../../database/src/migrations";
import { restoreCatalogWithOwner } from "./catalog-restore";

const temporaryRoots: string[] = [];

const createBackup = async (): Promise<{
  readonly apiToken: string;
  readonly backupPath: string;
  readonly ownerPassword: string;
  readonly root: string;
  readonly sessionToken: string;
}> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mynas-safe-restore-test-")));
  temporaryRoots.push(root);
  const sourceDirectory = join(root, "source");
  const sourcePath = join(sourceDirectory, "mynas.sqlite");
  const backupPath = join(root, "backup.sqlite");
  await mkdir(sourceDirectory);
  const database = new Database(sourcePath, { create: true });
  try {
    migrate(database);
    const ownerPassword = "original owner passphrase";
    const auth = new AuthService(database, () => new Date("2026-08-23T00:00:00.000Z"));
    const owner = await auth.setupOwner("owner", ownerPassword, "127.0.0.1");
    const sessionToken = (await auth.login("owner", ownerPassword, "127.0.0.1")).token;
    const apiToken = auth.createApiToken(owner.id, "restore test").token;
    database
      .query(
        `INSERT INTO storage_backends (id, kind, config_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run("disk-a", "local", '{"root":"/Volumes/DiskA"}', "2026-08-23T00:00:00.000Z");
    database
      .query(
        `INSERT INTO storage_volumes (id, kind, members_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run("archive", "mirror", '["disk-a","disk-b"]', "2026-08-23T00:00:00.000Z");
    database.query("VACUUM INTO ?").run(backupPath);
    return { apiToken, backupPath, ownerPassword, root, sessionToken };
  } finally {
    database.close();
  }
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("restoreCatalogWithOwner", () => {
  test("replaces restored credentials while preserving storage topology", async () => {
    const fixture = await createBackup();
    const dataDir = join(fixture.root, "restored");
    const replacementPassword = "replacement owner passphrase";

    await restoreCatalogWithOwner({
      dataDir,
      input: fixture.backupPath,
      password: replacementPassword,
      username: "replacement-owner",
    });

    const restored = new Database(join(dataDir, "mynas.sqlite"));
    try {
      const auth = new AuthService(restored);
      await expect(auth.verifyPassword("replacement-owner", replacementPassword)).resolves.toEqual(
        expect.objectContaining({ username: "replacement-owner" }),
      );
      await expect(auth.verifyPassword("owner", fixture.ownerPassword)).rejects.toThrow();
      expect(() => auth.authenticateSession(fixture.sessionToken)).toThrow();
      expect(() => auth.authenticateApiToken(fixture.apiToken)).toThrow();
      expect(restored.query("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({
        count: 0,
      });
      expect(restored.query("SELECT COUNT(*) AS count FROM api_tokens").get()).toEqual({
        count: 0,
      });
      expect(restored.query("SELECT id FROM storage_backends").get()).toEqual({
        id: "disk-a",
      });
      expect(restored.query("SELECT id FROM storage_volumes").get()).toEqual({
        id: "archive",
      });
    } finally {
      restored.close();
    }
  });

  test("rejects invalid replacement credentials without publishing a catalog", async () => {
    const fixture = await createBackup();
    const dataDir = join(fixture.root, "restored");

    await expect(
      restoreCatalogWithOwner({
        dataDir,
        input: fixture.backupPath,
        password: "too short",
        username: "replacement-owner",
      }),
    ).rejects.toThrow();
    expect(await Bun.file(join(dataDir, "mynas.sqlite")).exists()).toBe(false);
  });

  test("preserves an existing target catalog byte for byte", async () => {
    const fixture = await createBackup();
    const dataDir = join(fixture.root, "restored");
    const targetPath = join(dataDir, "mynas.sqlite");
    const sentinel = new TextEncoder().encode("existing catalog must survive");
    await mkdir(dataDir);
    await writeFile(targetPath, sentinel);

    await expect(
      restoreCatalogWithOwner({
        dataDir,
        input: fixture.backupPath,
        password: "replacement owner passphrase",
        username: "replacement-owner",
      }),
    ).rejects.toThrow("catalog already exists");
    expect(new Uint8Array(await readFile(targetPath))).toEqual(sentinel);
  });

  test("refuses orphan WAL artifacts without publishing a catalog", async () => {
    const fixture = await createBackup();
    const dataDir = join(fixture.root, "restored");
    const targetPath = join(dataDir, "mynas.sqlite");
    const walPath = `${targetPath}-wal`;
    const sentinel = new TextEncoder().encode("orphan wal must survive");
    await mkdir(dataDir);
    await writeFile(walPath, sentinel);

    await expect(
      restoreCatalogWithOwner({
        dataDir,
        input: fixture.backupPath,
        password: "replacement owner passphrase",
        username: "replacement-owner",
      }),
    ).rejects.toThrow("catalog already exists");
    expect(await Bun.file(targetPath).exists()).toBe(false);
    expect(new Uint8Array(await readFile(walPath))).toEqual(sentinel);
  });

  test("refuses dangling catalog sidecar symlinks without publication", async () => {
    const fixture = await createBackup();
    const dataDir = join(fixture.root, "restored");
    const targetPath = join(dataDir, "mynas.sqlite");
    const walPath = `${targetPath}-wal`;
    const linkTarget = join(fixture.root, "missing-wal-target");
    await mkdir(dataDir);
    await symlink(linkTarget, walPath);

    await expect(
      restoreCatalogWithOwner({
        dataDir,
        input: fixture.backupPath,
        password: "replacement owner passphrase",
        username: "replacement-owner",
      }),
    ).rejects.toThrow("catalog already exists");
    expect(await Bun.file(targetPath).exists()).toBe(false);
    expect(await readlink(walPath)).toBe(linkTarget);
  });

  test("refuses a symlinked destination directory without publication", async () => {
    const fixture = await createBackup();
    const redirectedDirectory = join(fixture.root, "redirected");
    const dataDir = join(fixture.root, "restored-link");
    await mkdir(redirectedDirectory);
    await symlink(redirectedDirectory, dataDir);

    await expect(
      restoreCatalogWithOwner({
        dataDir,
        input: fixture.backupPath,
        password: "replacement owner passphrase",
        username: "replacement-owner",
      }),
    ).rejects.toThrow();
    expect(await Bun.file(join(redirectedDirectory, "mynas.sqlite")).exists()).toBe(false);
    expect(await readlink(dataDir)).toBe(redirectedDirectory);
  });

  test("refuses a missing destination beneath a symlinked ancestor", async () => {
    const fixture = await createBackup();
    const redirectedDirectory = join(fixture.root, "redirected");
    const linkedAncestor = join(fixture.root, "linked-ancestor");
    const dataDir = join(linkedAncestor, "nested", "restored");
    await mkdir(redirectedDirectory);
    await symlink(redirectedDirectory, linkedAncestor);

    await expect(
      restoreCatalogWithOwner({
        dataDir,
        input: fixture.backupPath,
        password: "replacement owner passphrase",
        username: "replacement-owner",
      }),
    ).rejects.toThrow();
    expect(
      await Bun.file(join(redirectedDirectory, "nested", "restored", "mynas.sqlite")).exists(),
    ).toBe(false);
    expect(await readlink(linkedAncestor)).toBe(redirectedDirectory);
  });

  test("migrates a supported schema-six backup before credential replacement", async () => {
    const fixture = await createBackup();
    const backup = new Database(fixture.backupPath);
    try {
      backup.exec(`
        DROP TABLE snapshot_bundle_chunks;
        DROP TABLE snapshot_bundles;
        DROP TABLE activity_events;
        DROP TABLE protection_incidents;
        DELETE FROM schema_migrations WHERE version = 10;
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (6, '2026-08-23T00:00:00.000Z');
      `);
    } finally {
      backup.close();
    }
    const dataDir = join(fixture.root, "restored");

    await restoreCatalogWithOwner({
      dataDir,
      input: fixture.backupPath,
      password: "replacement owner passphrase",
      username: "replacement-owner",
    });

    const restored = new Database(join(dataDir, "mynas.sqlite"), { readonly: true });
    try {
      expect(
        restored
          .query<{ readonly version: number }, []>(
            "SELECT MAX(version) AS version FROM schema_migrations",
          )
          .get(),
      ).toEqual({ version: 10 });
      expect(
        restored
          .query<{ readonly name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'protection_incidents'",
          )
          .get(),
      ).toEqual({ name: "protection_incidents" });
    } finally {
      restored.close();
    }
  });
});
