import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";
import { syntheticExifJpeg } from "../fixtures/exif-photo";
import { syntheticHeic, syntheticJpeg, syntheticJpegSha256 } from "../fixtures/synthetic-photo";

const loginSchema = z.object({ token: z.string().min(32) });
const photoSchema = z.object({
  capturedAt: z.string(),
  checksum: z.string().length(64),
  filename: z.string(),
  format: z.enum(["heic", "jpeg", "png"]),
  height: z.number().int().positive(),
  id: z.string().uuid(),
  importedAt: z.string(),
  location: z
    .object({
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    })
    .nullable(),
  width: z.number().int().positive(),
});
const ingestSchema = z.object({
  deduplicated: z.boolean(),
  job: z.object({
    id: z.string().uuid(),
    photoId: z.string().uuid(),
    status: z.literal("completed"),
  }),
  photo: photoSchema,
});
const checksumLookupSchema = z.object({
  matches: z.array(
    photoSchema.pick({
      checksum: true,
      filename: true,
      id: true,
    }),
  ),
});
const albumResponseSchema = z.object({
  id: z.string().uuid(),
  photos: z.array(photoSchema),
});
const metadataBackfillSchema = z.object({
  claimed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});

const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  return buffer;
};

const sha256 = (contents: ArrayBuffer): string =>
  new Bun.CryptoHasher("sha256").update(new Uint8Array(contents)).digest("hex");

describe("photo API", () => {
  let app: ReturnType<typeof createApp>;
  let database: Database;
  let dataDir: string;
  let token: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-api-photos-"));
    const diskA = join(dataDir, "disk-a");
    const diskB = join(dataDir, "disk-b");
    await mkdir(diskA);
    await mkdir(diskB);
    database = new Database(":memory:");
    migrate(database);
    app = createApp({ dataDir, database, environment: {} });

    await app.request("/api/v1/setup", {
      body: JSON.stringify({ password: "synthetic owner passphrase", username: "owner" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const login = await app.request("/api/v1/login", {
      body: JSON.stringify({ password: "synthetic owner passphrase", username: "owner" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    token = loginSchema.parse(await login.json()).token;

    for (const [id, root] of [
      ["disk-a", diskA],
      ["disk-b", diskB],
    ]) {
      const response = await app.request("/api/v1/backends", {
        body: JSON.stringify({ id, kind: "local", root }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      expect(response.status).toBe(201);
    }
    const volume = await app.request("/api/v1/volumes", {
      body: JSON.stringify({ id: "photos", kind: "mirror", members: ["disk-a", "disk-b"] }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(volume.status).toBe(201);
  });

  afterEach(async () => {
    database.close();
    await rm(dataDir, { force: true, recursive: true });
  });

  test("looks up exact protected photo checksums in bounded authenticated batches", async () => {
    const uploaded = await app.request("/api/v1/photos", {
      body: exactArrayBuffer(syntheticJpeg()),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/jpeg",
        "x-mynas-filename": encodeURIComponent("known-photo.jpg"),
      },
      method: "POST",
    });
    const ingest = ingestSchema.parse(await uploaded.json());
    const missingChecksum = "0".repeat(64);
    const lookup = await app.request("/api/v1/photos/checksums", {
      body: JSON.stringify({
        checksums: [missingChecksum, ingest.photo.checksum, ingest.photo.checksum],
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(lookup.status).toBe(200);
    expect(checksumLookupSchema.parse(await lookup.json())).toEqual({
      matches: [
        {
          checksum: ingest.photo.checksum,
          filename: "known-photo.jpg",
          id: ingest.photo.id,
        },
      ],
    });

    for (const checksums of [[], ["not-a-checksum"], Array(501).fill(missingChecksum)]) {
      const invalid = await app.request("/api/v1/photos/checksums", {
        body: JSON.stringify({ checksums }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      expect(invalid.status).toBe(400);
    }
    const unauthorized = await app.request("/api/v1/photos/checksums", {
      body: JSON.stringify({ checksums: [ingest.photo.checksum] }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
  });

  test("backfills protected originals in bounded authenticated batches", async () => {
    const photoIds: string[] = [];
    for (const second of [7, 8]) {
      const uploaded = await app.request("/api/v1/photos", {
        body: exactArrayBuffer(
          syntheticExifJpeg({
            dateTimeOriginal: `2024:03:04 05:06:0${second}`,
            latitude: 37.5,
            longitude: 127,
            offsetTimeOriginal: "+09:00",
          }),
        ),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "image/jpeg",
          "x-mynas-filename": encodeURIComponent(`pending-${second}.jpg`),
        },
        method: "POST",
      });
      const ingest = ingestSchema.parse(await uploaded.json());
      expect(ingest.photo.location).toEqual({ latitude: 37.5, longitude: 127 });
      photoIds.push(ingest.photo.id);
    }
    database
      .query(
        `UPDATE photos
         SET captured_at = imported_at, latitude = NULL, longitude = NULL,
             metadata_version = 0, metadata_claimed_at = NULL`,
      )
      .run();

    const unauthorized = await app.request("/api/v1/photos/metadata/backfill", {
      body: JSON.stringify({ limit: 1 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    for (const body of [{ limit: 11 }, { limit: 1, unknown: true }]) {
      const invalid = await app.request("/api/v1/photos/metadata/backfill", {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      expect(invalid.status).toBe(400);
    }

    const run = async () => {
      const response = await app.request("/api/v1/photos/metadata/backfill", {
        body: JSON.stringify({ limit: 1 }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      expect(response.status).toBe(200);
      return metadataBackfillSchema.parse(await response.json());
    };

    expect(await run()).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      remaining: 1,
      updated: 1,
    });
    expect(await run()).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
      updated: 1,
    });
    expect(await run()).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      remaining: 0,
      updated: 0,
    });
    expect(
      database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM photos WHERE metadata_version = 1",
        )
        .get(),
    ).toEqual({ count: photoIds.length });
    expect(
      database
        .query<{ readonly count: number }, []>(
          `SELECT COUNT(*) AS count
           FROM activity_events
           WHERE action = 'photo.metadata.backfill' AND outcome = 'success'`,
        )
        .get(),
    ).toEqual({ count: 3 });
  });

  test("completes ingestion before its exact response signal and serves every photo surface", async () => {
    const uploaded = await app.request("/api/v1/photos", {
      body: exactArrayBuffer(syntheticJpeg()),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/jpeg",
        "x-mynas-filename": encodeURIComponent("합성-풍경.jpg"),
      },
      method: "POST",
    });
    expect(uploaded.status).toBe(201);
    const ingest = ingestSchema.parse(await uploaded.json());
    expect(ingest.photo.checksum).toBe(syntheticJpegSha256());
    expect(ingest.photo.filename).toBe("합성-풍경.jpg");

    const job = await app.request(`/api/v1/photo-jobs/${ingest.job.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await job.json()).toMatchObject({
      photoId: ingest.photo.id,
      status: "completed",
    });

    const timeline = await app.request("/api/v1/photos", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await timeline.json()).toEqual([expect.objectContaining({ id: ingest.photo.id })]);

    const preview = await app.request(`/api/v1/photos/${ingest.photo.id}/preview`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(preview.headers.get("content-type")).toBe("image/webp");
    expect(new TextDecoder().decode((await preview.bytes()).slice(0, 4))).toBe("RIFF");

    const original = await app.request(`/api/v1/photos/${ingest.photo.id}/original`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(original.headers.get("cache-control")).toBe("no-store");
    expect(original.headers.get("content-disposition")).toContain(
      encodeURIComponent("합성-풍경.jpg"),
    );
    expect(sha256(await original.arrayBuffer())).toBe(syntheticJpegSha256());

    const createdAlbum = await app.request("/api/v1/albums", {
      body: JSON.stringify({ name: "Synthetic QA" }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(createdAlbum.status).toBe(201);
    const album = z.object({ id: z.string().uuid() }).parse(await createdAlbum.json());

    const added = await app.request(`/api/v1/albums/${album.id}/photos/${ingest.photo.id}`, {
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
    });
    expect(await added.json()).toMatchObject({
      name: "Synthetic QA",
      photos: [expect.objectContaining({ id: ingest.photo.id })],
    });

    const albums = await app.request("/api/v1/albums", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(albums.status).toBe(200);
    expect(await albums.json()).toEqual([
      expect.objectContaining({
        id: album.id,
        photos: [expect.objectContaining({ id: ingest.photo.id })],
      }),
    ]);
  });

  test("renames an album and preserves its protected photo members", async () => {
    const uploaded = await app.request("/api/v1/photos", {
      body: exactArrayBuffer(syntheticJpeg()),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/jpeg",
        "x-mynas-filename": encodeURIComponent("앨범-보존-사진.jpg"),
      },
      method: "POST",
    });
    expect(uploaded.status).toBe(201);
    const ingest = ingestSchema.parse(await uploaded.json());

    const created = await app.request("/api/v1/albums", {
      body: JSON.stringify({ name: "수정 전 앨범" }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const album = z.object({ id: z.string().uuid() }).parse(await created.json());
    const added = await app.request(`/api/v1/albums/${album.id}/photos/${ingest.photo.id}`, {
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
    });
    expect(added.status).toBe(200);

    const renamed = await app.request(`/api/v1/albums/${album.id}`, {
      body: JSON.stringify({ name: "  수정된 앨범  " }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "PATCH",
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      id: album.id,
      name: "수정된 앨범",
      photos: [expect.objectContaining({ id: ingest.photo.id })],
    });
  });

  test("deletes an album without deleting its protected photos", async () => {
    const uploaded = await app.request("/api/v1/photos", {
      body: exactArrayBuffer(syntheticJpeg()),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/jpeg",
        "x-mynas-filename": encodeURIComponent("앨범-삭제-후-보존.jpg"),
      },
      method: "POST",
    });
    expect(uploaded.status).toBe(201);
    const ingest = ingestSchema.parse(await uploaded.json());

    const created = await app.request("/api/v1/albums", {
      body: JSON.stringify({ name: "삭제할 앨범" }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const album = z.object({ id: z.string().uuid() }).parse(await created.json());
    const added = await app.request(`/api/v1/albums/${album.id}/photos/${ingest.photo.id}`, {
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
    });
    expect(added.status).toBe(200);

    const deleted = await app.request(`/api/v1/albums/${album.id}`, {
      headers: { authorization: `Bearer ${token}` },
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);

    const missingAlbum = await app.request(`/api/v1/albums/${album.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missingAlbum.status).toBe(404);
    const albums = await app.request("/api/v1/albums", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await albums.json()).toEqual([]);
    const original = await app.request(`/api/v1/photos/${ingest.photo.id}/original`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(original.status).toBe(200);
    expect(sha256(await original.arrayBuffer())).toBe(syntheticJpegSha256());
  });

  test("removes one album membership while preserving the protected photo", async () => {
    const uploaded = await app.request("/api/v1/photos", {
      body: exactArrayBuffer(syntheticJpeg()),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/jpeg",
        "x-mynas-filename": encodeURIComponent("album-scoped-removal.jpg"),
      },
      method: "POST",
    });
    const { photo } = ingestSchema.parse(await uploaded.json());
    const albums = await Promise.all(
      ["Keep photo here", "Remove photo here"].map(async (name) => {
        const response = await app.request("/api/v1/albums", {
          body: JSON.stringify({ name }),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
        });
        return albumResponseSchema.parse(await response.json());
      }),
    );
    for (const album of albums) {
      const added = await app.request(`/api/v1/albums/${album.id}/photos/${photo.id}`, {
        headers: { authorization: `Bearer ${token}` },
        method: "POST",
      });
      expect(added.status).toBe(200);
    }

    const removed = await app.request(`/api/v1/albums/${albums[1]?.id}/photos/${photo.id}`, {
      headers: { authorization: `Bearer ${token}` },
      method: "DELETE",
    });
    expect(removed.status).toBe(204);

    const keptAlbum = albumResponseSchema.parse(
      await (
        await app.request(`/api/v1/albums/${albums[0]?.id}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).json(),
    );
    const changedAlbum = albumResponseSchema.parse(
      await (
        await app.request(`/api/v1/albums/${albums[1]?.id}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).json(),
    );
    expect(keptAlbum.photos.map(({ id }) => id)).toEqual([photo.id]);
    expect(changedAlbum.photos).toEqual([]);
    const original = await app.request(`/api/v1/photos/${photo.id}/original`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(original.status).toBe(200);
  });

  test("deletes a protected photo from the library and every album", async () => {
    const uploaded = await app.request("/api/v1/photos", {
      body: exactArrayBuffer(syntheticJpeg()),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/jpeg",
        "x-mynas-filename": encodeURIComponent("delete-everywhere.jpg"),
      },
      method: "POST",
    });
    const { photo } = ingestSchema.parse(await uploaded.json());
    const albums = await Promise.all(
      ["Delete everywhere A", "Delete everywhere B"].map(async (name) => {
        const response = await app.request("/api/v1/albums", {
          body: JSON.stringify({ name }),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
        });
        const album = albumResponseSchema.parse(await response.json());
        await app.request(`/api/v1/albums/${album.id}/photos/${photo.id}`, {
          headers: { authorization: `Bearer ${token}` },
          method: "POST",
        });
        return album;
      }),
    );

    const deleted = await app.request(`/api/v1/photos/${photo.id}`, {
      headers: { authorization: `Bearer ${token}` },
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);

    const timeline = await app.request("/api/v1/photos", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await timeline.json()).toEqual([]);
    for (const album of albums) {
      const changedAlbum = albumResponseSchema.parse(
        await (
          await app.request(`/api/v1/albums/${album.id}`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).json(),
      );
      expect(changedAlbum.photos).toEqual([]);
    }
    for (const variant of ["original", "preview"]) {
      const response = await app.request(`/api/v1/photos/${photo.id}/${variant}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(404);
    }
    const currentPhotoFiles = database
      .query<{ readonly count: number }, []>(
        `SELECT COUNT(*) AS count
         FROM files AS f
         JOIN file_versions AS v ON v.id = f.current_version_id
         WHERE f.volume_id = 'photos'
           AND v.path LIKE 'photos/%'
           AND v.tombstone = 0`,
      )
      .get();
    expect(currentPhotoFiles?.count).toBe(0);
  });

  test("requires owner authentication and rejects invalid image content", async () => {
    const anonymous = await app.request("/api/v1/photos");
    expect(anonymous.status).toBe(401);

    const invalid = await app.request("/api/v1/photos", {
      body: "not an image",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/jpeg",
        "x-mynas-filename": "invalid.jpg",
      },
      method: "POST",
    });
    expect(invalid.status).toBe(400);

    const oversized = await app.request("/api/v1/photos", {
      body: "small",
      headers: {
        authorization: `Bearer ${token}`,
        "content-length": String(25 * 1_024 * 1_024 + 1),
        "content-type": "image/jpeg",
        "x-mynas-filename": "oversized.jpg",
      },
      method: "POST",
    });
    expect(oversized.status).toBe(413);
  });

  test("accepts HEIC with a directory-relative filename and serves its original type", async () => {
    const uploaded = await app.request("/api/v1/photos", {
      body: exactArrayBuffer(syntheticHeic()),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/heic",
        "x-mynas-filename": encodeURIComponent("여행/제주/IMG_0001.HEIC"),
      },
      method: "POST",
    });
    expect(uploaded.status).toBe(201);
    const ingest = ingestSchema.parse(await uploaded.json());
    expect(ingest.photo).toMatchObject({
      filename: "여행/제주/IMG_0001.HEIC",
      format: "heic",
    });

    const original = await app.request(`/api/v1/photos/${ingest.photo.id}/original`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(original.headers.get("content-type")).toBe("image/heic");
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(
      new Uint8Array(exactArrayBuffer(syntheticHeic())),
    );
  });
});
