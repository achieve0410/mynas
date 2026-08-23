import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { AuthService } from "../../packages/auth/src/auth";
import { migrate } from "../../packages/database/src/migrations";

type CommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

type SeededCatalog = {
  readonly apiToken: string;
  readonly dataDir: string;
  readonly database: Database;
  readonly ownerPassword: string;
  readonly path: string;
  readonly sessionToken: string;
};

const repositoryRoot = resolve(import.meta.dir, "../..");
const temporaryRoots: string[] = [];

const createTemporaryRoot = async (): Promise<string> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mynas-catalog-test-")));
  temporaryRoots.push(root);
  return root;
};

const runMynas = async (arguments_: readonly string[], stdin = ""): Promise<CommandResult> => {
  const child = Bun.spawn(["bun", "run", "mynas", ...arguments_], {
    cwd: repositoryRoot,
    env: process.env,
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
  child.stdin.write(stdin);
  child.stdin.end();
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

const seedCatalog = async (root: string): Promise<SeededCatalog> => {
  const dataDir = join(root, "source");
  const path = join(dataDir, "mynas.sqlite");
  await mkdir(dataDir);
  const database = new Database(path, { create: true });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
  migrate(database);
  const ownerPassword = "original owner passphrase";
  const auth = new AuthService(database, () => new Date("2026-08-11T00:00:00.000Z"));
  const owner = await auth.setupOwner("owner", ownerPassword, "127.0.0.1");
  const sessionToken = (await auth.login("owner", ownerPassword, "127.0.0.1")).token;
  const apiToken = auth.createApiToken(owner.id, "restore regression").token;
  database
    .query(
      `INSERT INTO storage_backends (id, kind, config_json, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run("disk-a", "local", '{"root":"/Volumes/DiskA"}', "2026-08-11T00:00:00.000Z");
  database
    .query(
      `INSERT INTO storage_volumes (id, kind, members_json, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run("archive", "mirror", '["disk-a","disk-b"]', "2026-08-11T00:00:00.000Z");
  database
    .query(
      `INSERT INTO file_versions
       (id, volume_id, path, blob_checksum, blob_key, blob_size, tombstone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "version-id",
      "archive",
      "documents/proof.txt",
      "a".repeat(64),
      `blobs/${"a".repeat(64)}`,
      5,
      0,
      "2026-08-11T00:00:00.000Z",
    );
  database
    .query("INSERT INTO files (volume_id, path, current_version_id) VALUES (?, ?, ?)")
    .run("archive", "documents/proof.txt", "version-id");
  return { apiToken, dataDir, database, ownerPassword, path, sessionToken };
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("catalog backup and restore CLI", () => {
  test("catalog backup creates a consistent snapshot including WAL data", async () => {
    const root = await createTemporaryRoot();
    const source = await seedCatalog(root);
    const backupPath = join(root, "backup.sqlite");

    try {
      expect((await stat(`${source.path}-wal`)).size).toBeGreaterThan(0);

      const result = await runMynas([
        "catalog",
        "backup",
        "--data-dir",
        source.dataDir,
        "--output",
        backupPath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ integrity: "ok", path: backupPath });

      const backup = new Database(backupPath, { readonly: true });
      try {
        expect(backup.query("PRAGMA integrity_check").get()).toEqual({
          integrity_check: "ok",
        });
        expect(backup.query("SELECT username FROM users").get()).toEqual({
          username: "owner",
        });
        expect(backup.query("SELECT id FROM storage_backends").get()).toEqual({
          id: "disk-a",
        });
        expect(backup.query("SELECT path FROM files").get()).toEqual({
          path: "documents/proof.txt",
        });
      } finally {
        backup.close();
      }
    } finally {
      source.database.close();
    }
  });

  test("catalog restore replaces every backed-up owner credential", async () => {
    const root = await createTemporaryRoot();
    const source = await seedCatalog(root);
    const backupPath = join(root, "backup.sqlite");
    const restoredDataDir = join(root, "restored");
    const restoredPath = join(restoredDataDir, "mynas.sqlite");
    const replacementPassword = "replacement owner passphrase";

    try {
      source.database.query("VACUUM INTO ?").run(backupPath);

      const result = await runMynas(
        [
          "catalog",
          "restore",
          "--data-dir",
          restoredDataDir,
          "--input",
          backupPath,
          "--password-stdin",
          "--username",
          "replacement-owner",
        ],
        `${replacementPassword}\n`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain(replacementPassword);
      expect(result.stderr).not.toContain(replacementPassword);
      expect(JSON.parse(result.stdout)).toEqual({ integrity: "ok", path: restoredPath });

      const restored = new Database(restoredPath);
      try {
        expect(restored.query("PRAGMA integrity_check").get()).toEqual({
          integrity_check: "ok",
        });
        expect(restored.query("SELECT username FROM users").get()).toEqual({
          username: "replacement-owner",
        });
        expect(restored.query("SELECT path FROM files").get()).toEqual({
          path: "documents/proof.txt",
        });
        expect(restored.query("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({
          count: 0,
        });
        expect(restored.query("SELECT COUNT(*) AS count FROM api_tokens").get()).toEqual({
          count: 0,
        });
        const restoredAuth = new AuthService(restored);
        await expect(restoredAuth.verifyPassword("owner", source.ownerPassword)).rejects.toThrow();
        expect(() => restoredAuth.authenticateSession(source.sessionToken)).toThrow();
        expect(() => restoredAuth.authenticateApiToken(source.apiToken)).toThrow();
        await expect(
          restoredAuth.verifyPassword("replacement-owner", replacementPassword),
        ).resolves.toEqual(expect.objectContaining({ username: "replacement-owner" }));
      } finally {
        restored.close();
      }
    } finally {
      source.database.close();
    }
  });

  test("catalog restore rejects multiline replacement credentials without output", async () => {
    const root = await createTemporaryRoot();
    const source = await seedCatalog(root);
    const backupPath = join(root, "backup.sqlite");
    const restoredDataDir = join(root, "restored");
    const restoredPath = join(restoredDataDir, "mynas.sqlite");
    const multilinePassword = "replacement owner passphrase\nunexpected second line";

    try {
      source.database.query("VACUUM INTO ?").run(backupPath);
      const result = await runMynas(
        [
          "catalog",
          "restore",
          "--data-dir",
          restoredDataDir,
          "--input",
          backupPath,
          "--password-stdin",
        ],
        `${multilinePassword}\n`,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain(multilinePassword);
      expect(await Bun.file(restoredPath).exists()).toBe(false);
    } finally {
      source.database.close();
    }
  });

  test("catalog restore refuses to overwrite an existing catalog", async () => {
    const root = await createTemporaryRoot();
    const source = await seedCatalog(root);
    const backupPath = join(root, "backup.sqlite");
    const restoredDataDir = join(root, "restored");
    const restoredPath = join(restoredDataDir, "mynas.sqlite");
    const sentinel = new TextEncoder().encode("existing-catalog-must-survive");

    try {
      source.database.query("VACUUM INTO ?").run(backupPath);
      await mkdir(restoredDataDir);
      await writeFile(restoredPath, sentinel);

      const result = await runMynas(
        [
          "catalog",
          "restore",
          "--data-dir",
          restoredDataDir,
          "--input",
          backupPath,
          "--password-stdin",
        ],
        "replacement owner passphrase\n",
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("catalog already exists");
      expect(new Uint8Array(await readFile(restoredPath))).toEqual(sentinel);
      expect(await readdir(restoredDataDir)).toEqual(["mynas.sqlite"]);
    } finally {
      source.database.close();
    }
  });

  test("catalog restore rejects corrupt input without partial output", async () => {
    const root = await createTemporaryRoot();
    const corruptPath = join(root, "corrupt.sqlite");
    const restoredDataDir = join(root, "restored");
    const restoredPath = join(restoredDataDir, "mynas.sqlite");
    await writeFile(corruptPath, "not a SQLite database");

    const result = await runMynas(
      [
        "catalog",
        "restore",
        "--data-dir",
        restoredDataDir,
        "--input",
        corruptPath,
        "--password-stdin",
      ],
      "replacement owner passphrase\n",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("invalid catalog backup");
    expect(await Bun.file(restoredPath).exists()).toBe(false);
    expect(await readdir(root)).toEqual(["corrupt.sqlite"]);
  });
});
