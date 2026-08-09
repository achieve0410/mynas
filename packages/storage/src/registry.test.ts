import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "../../database/src/migrations";
import { StorageRegistry } from "./registry";

describe("StorageRegistry persistence", () => {
  let database: Database;
  let root: string;
  let temporaryDirectory: string;

  beforeEach(async () => {
    database = new Database(":memory:");
    migrate(database);
    temporaryDirectory = await mkdtemp(join(tmpdir(), "mynas-registry-"));
    root = join(temporaryDirectory, "disk");
    await mkdir(root);
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  test("keeps a replaced local backend unavailable after restart", async () => {
    const first = new StorageRegistry(database, {});
    await first.addBackend({ id: "disk", kind: "local", root });

    await rename(root, `${root}-original`);
    await mkdir(root);

    const restarted = new StorageRegistry(database, {});
    const health = await (await restarted.getBackend("disk")).probe();

    expect(health.status).toBe("unavailable");
  });
});
