import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";

const loginSchema = z.object({ token: z.string().min(32) });
const fileVersionSchema = z.object({
  blob: z
    .object({
      checksum: z.string().length(64),
      key: z.string(),
      size: z.number().int().nonnegative(),
    })
    .nullable(),
  createdAt: z.string(),
  id: z.string().uuid(),
  path: z.string(),
  tombstone: z.boolean(),
});
const listingSchema = z.object({
  entries: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("folder"), path: z.string() }),
      z.object({
        checksum: z.string().length(64),
        createdAt: z.string(),
        kind: z.literal("file"),
        path: z.string(),
        size: z.number().int().nonnegative(),
        versionId: z.string().uuid(),
      }),
    ]),
  ),
  nextCursor: z.string().nullable(),
  prefix: z.string(),
});

const unzipStoredEntries = (archive: Uint8Array): ReadonlyMap<string, string> => {
  const entries = new Map<string, string>();
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const filenameStart = offset + 30;
    const contentsStart = filenameStart + filenameLength + extraLength;
    const filename = decoder.decode(archive.slice(filenameStart, filenameStart + filenameLength));
    entries.set(
      filename,
      decoder.decode(archive.slice(contentsStart, contentsStart + compressedSize)),
    );
    offset = contentsStart + compressedSize;
  }
  return entries;
};

describe("file browsing and recovery API", () => {
  let app: ReturnType<typeof createApp>;
  let database: Database;
  let dataDir: string;
  let diskA: string;
  let diskB: string;
  let token: string;

  const authorized = (): Record<string, string> => ({
    authorization: `Bearer ${token}`,
  });

  const put = async (path: string, contents: string) => {
    const response = await app.request(`/api/v1/files/photos/${path}`, {
      body: contents,
      headers: authorized(),
      method: "PUT",
    });
    expect(response.status).toBe(201);
    return fileVersionSchema.parse(await response.json());
  };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-api-browsing-"));
    diskA = join(dataDir, "disk-a");
    diskB = join(dataDir, "disk-b");
    await Promise.all([mkdir(diskA), mkdir(diskB)]);
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
            headers: { ...authorized(), "content-type": "application/json" },
            method: "POST",
          })
        ).status,
      ).toBe(201);
    }
    expect(
      (
        await app.request("/api/v1/volumes", {
          body: JSON.stringify({ id: "photos", kind: "mirror", members: ["disk-a", "disk-b"] }),
          headers: { ...authorized(), "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(201);
  });

  afterEach(async () => {
    database.close();
    await rm(dataDir, { force: true, recursive: true });
  });

  test("lists current direct children by prefix with deterministic pagination", async () => {
    await put("documents/guides/start.txt", "guide");
    await put("documents/notes.txt", "notes");
    await put("documents/readme.txt", "readme");
    await put("documents/deleted.txt", "deleted");
    expect(
      (
        await app.request("/api/v1/files/photos/documents/deleted.txt", {
          headers: authorized(),
          method: "DELETE",
        })
      ).status,
    ).toBe(204);

    const firstResponse = await app.request(
      "/api/v1/volumes/photos/files?prefix=documents%2F&limit=2",
      { headers: authorized() },
    );
    expect(firstResponse.status).toBe(200);
    const first = listingSchema.parse(await firstResponse.json());
    expect(first).toMatchObject({
      entries: [
        { kind: "folder", path: "documents/guides" },
        { kind: "file", path: "documents/notes.txt", size: 5 },
      ],
      prefix: "documents/",
    });
    expect(first.nextCursor).toBeString();

    const secondResponse = await app.request(
      `/api/v1/volumes/photos/files?prefix=documents%2F&limit=2&cursor=${encodeURIComponent(
        first.nextCursor ?? "",
      )}`,
      { headers: authorized() },
    );
    expect(secondResponse.status).toBe(200);
    expect(listingSchema.parse(await secondResponse.json())).toMatchObject({
      entries: [{ kind: "file", path: "documents/readme.txt", size: 6 }],
      nextCursor: null,
      prefix: "documents/",
    });
  });

  test("rejects unauthenticated and malformed browsing boundaries", async () => {
    expect((await app.request("/api/v1/volumes/photos/files")).status).toBe(401);

    for (const query of [
      "prefix=documents",
      "prefix=..%2F",
      "prefix=%2Fabsolute%2F",
      "prefix=documents%2F%2F",
      "limit=0",
      "limit=101",
      "limit=not-a-number",
      "cursor=not-base64url",
      `cursor=${Buffer.from(JSON.stringify({ path: "documents/readme.txt" })).toString(
        "base64url",
      )}`,
    ]) {
      const response = await app.request(`/api/v1/volumes/photos/files?${query}`, {
        headers: authorized(),
      });
      expect(response.status, query).toBe(400);
    }

    const missing = await app.request("/api/v1/volumes/missing/files", {
      headers: authorized(),
    });
    expect(missing.status).toBe(404);
  });

  test("selects version history from browsing and restores an older file", async () => {
    const original = await put("documents/restore.txt", "original bytes");
    const current = await put("documents/restore.txt", "current bytes");

    const listing = await app.request("/api/v1/volumes/photos/files?prefix=documents%2F&limit=50", {
      headers: authorized(),
    });
    expect(listing.status).toBe(200);
    expect(listingSchema.parse(await listing.json())).toMatchObject({
      entries: [
        {
          kind: "file",
          path: "documents/restore.txt",
          versionId: current.id,
        },
      ],
    });

    const history = await app.request("/api/v1/versions/photos/documents/restore.txt", {
      headers: authorized(),
    });
    expect(history.status).toBe(200);
    expect(
      z
        .array(fileVersionSchema)
        .parse(await history.json())
        .map(({ id }) => id),
    ).toEqual([original.id, current.id]);

    const restored = await app.request("/api/v1/versions/photos/restore", {
      body: JSON.stringify({ path: "documents/restore.txt", versionId: original.id }),
      headers: { ...authorized(), "content-type": "application/json" },
      method: "POST",
    });
    expect(restored.status).toBe(201);
    const restoredVersion = fileVersionSchema.parse(await restored.json());
    expect(restoredVersion.id).not.toBe(original.id);
    expect(restoredVersion.blob).toEqual(original.blob);

    const download = await app.request("/api/v1/files/photos/documents/restore.txt", {
      headers: authorized(),
    });
    expect(await download.text()).toBe("original bytes");
  });

  test("downloads selected files and directories as a path-preserving ZIP", async () => {
    await put("documents/guides/start.txt", "guide");
    await put("documents/notes.txt", "notes");
    await put("other/ignored.txt", "ignored");

    const response = await app.request("/api/v1/volumes/photos/archive", {
      body: JSON.stringify({
        selections: [
          { kind: "folder", path: "documents/guides" },
          { kind: "file", path: "documents/notes.txt" },
        ],
      }),
      headers: { ...authorized(), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("mynas-files.zip");
    expect(unzipStoredEntries(new Uint8Array(await response.arrayBuffer()))).toEqual(
      new Map([
        ["documents/guides/start.txt", "guide"],
        ["documents/notes.txt", "notes"],
      ]),
    );
  });

  test("refuses to restore an unreadable historical blob", async () => {
    const original = await put("documents/missing.txt", "unrecoverable history");
    await put("documents/missing.txt", "current survives");
    if (original.blob === null) {
      throw new Error("uploaded version must have a blob");
    }
    const originalBlob = original.blob;
    await Promise.all([diskA, diskB].map((root) => rm(join(root, ...originalBlob.key.split("/")))));

    const restored = await app.request("/api/v1/versions/photos/restore", {
      body: JSON.stringify({ path: "documents/missing.txt", versionId: original.id }),
      headers: { ...authorized(), "content-type": "application/json" },
      method: "POST",
    });
    expect(restored.status).toBe(503);

    const download = await app.request("/api/v1/files/photos/documents/missing.txt", {
      headers: authorized(),
    });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("current survives");
  });
});
