import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readdir, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalDirectoryBackend } from "./local";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

describe("LocalDirectoryBackend", () => {
  let workDir: string;
  let root: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "mynas-local-"));
    root = join(workDir, "disk");
    await mkdir(root);
  });

  afterEach(async () => {
    await chmod(workDir, 0o700);
    await rm(workDir, { force: true, recursive: true });
  });

  test("round-trips bytes, ranges, metadata, and deletion", async () => {
    const backend = new LocalDirectoryBackend("disk-a", root);
    await backend.initialize();

    const stored = await backend.put("blobs/item.bin", bytes("0123456789"));
    expect(stored).toEqual({ key: "blobs/item.bin", size: 10 });
    expect(text(await backend.get("blobs/item.bin"))).toBe("0123456789");
    expect(text(await backend.get("blobs/item.bin", { start: 2, endExclusive: 6 }))).toBe("2345");
    expect(await backend.stat("blobs/item.bin")).toEqual(stored);

    await backend.delete("blobs/item.bin");
    expect(await backend.stat("blobs/item.bin")).toBeNull();
  });

  test("atomically replaces objects with private file permissions", async () => {
    const backend = new LocalDirectoryBackend("disk-a", root);
    await backend.initialize();
    await backend.put("blobs/item.bin", bytes("old"));
    await backend.put("blobs/item.bin", bytes("new-content"));

    expect(text(await backend.get("blobs/item.bin"))).toBe("new-content");
    expect((await lstat(join(root, "blobs", "item.bin"))).mode & 0o777).toBe(0o600);
    expect(
      (await readdir(root, { recursive: true })).some((entry) => entry.includes(".tmp-")),
    ).toBe(false);
  });

  test("does not create directories while probing a missing object", async () => {
    const backend = new LocalDirectoryBackend("disk-a", root);
    await backend.initialize();

    expect(await backend.stat("absent/item.bin")).toBeNull();
    expect(await readdir(root)).not.toContain("absent");
  });

  test("rejects traversal, absolute keys, and symlink path components", async () => {
    const backend = new LocalDirectoryBackend("disk-a", root);
    await backend.initialize();

    await expect(backend.put("../escape.bin", bytes("escape"))).rejects.toThrow("object key");
    await expect(backend.put("/absolute.bin", bytes("escape"))).rejects.toThrow("object key");

    const outside = join(workDir, "outside");
    await mkdir(outside);
    await symlink(outside, join(root, "blobs"));
    await expect(backend.put("blobs/escape.bin", bytes("escape"))).rejects.toThrow("symlink");
  });

  test("rejects a symlink backend root", async () => {
    const realRoot = join(workDir, "real-disk");
    const linkedRoot = join(workDir, "linked-disk");
    await mkdir(realRoot);
    await symlink(realRoot, linkedRoot);

    const backend = new LocalDirectoryBackend("disk-a", linkedRoot);
    await expect(backend.initialize()).rejects.toThrow("symlink");
  });

  test("detects a removed or replaced external volume identity", async () => {
    const backend = new LocalDirectoryBackend("disk-a", root);
    await backend.initialize();
    const initialHealth = await backend.probe();
    expect(initialHealth.status).toBe("healthy");

    await rename(root, join(workDir, "disk-unmounted"));
    await mkdir(root);

    const health = await backend.probe();
    expect(health.status).toBe("unavailable");
    await expect(backend.put("blobs/refused.bin", bytes("no degraded writes"))).rejects.toThrow(
      "unavailable",
    );
  });
});
