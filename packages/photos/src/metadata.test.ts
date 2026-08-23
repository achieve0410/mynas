import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { syntheticExifJpeg, syntheticMalformedExifJpeg } from "../../../tests/fixtures/exif-photo";
import { syntheticJpeg } from "../../../tests/fixtures/synthetic-photo";
import { migrate } from "../../database/src/migrations";
import type {
  BackendHealth,
  ByteRange,
  StorageBackend,
  StoredObject,
} from "../../storage/src/adapter";
import { FileCatalog } from "../../storage/src/catalog";
import { MirrorVolume } from "../../storage/src/mirror";
import { PhotoService } from "./photos";

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

describe("photo metadata extraction", () => {
  const importedAt = "2026-01-02T03:04:05.000Z";
  let database: Database;
  let service: PhotoService;

  beforeEach(() => {
    database = new Database(":memory:");
    migrate(database);
    service = new PhotoService(
      database,
      new MirrorVolume(
        "photos",
        [new MemoryBackend("disk-a"), new MemoryBackend("disk-b")],
        new FileCatalog(database, "photos", () => new Date(importedAt)),
      ),
      () => new Date(importedAt),
    );
  });

  afterEach(() => {
    database.close();
  });

  test("extracts offset capture time and GPS from image originals", async () => {
    const result = await service.ingest({
      contents: syntheticExifJpeg({
        dateTimeOriginal: "2024:03:04 05:06:07",
        latitude: 37.5,
        longitude: 127,
        offsetTimeOriginal: "+09:00",
      }),
      filename: "gps-offset.jpg",
    });

    expect(result.photo).toMatchObject({
      capturedAt: "2024-03-03T20:06:07.000Z",
      location: { latitude: 37.5, longitude: 127 },
    });
  });

  test("normalizes negative offsets across a UTC day boundary", async () => {
    const result = await service.ingest({
      contents: syntheticExifJpeg({
        dateTimeOriginal: "2024:01:01 23:30:00",
        offsetTimeOriginal: "-02:30",
      }),
      filename: "negative-offset.jpg",
    });

    expect(result.photo).toMatchObject({
      capturedAt: "2024-01-02T02:00:00.000Z",
      location: null,
    });
  });

  test("encodes no-offset camera wall time without host timezone shift", async () => {
    const result = await service.ingest({
      contents: syntheticExifJpeg({ dateTimeOriginal: "2024:03:04 05:06:07" }),
      filename: "wall-time.jpg",
    });

    expect(result.photo).toMatchObject({
      capturedAt: "2024-03-04T05:06:07.000",
      location: null,
    });
  });

  test("falls back on absent or malformed EXIF", async () => {
    const [absent, malformed] = await Promise.all([
      service.ingest({ contents: syntheticJpeg(), filename: "absent.jpg" }),
      service.ingest({ contents: syntheticMalformedExifJpeg(), filename: "malformed.jpg" }),
    ]);

    expect(absent.photo).toMatchObject({ capturedAt: importedAt, location: null });
    expect(malformed.photo).toMatchObject({ capturedAt: importedAt, location: null });
  });

  test("requires a complete in-range GPS pair while preserving zero", async () => {
    const [incomplete, outOfRange, zero] = await Promise.all([
      service.ingest({
        contents: syntheticExifJpeg({
          dateTimeOriginal: "2024:03:04 05:06:07",
          latitude: 37.5,
        }),
        filename: "incomplete.jpg",
      }),
      service.ingest({
        contents: syntheticExifJpeg({
          dateTimeOriginal: "2024:03:04 05:06:08",
          latitude: 91,
          longitude: 181,
        }),
        filename: "out-of-range.jpg",
      }),
      service.ingest({
        contents: syntheticExifJpeg({
          dateTimeOriginal: "2024:03:04 05:06:09",
          latitude: 0,
          longitude: 0,
        }),
        filename: "zero.jpg",
      }),
    ]);

    expect(incomplete.photo).toMatchObject({
      capturedAt: "2024-03-04T05:06:07.000",
      location: null,
    });
    expect(outOfRange.photo).toMatchObject({
      capturedAt: "2024-03-04T05:06:08.000",
      location: null,
    });
    expect(zero.photo).toMatchObject({ location: { latitude: 0, longitude: 0 } });
  });
});
