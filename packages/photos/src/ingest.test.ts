import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { syntheticJpeg, syntheticJpegSha256 } from "../../../tests/fixtures/synthetic-photo";
import { migrate } from "../../database/src/migrations";
import type {
  BackendHealth,
  ByteRange,
  StorageBackend,
  StoredObject,
} from "../../storage/src/adapter";
import { FileCatalog } from "../../storage/src/catalog";
import { MirrorVolume } from "../../storage/src/mirror";
import { PhotoError, PhotoService } from "./photos";

class MemoryBackend implements StorageBackend {
  public readonly kind = "local";
  private readonly objects = new Map<string, Uint8Array>();

  public constructor(
    public readonly id: string,
    public readonly replicaIdentity = id,
  ) {}

  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async get(key: string, range?: ByteRange): Promise<Uint8Array> {
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

describe("PhotoService", () => {
  let database: Database;
  let service: PhotoService;

  beforeEach(() => {
    database = new Database(":memory:");
    migrate(database);
    const volume = new MirrorVolume(
      "photos",
      [new MemoryBackend("disk-a"), new MemoryBackend("disk-b")],
      new FileCatalog(database, "photos", () => new Date("2026-01-02T03:04:05.000Z")),
    );
    service = new PhotoService(database, volume, () => new Date("2026-01-02T03:04:05.000Z"));
  });

  afterEach(() => {
    database.close();
  });

  test("stores a synthetic JPEG and derives durable metadata and a preview", async () => {
    const result = await service.ingest({
      contents: syntheticJpeg(),
      filename: "synthetic-landscape.jpg",
    });

    expect(result.job).toMatchObject({
      error: null,
      photoId: result.photo.id,
      status: "completed",
    });
    expect(result.photo).toMatchObject({
      capturedAt: "2026-01-02T03:04:05.000Z",
      checksum: syntheticJpegSha256(),
      filename: "synthetic-landscape.jpg",
      format: "jpeg",
      height: 3,
      importedAt: "2026-01-02T03:04:05.000Z",
      width: 4,
    });
    expect(await service.getOriginal(result.photo.id)).toEqual(syntheticJpeg());
    expect(new TextDecoder().decode((await service.getPreview(result.photo.id)).slice(0, 4))).toBe(
      "RIFF",
    );
  });

  test("deduplicates originals and exposes timeline albums", async () => {
    const results = await Promise.all([
      service.ingest({
        contents: syntheticJpeg(),
        filename: "synthetic-first.jpg",
      }),
      service.ingest({
        contents: syntheticJpeg(),
        filename: "synthetic-copy.jpg",
      }),
    ]);
    const first = results[0];
    const duplicate = results[1];
    if (first === undefined || duplicate === undefined) {
      throw new Error("expected both ingestion results");
    }

    expect(results.map(({ deduplicated }) => deduplicated).sort()).toEqual([false, true]);
    expect(duplicate.photo.id).toBe(first.photo.id);
    expect(service.listTimeline().map(({ id }) => id)).toEqual([first.photo.id]);

    const album = service.createAlbum("Synthetic QA");
    expect(service.addToAlbum(album.id, first.photo.id).photos.map(({ id }) => id)).toEqual([
      first.photo.id,
    ]);
    expect(service.getAlbum(album.id)).toMatchObject({ name: "Synthetic QA" });
  });

  test("rejects non-image bytes at the trust boundary", async () => {
    await expect(
      service.ingest({
        contents: new TextEncoder().encode("not an image"),
        filename: "invalid.jpg",
      }),
    ).rejects.toEqual(new PhotoError("invalid_image", "unsupported or invalid image"));
  });
});
