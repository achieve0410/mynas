import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { migrate } from "../../database/src/migrations";
import type { BackendHealth, ByteRange, StorageBackend, StoredObject } from "./adapter";
import { FileCatalog } from "./catalog";
import { MirrorVolume } from "./mirror";

class MemoryBackend implements StorageBackend {
  public readonly kind = "local";
  public readonly objects = new Map<string, Uint8Array>();
  public available = true;
  public failWrites = false;

  public constructor(public readonly id: string) {}

  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async get(key: string, range?: ByteRange): Promise<Uint8Array> {
    if (!this.available) {
      throw new Error("backend unavailable");
    }
    const value = this.objects.get(key);
    if (value === undefined) {
      throw new Error("object missing");
    }
    return range === undefined ? value.slice() : value.slice(range.start, range.endExclusive);
  }

  public async probe(): Promise<BackendHealth> {
    return this.available
      ? { filesystemIdentity: this.id, status: "healthy" }
      : { reason: "backend unavailable", status: "unavailable" };
  }

  public async put(key: string, contents: Uint8Array): Promise<StoredObject> {
    if (!this.available || this.failWrites) {
      throw new Error("backend write failed");
    }
    this.objects.set(key, contents.slice());
    return { key, size: contents.byteLength };
  }

  public async stat(key: string): Promise<StoredObject | null> {
    const value = this.objects.get(key);
    return value === undefined ? null : { key, size: value.byteLength };
  }
}

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

describe("MirrorVolume", () => {
  let database: Database;
  let first: MemoryBackend;
  let second: MemoryBackend;
  let volume: MirrorVolume;

  beforeEach(() => {
    database = new Database(":memory:");
    migrate(database);
    first = new MemoryBackend("disk-a");
    second = new MemoryBackend("disk-b");
    volume = new MirrorVolume(
      "photos",
      [first, second],
      new FileCatalog(database, "photos", () => new Date("2026-01-01T00:00:00.000Z")),
    );
  });

  afterEach(() => {
    database.close();
  });

  test("writes every byte to both members and reads through one corrupt replica", async () => {
    const version = await volume.put("photos/image.bin", bytes("mirror-bytes"));
    expect(version.blob).not.toBeNull();
    if (version.blob === null) {
      throw new Error("expected a blob version");
    }
    expect(first.objects.get(version.blob.key)).toEqual(bytes("mirror-bytes"));
    expect(second.objects.get(version.blob.key)).toEqual(bytes("mirror-bytes"));

    first.objects.set(version.blob.key, bytes("corrupt"));
    expect(text(await volume.get("photos/image.bin"))).toBe("mirror-bytes");
  });

  test("rolls back a partial write and refuses degraded writes", async () => {
    second.failWrites = true;
    await expect(volume.put("photos/partial.bin", bytes("rollback"))).rejects.toThrow(
      "mirror write",
    );
    expect(first.objects.size).toBe(0);

    second.failWrites = false;
    second.available = false;
    await expect(volume.put("photos/degraded.bin", bytes("refuse"))).rejects.toThrow("degraded");
    expect(first.objects.size).toBe(0);
  });

  test("keeps immutable versions across delete and restore", async () => {
    const firstVersion = await volume.put("docs/note.txt", bytes("version-one"));
    await volume.put("docs/note.txt", bytes("version-two"));
    expect(text(await volume.get("docs/note.txt"))).toBe("version-two");
    expect(volume.versions("docs/note.txt")).toHaveLength(2);

    await volume.delete("docs/note.txt");
    await expect(volume.get("docs/note.txt")).rejects.toThrow("not found");
    expect(volume.versions("docs/note.txt")).toHaveLength(3);

    await volume.restore("docs/note.txt", firstVersion.id);
    expect(text(await volume.get("docs/note.txt"))).toBe("version-one");
    expect(volume.versions("docs/note.txt")).toHaveLength(4);
  });

  test("serializes concurrent versions without partial catalog state", async () => {
    await Promise.all([
      volume.put("docs/concurrent.txt", bytes("alpha")),
      volume.put("docs/concurrent.txt", bytes("bravo")),
    ]);

    expect(volume.versions("docs/concurrent.txt")).toHaveLength(2);
    expect(["alpha", "bravo"]).toContain(text(await volume.get("docs/concurrent.txt")));
  });

  test("reports total replica loss instead of returning corrupt bytes", async () => {
    const version = await volume.put("photos/lost.bin", bytes("original"));
    if (version.blob === null) {
      throw new Error("expected a blob version");
    }
    first.objects.set(version.blob.key, bytes("corrupt-a"));
    second.objects.set(version.blob.key, bytes("corrupt-b"));

    await expect(volume.get("photos/lost.bin")).rejects.toThrow("unrecoverable");
    expect((await volume.scrub()).unrecoverable).toBe(1);
  });
});
