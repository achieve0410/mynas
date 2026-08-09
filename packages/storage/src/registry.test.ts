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

  test("rejects aliases of one physical target as mirror members", async () => {
    const registry = new StorageRegistry(database, {});
    await registry.addBackend({ id: "disk", kind: "local", root });
    await registry.addBackend({ id: "alias", kind: "local", root });

    await expect(registry.addMirror("unsafe", ["disk", "alias"])).rejects.toThrow(
      "distinct storage targets",
    );
  });

  test("maps concurrent duplicate registration to a conflict", async () => {
    const registry = new StorageRegistry(database, {});
    const registrations = await Promise.allSettled([
      registry.addBackend({ id: "race", kind: "local", root }),
      registry.addBackend({ id: "race", kind: "local", root }),
    ]);

    expect(registrations.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = registrations.find(({ status }) => status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
      code: "conflict",
    });
  });
});
