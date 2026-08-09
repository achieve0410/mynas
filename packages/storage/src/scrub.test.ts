import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "../../database/src/migrations";
import { FileCatalog } from "./catalog";
import { LocalDirectoryBackend } from "./local";
import { MirrorVolume } from "./mirror";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

describe("mirror scrub and repair", () => {
  let workDir: string;
  let database: Database;
  let firstRoot: string;
  let secondRoot: string;
  let volume: MirrorVolume;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "mynas-scrub-"));
    firstRoot = join(workDir, "disk-a");
    secondRoot = join(workDir, "disk-b");
    await mkdir(firstRoot);
    await mkdir(secondRoot);

    const first = new LocalDirectoryBackend("disk-a", firstRoot);
    const second = new LocalDirectoryBackend("disk-b", secondRoot);
    await first.initialize();
    await second.initialize();

    database = new Database(":memory:");
    migrate(database);
    volume = new MirrorVolume("photos", [first, second], new FileCatalog(database, "photos"));
  });

  afterEach(async () => {
    database.close();
    await chmod(workDir, 0o700);
    await rm(workDir, { force: true, recursive: true });
  });

  test("classifies corruption and missing replicas, repairs them, and refuses an unavailable disk", async () => {
    const version = await volume.put("photos/fixture.bin", bytes("verified-photo-bytes"));
    if (version.blob === null) {
      throw new Error("expected a blob version");
    }
    const firstObject = join(firstRoot, ...version.blob.key.split("/"));
    const secondObject = join(secondRoot, ...version.blob.key.split("/"));

    await writeFile(firstObject, bytes("corrupt"));
    const corrupt = await volume.scrub();
    expect(corrupt.corrupt).toBe(1);
    expect(corrupt.unrecoverable).toBe(0);

    expect(await volume.repair()).toEqual({ repaired: 1, unrecoverable: 0 });
    expect(await volume.scrub()).toMatchObject({
      corrupt: 0,
      missing: 0,
      unavailable: 0,
      unrecoverable: 0,
    });
    expect(text(await volume.get("photos/fixture.bin"))).toBe("verified-photo-bytes");

    await unlink(secondObject);
    expect((await volume.scrub()).missing).toBe(1);
    expect(await volume.repair()).toEqual({ repaired: 1, unrecoverable: 0 });

    await rename(secondRoot, join(workDir, "disk-b-unmounted"));
    await mkdir(secondRoot);
    expect((await volume.scrub()).unavailable).toBe(1);
    await expect(volume.put("photos/refused.bin", bytes("degraded"))).rejects.toThrow("degraded");
  });
});
