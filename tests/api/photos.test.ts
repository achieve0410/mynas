import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";
import { syntheticHeic, syntheticJpeg, syntheticJpegSha256 } from "../fixtures/synthetic-photo";

const loginSchema = z.object({ token: z.string().min(32) });
const photoSchema = z.object({
  checksum: z.string().length(64),
  filename: z.string(),
  format: z.enum(["heic", "jpeg", "png"]),
  height: z.number().int().positive(),
  id: z.string().uuid(),
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
