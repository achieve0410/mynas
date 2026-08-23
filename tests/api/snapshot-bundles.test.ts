import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";
import { canonicalManifestBytes } from "../../packages/snapshots/src/service";

const loginSchema = z.object({ token: z.string().min(32) });
const bundleSchema = z.object({
  id: z.uuid(),
  status: z.enum(["uploading", "complete", "deleting"]),
});
const checksum = (contents: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(contents).digest("hex");
const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer =>
  contents.buffer.slice(
    contents.byteOffset,
    contents.byteOffset + contents.byteLength,
  ) as ArrayBuffer;

describe("snapshot bundle API", () => {
  let app: ReturnType<typeof createApp>;
  let dataDir: string;
  let database: Database;
  let diskA: string;
  let diskB: string;
  let token: string;

  const authenticated = (headers: Record<string, string> = {}): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    ...headers,
  });

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-api-snapshots-"));
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
      expect(
        (
          await app.request("/api/v1/backends", {
            body: JSON.stringify({ id, kind: "local", root }),
            headers: authenticated({ "content-type": "application/json" }),
            method: "POST",
          })
        ).status,
      ).toBe(201);
    }
    expect(
      (
        await app.request("/api/v1/volumes", {
          body: JSON.stringify({
            id: "snapshots",
            kind: "mirror",
            members: ["disk-a", "disk-b"],
          }),
          headers: authenticated({ "content-type": "application/json" }),
          method: "POST",
        })
      ).status,
    ).toBe(201);
  });

  afterEach(async () => {
    database.close();
    await rm(dataDir, { force: true, recursive: true });
  });

  test("uploads, finalizes, lists, and downloads one complete mirrored bundle", async () => {
    const chunk = new TextEncoder().encode("encrypted");
    const started = await app.request("/api/v1/snapshot-bundles", {
      body: JSON.stringify({
        chunkCount: 1,
        producerId: "fixture-producer",
        producerKind: "slack-dashboard",
        totalBytes: chunk.byteLength,
        volumeId: "snapshots",
      }),
      headers: authenticated({ "content-type": "application/json" }),
      method: "POST",
    });
    expect(started.status).toBe(201);
    const bundle = bundleSchema.parse(await started.json());
    expect(bundle.status).toBe("uploading");

    const uploaded = await app.request(`/api/v1/snapshot-bundles/${bundle.id}/chunks/0`, {
      body: chunk,
      headers: authenticated({
        "content-type": "application/octet-stream",
        "x-mynas-sha256": checksum(chunk),
      }),
      method: "PUT",
    });
    expect(uploaded.status).toBe(201);
    expect(
      await (
        await app.request("/api/v1/snapshot-bundles", {
          headers: authenticated(),
        })
      ).json(),
    ).toEqual([]);

    const manifest = canonicalManifestBytes({
      bundleId: bundle.id,
      chunkCount: 1,
      chunks: [{ checksum: checksum(chunk), index: 0, size: chunk.byteLength }],
      format: "mynas.snapshot-bundle",
      metadata: { source: "api-test" },
      totalBytes: chunk.byteLength,
      version: 1,
    });
    const signature = new Uint8Array(64).fill(3);
    const completed = await app.request(`/api/v1/snapshot-bundles/${bundle.id}/manifest`, {
      body: exactArrayBuffer(manifest),
      headers: authenticated({
        "content-type": "application/json",
        "x-mynas-signature": Buffer.from(signature).toString("base64"),
      }),
      method: "PUT",
    });
    expect(completed.status).toBe(200);
    expect(bundleSchema.parse(await completed.json()).status).toBe("complete");
    expect(
      database
        .query<{ readonly count: number }, []>(
          `SELECT COUNT(*) AS count FROM activity_events
           WHERE action = 'snapshot-bundle.complete' AND outcome = 'success'`,
        )
        .get(),
    ).toEqual({ count: 1 });

    const listed = await app.request("/api/v1/snapshot-bundles", {
      headers: authenticated(),
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([expect.objectContaining({ id: bundle.id })]);
    const downloaded = await app.request(`/api/v1/snapshot-bundles/${bundle.id}/chunks/0`, {
      headers: authenticated(),
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("etag")).toBe(`"sha256:${checksum(chunk)}"`);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(chunk);
    expect(
      new Uint8Array(
        await readFile(join(diskA, `_snapshot-bundles/${bundle.id}/chunks/00000000.bin`)),
      ),
    ).toEqual(chunk);
    expect(
      new Uint8Array(
        await readFile(join(diskB, `_snapshot-bundles/${bundle.id}/chunks/00000000.bin`)),
      ),
    ).toEqual(chunk);
    const files = await app.request("/api/v1/volumes/snapshots/files", {
      headers: authenticated(),
    });
    expect(files.status).toBe(200);
    expect(await files.json()).toEqual({ entries: [], nextCursor: null, prefix: "" });
  });

  test("requires authentication and leaves malformed uploads unpublished", async () => {
    expect(
      (
        await app.request("/api/v1/snapshot-bundles", {
          body: "{}",
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(401);
    const started = await app.request("/api/v1/snapshot-bundles", {
      body: JSON.stringify({
        chunkCount: 1,
        producerId: "fixture-producer",
        producerKind: "slack-dashboard",
        totalBytes: 9,
        volumeId: "snapshots",
      }),
      headers: authenticated({ "content-type": "application/json" }),
      method: "POST",
    });
    const bundle = bundleSchema.parse(await started.json());
    const wrongChecksum = await app.request(`/api/v1/snapshot-bundles/${bundle.id}/chunks/0`, {
      body: "encrypted",
      headers: authenticated({
        "content-type": "application/octet-stream",
        "x-mynas-sha256": "0".repeat(64),
      }),
      method: "PUT",
    });
    expect(wrongChecksum.status).toBe(422);
    expect(
      (
        await app.request(`/api/v1/snapshot-bundles/${bundle.id}/manifest`, {
          body: exactArrayBuffer(
            canonicalManifestBytes({
              bundleId: bundle.id,
              chunkCount: 1,
              chunks: [{ checksum: "0".repeat(64), index: 0, size: 9 }],
              format: "mynas.snapshot-bundle",
              metadata: {},
              totalBytes: 9,
              version: 1,
            }),
          ),
          headers: authenticated({
            "content-type": "application/json",
            "x-mynas-signature": Buffer.from(new Uint8Array(64)).toString("base64"),
          }),
          method: "PUT",
        })
      ).status,
    ).toBe(422);
    expect(
      await (await app.request("/api/v1/snapshot-bundles", { headers: authenticated() })).json(),
    ).toEqual([]);
  });
});
