import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";
import { syntheticJpeg } from "../fixtures/synthetic-photo";

const loginSchema = z.object({ token: z.string().min(32) });
const photoSchema = z.object({ photo: z.object({ id: z.string().uuid() }) });
const activitySchema = z.array(
  z.object({
    action: z.string(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    id: z.string().uuid(),
    occurredAt: z.iso.datetime(),
    outcome: z.enum(["failure", "success"]),
    resource: z
      .object({
        kind: z.string(),
        path: z.string(),
      })
      .nullable(),
  }),
);

const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  return buffer;
};

describe("activity API", () => {
  let app: ReturnType<typeof createApp>;
  let database: Database;
  let dataDir: string;
  let token: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-api-activity-"));
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
      expect(
        (
          await app.request("/api/v1/backends", {
            body: JSON.stringify({ id, kind: "local", root }),
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            method: "POST",
          })
        ).status,
      ).toBe(201);
    }
    expect(
      (
        await app.request("/api/v1/volumes", {
          body: JSON.stringify({ id: "photos", kind: "mirror", members: ["disk-a", "disk-b"] }),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
        })
      ).status,
    ).toBe(201);
  });

  afterEach(async () => {
    database.close();
    await rm(dataDir, { force: true, recursive: true });
  });

  test("persists authenticated transfer success and failure newest first", async () => {
    const upload = await app.request("/api/v1/files/photos/reports/quarterly.txt", {
      body: "report contents",
      headers: { authorization: `Bearer ${token}` },
      method: "PUT",
    });
    expect(upload.status).toBe(201);

    const fileArchive = await app.request("/api/v1/volumes/photos/archive", {
      body: JSON.stringify({
        selections: [{ kind: "file", path: "reports/quarterly.txt" }],
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(fileArchive.status).toBe(200);

    const photoUpload = await app.request("/api/v1/photos", {
      body: exactArrayBuffer(syntheticJpeg()),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/jpeg",
        "x-mynas-filename": "activity-photo.jpg",
      },
      method: "POST",
    });
    expect(photoUpload.status).toBe(201);
    const photoId = photoSchema.parse(await photoUpload.json()).photo.id;
    expect(
      (
        await app.request(`/api/v1/photos/${photoId}/original`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/api/v1/photos/archive", {
          body: JSON.stringify({ photoIds: [photoId] }),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
        })
      ).status,
    ).toBe(200);

    const missingDownload = await app.request("/api/v1/files/photos/reports/missing.txt", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missingDownload.status).toBe(404);

    const activity = await app.request("/api/activity", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(activity.status).toBe(200);
    const events = activitySchema.parse(await activity.json());
    expect(events).toEqual([
      expect.objectContaining({
        action: "file.download",
        errorCode: "not_found",
        outcome: "failure",
        resource: { kind: "file", path: "reports/missing.txt" },
      }),
      expect.objectContaining({
        action: "photo.archive.download",
        outcome: "success",
      }),
      expect.objectContaining({
        action: "photo.download",
        outcome: "success",
      }),
      expect.objectContaining({
        action: "photo.upload",
        outcome: "success",
      }),
      expect.objectContaining({
        action: "file.archive.download",
        outcome: "success",
      }),
      expect.objectContaining({
        action: "file.upload",
        errorCode: null,
        outcome: "success",
        resource: { kind: "file", path: "reports/quarterly.txt" },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("synthetic owner passphrase");
    expect(JSON.stringify(events)).not.toContain(dataDir);

    app = createApp({ dataDir, database, environment: {} });
    const reloaded = await app.request("/api/v1/activity", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reloaded.status).toBe(200);
    expect(activitySchema.parse(await reloaded.json())).toEqual(events);
  });

  test("requires authentication", async () => {
    expect((await app.request("/api/v1/activity")).status).toBe(401);
    expect((await app.request("/api/activity")).status).toBe(401);
  });
});
