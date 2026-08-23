import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { syntheticExifJpeg } from "../../../tests/fixtures/exif-photo";
import { migrate } from "../../database/src/migrations";
import type {
  BackendHealth,
  ByteRange,
  StorageBackend,
  StoredObject,
} from "../../storage/src/adapter";
import { FileCatalog } from "../../storage/src/catalog";
import { MirrorVolume } from "../../storage/src/mirror";
import { PhotoMetadataStore } from "./metadata-store";
import { PhotoService } from "./photos";

type BackfillReport = {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly remaining: number;
  readonly updated: number;
};

type BackfillablePhotoService = PhotoService & {
  readonly backfillMetadata: (limit: number) => Promise<BackfillReport>;
};

class MemoryBackend implements StorageBackend {
  public readonly kind = "local";
  public failGets = false;
  private readonly objects = new Map<string, Uint8Array>();
  private nextGetGate:
    | {
        readonly release: Promise<void>;
        readonly started: () => void;
      }
    | undefined;

  public constructor(
    public readonly id: string,
    public readonly replicaIdentity = id,
  ) {}

  public blockNextGet(): { readonly release: () => void; readonly started: Promise<void> } {
    let release = () => {};
    let started = () => {};
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    this.nextGetGate = { release: releasePromise, started };
    return { release, started: startedPromise };
  }

  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async get(key: string, range?: ByteRange): Promise<Uint8Array> {
    const gate = this.nextGetGate;
    this.nextGetGate = undefined;
    if (gate !== undefined) {
      gate.started();
      await gate.release;
    }
    if (this.failGets) {
      throw new Error("backend unavailable");
    }
    const value = this.objects.get(key);
    if (value === undefined) {
      throw new Error("object missing");
    }
    return range === undefined ? value.slice() : value.slice(range.start, range.endExclusive);
  }

  public async probe(): Promise<BackendHealth> {
    return { filesystemIdentity: this.id, status: "healthy" };
  }

  public async put(key: string, contents: Uint8Array): Promise<StoredObject> {
    this.objects.set(key, contents.slice());
    return { key, size: contents.byteLength };
  }

  public async stat(key: string): Promise<StoredObject | null> {
    const value = this.objects.get(key);
    return value === undefined ? null : { key, size: value.byteLength };
  }
}

const backfill = (service: PhotoService, limit: number): Promise<BackfillReport> =>
  (service as BackfillablePhotoService).backfillMetadata(limit);

describe("photo metadata backfill", () => {
  const now = "2026-01-02T03:04:05.000Z";
  let backendA: MemoryBackend;
  let backendB: MemoryBackend;
  let database: Database;
  let service: PhotoService;
  let volume: MirrorVolume;

  beforeEach(() => {
    database = new Database(":memory:");
    migrate(database);
    backendA = new MemoryBackend("disk-a");
    backendB = new MemoryBackend("disk-b");
    volume = new MirrorVolume(
      "photos",
      [backendA, backendB],
      new FileCatalog(database, "photos", () => new Date(now)),
    );
    service = new PhotoService(database, volume, () => new Date(now));
  });

  afterEach(() => {
    database.close();
  });

  const ingestPending = async (second: number) => {
    const result = await service.ingest({
      contents: syntheticExifJpeg({
        dateTimeOriginal: `2024:03:04 05:06:${String(second).padStart(2, "0")}`,
        latitude: 37.5,
        longitude: 127,
        offsetTimeOriginal: "+09:00",
      }),
      filename: `pending-${second}.jpg`,
    });
    database
      .query(
        `UPDATE photos
         SET captured_at = imported_at, latitude = NULL, longitude = NULL,
             metadata_version = 0, metadata_claimed_at = NULL
         WHERE id = ?`,
      )
      .run(result.photo.id);
    return result.photo.id;
  };

  test("backfills metadata once and bounds each batch", async () => {
    await ingestPending(7);
    await ingestPending(8);

    expect(await backfill(service, 1)).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      remaining: 1,
      updated: 1,
    });
    expect(await backfill(service, 1)).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
      updated: 1,
    });
    expect(await backfill(service, 1)).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      remaining: 0,
      updated: 0,
    });
  });

  test("concurrent batches claim disjoint photos", async () => {
    await ingestPending(7);
    await ingestPending(8);
    const gate = backendA.blockNextGet();
    const first = backfill(service, 1);
    await gate.started;
    const second = await backfill(new PhotoService(database, volume, () => new Date(now)), 1);
    gate.release();

    expect(await first).toMatchObject({ claimed: 1, completed: 1, updated: 1 });
    expect(second).toMatchObject({ claimed: 1, completed: 1, updated: 1 });
    expect(
      database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM photos WHERE metadata_version = 1",
        )
        .get(),
    ).toEqual({ count: 2 });
  });

  test("fresh leases are skipped and expired leases reclaimed", async () => {
    const photoId = await ingestPending(7);
    database
      .query("UPDATE photos SET metadata_version = -1, metadata_claimed_at = ? WHERE id = ?")
      .run(now, photoId);

    expect(await backfill(service, 1)).toMatchObject({ claimed: 0, remaining: 1 });

    database
      .query("UPDATE photos SET metadata_claimed_at = ? WHERE id = ?")
      .run("2026-01-02T02:00:00.000Z", photoId);
    expect(await backfill(service, 1)).toMatchObject({
      claimed: 1,
      remaining: 0,
      updated: 1,
    });
  });

  test("an expired worker cannot complete or release a renewed lease", async () => {
    const photoId = await ingestPending(7);
    const staleStore = new PhotoMetadataStore(database, () => new Date(now));
    expect(staleStore.claim(1)).toHaveLength(1);
    const renewedAt = "2026-01-02T03:35:05.000Z";
    const currentStore = new PhotoMetadataStore(database, () => new Date(renewedAt));
    expect(currentStore.claim(1)).toHaveLength(1);

    expect(
      staleStore.complete(photoId, now, {
        capturedAt: "2024-03-03T20:06:07.000Z",
        location: { latitude: 37.5, longitude: 127 },
      }),
    ).toBe(false);
    database
      .query("UPDATE photos SET metadata_version = -1, metadata_claimed_at = ? WHERE id = ?")
      .run(renewedAt, photoId);
    expect(staleStore.release(photoId, now)).toBe(false);
  });

  test("storage failure releases a claim for retry", async () => {
    await ingestPending(7);
    backendA.failGets = true;
    backendB.failGets = true;

    expect(await backfill(service, 1)).toMatchObject({ failed: 1, remaining: 1 });
    expect(
      database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM photos WHERE metadata_version = 0",
        )
        .get(),
    ).toEqual({ count: 1 });

    backendA.failGets = false;
    backendB.failGets = false;
    expect(await backfill(service, 1)).toMatchObject({ remaining: 0, updated: 1 });
  });

  test("concurrent deletion is benign", async () => {
    const photoId = await ingestPending(7);
    const gate = backendA.blockNextGet();
    const running = backfill(service, 1);
    await gate.started;
    await service.deletePhoto(photoId);
    gate.release();

    expect(await running).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
      updated: 0,
    });
  });
});
