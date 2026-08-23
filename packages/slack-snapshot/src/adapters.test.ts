import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFilesystemStage,
  HttpSnapshotDownloadClient,
  HttpSnapshotUploadClient,
} from "./adapters";

const temporaryPaths: string[] = [];
const bytes = new TextEncoder().encode("encrypted chunk");

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Slack snapshot adapters", () => {
  test("stores only private encrypted staging files and removes them", async () => {
    const parent = await mkdtemp(join(tmpdir(), "slack-snapshot-stage-parent-"));
    temporaryPaths.push(parent);
    const stage = await createFilesystemStage(parent);

    await stage.writeChunk(0, bytes);
    expect(await stage.readChunk(0)).toEqual(bytes);
    expect((await stat(stage.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(stage.directory, "00000000.bin"))).mode & 0o777).toBe(0o600);
    await stage.remove();
    await expect(stat(stage.directory)).rejects.toThrow();
  });

  test("uses bearer authentication and exact manifest-last API requests", async () => {
    const requests: Request[] = [];
    const client = new HttpSnapshotUploadClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return request.url.endsWith("/snapshot-bundles")
          ? Response.json({ id: "00000000-0000-4000-8000-000000000001" }, { status: 201 })
          : new Response(null, { status: 200 });
      },
      producerId: "fixture-producer",
      producerKind: "slack-dashboard",
      token: "secret-token",
      url: "http://127.0.0.1:7331",
      volumeId: "slack-backups",
    });

    const bundle = await client.begin({ chunkCount: 1, totalBytes: bytes.byteLength });
    await client.uploadChunk(bundle.id, 0, bytes);
    await client.complete(bundle.id, new TextEncoder().encode("{}"), new Uint8Array(64));

    expect(requests.map(({ method, url }) => [method, new URL(url).pathname])).toEqual([
      ["POST", "/api/v1/snapshot-bundles"],
      ["PUT", `/api/v1/snapshot-bundles/${bundle.id}/chunks/0`],
      ["PUT", `/api/v1/snapshot-bundles/${bundle.id}/manifest`],
    ]);
    expect(
      requests.every((request) => request.headers.get("authorization") === "Bearer secret-token"),
    ).toBe(true);
    expect(requests[1]?.headers.get("x-mynas-sha256")).toMatch(/^[a-f0-9]{64}$/);
    expect(requests[2]?.headers.get("x-mynas-signature")).toBe(
      Buffer.from(new Uint8Array(64)).toString("base64"),
    );
  });

  test("downloads manifest, signature, and selected encrypted chunks", async () => {
    const paths: string[] = [];
    const client = new HttpSnapshotDownloadClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        paths.push(new URL(request.url).pathname);
        expect(request.headers.get("authorization")).toBe("Bearer secret-token");
        return new Response(bytes);
      },
      producerId: "unused",
      producerKind: "unused",
      token: "secret-token",
      url: "http://127.0.0.1:7331",
      volumeId: "unused",
    });

    expect(await client.readManifest("00000000-0000-4000-8000-000000000001")).toEqual(bytes);
    expect(await client.readSignature("00000000-0000-4000-8000-000000000001")).toEqual(bytes);
    expect(await client.readChunk("00000000-0000-4000-8000-000000000001", 3)).toEqual(bytes);
    expect(paths).toEqual([
      "/api/v1/snapshot-bundles/00000000-0000-4000-8000-000000000001/manifest",
      "/api/v1/snapshot-bundles/00000000-0000-4000-8000-000000000001/signature",
      "/api/v1/snapshot-bundles/00000000-0000-4000-8000-000000000001/chunks/3",
    ]);
  });
});
