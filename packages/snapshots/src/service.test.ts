import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { migrate } from "../../database/src/migrations";
import type { MirrorObject } from "../../storage/src/mirror";
import {
  canonicalManifestBytes,
  type SnapshotManifest,
  SnapshotRepository,
  SnapshotService,
} from "./service";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const checksum = (value: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

class MemoryObjectStore {
  public readonly objects = new Map<string, Uint8Array>();
  public readonly writes: string[] = [];

  public async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async getObject(key: string, expectedChecksum: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (value === undefined || checksum(value) !== expectedChecksum) {
      throw new Error("unrecoverable mirror object");
    }
    return value;
  }

  public async putObject(key: string, value: Uint8Array): Promise<MirrorObject> {
    this.objects.set(key, value);
    this.writes.push(key);
    return { checksum: checksum(value), key, size: value.byteLength };
  }
}

const input = {
  chunkCount: 1,
  producerId: "fixture-producer",
  producerKind: "slack-dashboard",
  totalBytes: 9,
  volumeId: "snapshots",
} as const;

describe("SnapshotService", () => {
  let database: Database;
  let now: Date;
  let sequence: number;
  let store: MemoryObjectStore;
  let service: SnapshotService;

  const manifest = (bundleId: string, chunks: SnapshotManifest["chunks"]): SnapshotManifest => ({
    bundleId,
    chunkCount: chunks.length,
    chunks,
    format: "mynas.snapshot-bundle",
    metadata: { source: "test" },
    totalBytes: chunks.reduce((total, chunk) => total + chunk.size, 0),
    version: 1,
  });

  beforeEach(() => {
    database = new Database(":memory:");
    migrate(database);
    database
      .query(
        "INSERT INTO storage_volumes (id, kind, members_json, created_at) VALUES (?, 'mirror', ?, ?)",
      )
      .run("snapshots", '["disk-a","disk-b"]', "2026-01-01T00:00:00.000Z");
    now = new Date("2026-01-02T00:00:00.000Z");
    sequence = 0;
    store = new MemoryObjectStore();
    service = new SnapshotService(
      new SnapshotRepository(database),
      () => store,
      () => now,
      () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    );
  });

  afterEach(() => {
    database.close();
  });

  test("publishes manifest and signature last before listing a complete bundle", async () => {
    const bundle = await service.begin(input);
    const contents = bytes("chunk-one");
    const stored = await service.uploadChunk(bundle.id, 0, contents, checksum(contents));

    expect(service.list()).toEqual([]);
    const manifestBytes = canonicalManifestBytes(
      manifest(bundle.id, [{ checksum: stored.checksum, index: 0, size: stored.size }]),
    );
    const signature = new Uint8Array(64).fill(7);
    const complete = await service.complete(bundle.id, manifestBytes, signature);

    expect(complete.status).toBe("complete");
    expect(service.list()).toEqual([complete]);
    expect(store.writes).toEqual([
      `_snapshot-bundles/${bundle.id}/chunks/00000000.bin`,
      `_snapshot-bundles/${bundle.id}/manifest.json`,
      `_snapshot-bundles/${bundle.id}/manifest.sig`,
    ]);
    expect(await service.readManifest(bundle.id)).toEqual(manifestBytes);
    expect(await service.readSignature(bundle.id)).toEqual(signature);
    expect(await service.readChunk(bundle.id, 0)).toEqual(contents);
    expect(
      database.query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM files").get(),
    ).toEqual({ count: 0 });
  });

  test("rejects checksum mismatches and conflicting chunk retries", async () => {
    const bundle = await service.begin(input);
    const contents = bytes("chunk-one");

    await expect(service.uploadChunk(bundle.id, 0, contents, "0".repeat(64))).rejects.toThrow(
      "checksum",
    );
    expect(store.objects.size).toBe(0);

    await service.uploadChunk(bundle.id, 0, contents, checksum(contents));
    await service.uploadChunk(bundle.id, 0, contents, checksum(contents));
    expect(store.writes).toHaveLength(1);
    await expect(
      service.uploadChunk(bundle.id, 0, bytes("different"), checksum(bytes("different"))),
    ).rejects.toThrow("conflict");
  });

  test("refuses missing and noncontiguous chunk manifests", async () => {
    const bundle = await service.begin({ ...input, chunkCount: 2, totalBytes: 18 });
    const first = bytes("chunk-one");
    const stored = await service.uploadChunk(bundle.id, 0, first, checksum(first));

    await expect(
      service.complete(
        bundle.id,
        canonicalManifestBytes(
          manifest(bundle.id, [{ checksum: stored.checksum, index: 0, size: stored.size }]),
        ),
        new Uint8Array(64),
      ),
    ).rejects.toThrow("chunk count");
    await expect(
      service.complete(
        bundle.id,
        canonicalManifestBytes({
          ...manifest(bundle.id, [
            { checksum: stored.checksum, index: 0, size: stored.size },
            { checksum: stored.checksum, index: 2, size: stored.size },
          ]),
          chunkCount: 2,
          totalBytes: 18,
        }),
        new Uint8Array(64),
      ),
    ).rejects.toThrow("contiguous");
    expect(service.list()).toEqual([]);
  });

  test("serializes identical concurrent completion", async () => {
    const bundle = await service.begin(input);
    const contents = bytes("chunk-one");
    const stored = await service.uploadChunk(bundle.id, 0, contents, checksum(contents));
    const manifestBytes = canonicalManifestBytes(
      manifest(bundle.id, [{ checksum: stored.checksum, index: 0, size: stored.size }]),
    );
    const signature = new Uint8Array(64).fill(9);

    const [first, second] = await Promise.all([
      service.complete(bundle.id, manifestBytes, signature),
      service.complete(bundle.id, manifestBytes, signature),
    ]);

    expect(first).toEqual(second);
    expect(store.writes.filter((key) => key.endsWith("manifest.json"))).toHaveLength(1);
    expect(store.writes.filter((key) => key.endsWith("manifest.sig"))).toHaveLength(1);
  });

  test("cleans stale uploads and deletes only completed bundle objects", async () => {
    const stale = await service.begin(input);
    const staleBytes = bytes("chunk-one");
    await service.uploadChunk(stale.id, 0, staleBytes, checksum(staleBytes));
    now = new Date("2026-01-04T00:00:00.000Z");
    const complete = await service.begin(input);
    const completeBytes = bytes("chunk-two");
    const stored = await service.uploadChunk(
      complete.id,
      0,
      completeBytes,
      checksum(completeBytes),
    );
    await service.complete(
      complete.id,
      canonicalManifestBytes(
        manifest(complete.id, [{ checksum: stored.checksum, index: 0, size: stored.size }]),
      ),
      new Uint8Array(64).fill(5),
    );

    expect(await service.cleanupUploadingBefore(new Date("2026-01-03T00:00:00.000Z"))).toBe(1);
    expect([...store.objects.keys()].some((key) => key.includes(stale.id))).toBe(false);
    expect(service.list()).toHaveLength(1);

    await service.delete(complete.id);
    expect(service.list()).toEqual([]);
    expect(store.objects.size).toBe(0);
  });
});
