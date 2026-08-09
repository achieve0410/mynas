import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";

const loginSchema = z.object({ token: z.string().min(32) });
const storedSchema = z.object({
  blob: z.object({ checksum: z.string().length(64), key: z.string(), size: z.number() }),
  id: z.string().uuid(),
  path: z.string(),
});

const bodyText = (contents: ArrayBuffer): string =>
  new TextDecoder().decode(new Uint8Array(contents));

describe("backend, mirror volume, and file API", () => {
  let app: ReturnType<typeof createApp>;
  let database: Database;
  let dataDir: string;
  let diskA: string;
  let diskB: string;
  let token: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-api-files-"));
    diskA = join(dataDir, "disk-a");
    diskB = join(dataDir, "disk-b");
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

    const listedBackends = await app.request("/api/v1/backends", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listedBackends.status).toBe(200);
    const backendSummaries = (await listedBackends.json()) as readonly Record<string, unknown>[];
    expect(backendSummaries).toEqual([
      expect.objectContaining({ id: "disk-a", kind: "local", status: "healthy" }),
      expect.objectContaining({ id: "disk-b", kind: "local", status: "healthy" }),
    ]);
    for (const backend of backendSummaries) {
      expect(backend.capacityBytes).toBeNumber();
      expect(backend.availableBytes).toBeNumber();
    }

    const listedVolumes = await app.request("/api/v1/volumes", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listedVolumes.status).toBe(200);
    expect(await listedVolumes.json()).toEqual([
      { id: "photos", kind: "mirror", members: ["disk-a", "disk-b"] },
    ]);
  });

  afterEach(async () => {
    database.close();
    await rm(dataDir, { force: true, recursive: true });
  });

  test("uploads, downloads, ranges, ETags, versions, and deletion", async () => {
    const upload = await app.request("/api/v1/files/photos/docs/readme.bin", {
      body: "0123456789",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      method: "PUT",
    });
    expect(upload.status).toBe(201);
    const stored = storedSchema.parse(await upload.json());

    const download = await app.request("/api/v1/files/photos/docs/readme.bin", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("0123456789");
    expect(download.headers.get("cache-control")).toBe("no-store");
    expect(download.headers.get("etag")).toBe(`"sha256:${stored.blob.checksum}"`);

    const range = await app.request("/api/v1/files/photos/docs/readme.bin", {
      headers: {
        authorization: `Bearer ${token}`,
        range: "bytes=2-5",
      },
    });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe("2345");
    expect(range.headers.get("content-range")).toBe("bytes 2-5/10");

    const invalidRange = await app.request("/api/v1/files/photos/docs/readme.bin", {
      headers: {
        authorization: `Bearer ${token}`,
        range: "bytes=10-11",
      },
    });
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get("content-range")).toBe("bytes */10");

    const oversized = await app.request("/api/v1/files/photos/docs/oversized.bin", {
      body: "small",
      headers: {
        authorization: `Bearer ${token}`,
        "content-length": String(64 * 1_024 * 1_024 + 1),
        "content-type": "application/octet-stream",
      },
      method: "PUT",
    });
    expect(oversized.status).toBe(413);

    const versions = await app.request("/api/v1/versions/photos/docs/readme.bin", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await versions.json()).toHaveLength(1);

    const removed = await app.request("/api/v1/files/photos/docs/readme.bin", {
      headers: { authorization: `Bearer ${token}` },
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect(
      (
        await app.request("/api/v1/files/photos/docs/readme.bin", {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(404);
  });

  test("scrubs, repairs, reports degradation, and refuses a degraded write", async () => {
    const upload = await app.request("/api/v1/files/photos/fixture.bin", {
      body: "verified-bytes",
      headers: { authorization: `Bearer ${token}` },
      method: "PUT",
    });
    const stored = storedSchema.parse(await upload.json());
    await writeFile(join(diskA, ...stored.blob.key.split("/")), "corrupt");

    const scrub = await app.request("/api/v1/volumes/photos/scrub", {
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
    });
    expect(await scrub.json()).toMatchObject({ corrupt: 1, unrecoverable: 0 });

    const repair = await app.request("/api/v1/volumes/photos/repair", {
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
    });
    expect(await repair.json()).toEqual({ repaired: 1, unrecoverable: 0 });

    await rename(diskB, join(dataDir, "disk-b-unmounted"));
    await mkdir(diskB);
    const health = await app.request("/api/v1/volumes/photos/status", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await health.json()).toMatchObject({ status: "degraded", unavailable: ["disk-b"] });

    const refused = await app.request("/api/v1/files/photos/refused.bin", {
      body: "must-fail",
      headers: { authorization: `Bearer ${token}` },
      method: "PUT",
    });
    expect(refused.status).toBe(409);

    const repairedDownload = await app.request("/api/v1/files/photos/fixture.bin", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bodyText(await repairedDownload.arrayBuffer())).toBe("verified-bytes");
  });

  test("returns domain statuses for unavailable and racing backend registration", async () => {
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const missing = await app.request("/api/v1/backends", {
      body: JSON.stringify({ id: "missing", kind: "local", root: join(dataDir, "absent") }),
      headers,
      method: "POST",
    });
    expect(missing.status).toBe(503);

    const request = () =>
      app.request("/api/v1/backends", {
        body: JSON.stringify({ id: "race", kind: "local", root: diskA }),
        headers,
        method: "POST",
      });
    const statuses = (await Promise.all([request(), request()])).map(({ status }) => status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  test("rejects mirror aliases of one physical backend", async () => {
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const alias = await app.request("/api/v1/backends", {
      body: JSON.stringify({ id: "disk-a-alias", kind: "local", root: diskA }),
      headers,
      method: "POST",
    });
    expect(alias.status).toBe(201);
    const mirror = await app.request("/api/v1/volumes", {
      body: JSON.stringify({
        id: "unsafe",
        kind: "mirror",
        members: ["disk-a", "disk-a-alias"],
      }),
      headers,
      method: "POST",
    });
    expect(mirror.status).toBe(400);
  });
});
