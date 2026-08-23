import { describe, expect, test } from "bun:test";

import type { CliDependencies, FetchLike } from "../../apps/cli/src/cli";
import { runCli } from "../../apps/cli/src/cli";
import { canonicalManifestBytes } from "../../packages/snapshots/src/service";

const bundleId = "00000000-0000-4000-8000-000000000001";
const chunk = new TextEncoder().encode("encrypted");
const checksum = (contents: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(contents).digest("hex");
const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer =>
  contents.buffer.slice(
    contents.byteOffset,
    contents.byteOffset + contents.byteLength,
  ) as ArrayBuffer;
const manifest = canonicalManifestBytes({
  bundleId,
  chunkCount: 1,
  chunks: [{ checksum: checksum(chunk), index: 0, size: chunk.byteLength }],
  format: "mynas.snapshot-bundle",
  metadata: {},
  totalBytes: chunk.byteLength,
  version: 1,
});
const signature = new Uint8Array(64).fill(4);

type Harness = {
  readonly dependencies: CliDependencies;
  readonly mkdirs: string[];
  readonly output: string[];
  readonly removes: string[];
  readonly renames: [string, string][];
  readonly requests: Request[];
  readonly writes: Map<string, Uint8Array>;
};

const harness = (corruptChunk = false): Harness => {
  const mkdirs: string[] = [];
  const output: string[] = [];
  const removes: string[] = [];
  const renames: [string, string][] = [];
  const requests: Request[] = [];
  const writes = new Map<string, Uint8Array>();
  const mockedFetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (request.url.endsWith("/manifest")) {
      return new Response(exactArrayBuffer(manifest));
    }
    if (request.url.endsWith("/signature")) {
      return new Response(exactArrayBuffer(signature));
    }
    if (request.url.endsWith("/chunks/0")) {
      return new Response(corruptChunk ? "corrupt" : chunk);
    }
    return Response.json([
      {
        completedAt: "2026-01-01T00:00:01.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        expectedChunkCount: 1,
        expectedTotalBytes: chunk.byteLength,
        id: bundleId,
        manifestChecksum: checksum(manifest),
        manifestKey: `_snapshot-bundles/${bundleId}/manifest.json`,
        producerId: "fixture-producer",
        producerKind: "slack-dashboard",
        signatureChecksum: checksum(signature),
        signatureKey: `_snapshot-bundles/${bundleId}/manifest.sig`,
        status: "complete",
        volumeId: "snapshots",
      },
    ]);
  };
  const dependencies: CliDependencies = {
    environment: {
      MYNAS_TOKEN: "synthetic-token",
      MYNAS_URL: "http://127.0.0.1:7331",
    },
    fetch: mockedFetch,
    mkdir: async (path) => {
      mkdirs.push(path);
    },
    readFile: async () => new Uint8Array(),
    readStdin: async () => "",
    remove: async (path) => {
      removes.push(path);
    },
    rename: async (from, to) => {
      renames.push([from, to]);
    },
    stderr: (line) => output.push(`stderr:${line}`),
    stdout: (line) => output.push(line),
    writeFile: async (path, contents) => {
      writes.set(path, contents);
    },
  };
  return { dependencies, mkdirs, output, removes, renames, requests, writes };
};

describe("snapshot bundle CLI", () => {
  test("lists snapshot commands in help", async () => {
    const qa = harness();

    expect(await runCli(["snapshot", "--help"], qa.dependencies)).toBe(0);
    expect(qa.output.join("\n")).toContain("list");
    expect(qa.output.join("\n")).toContain("download");
    expect(qa.output.join("\n")).toContain("delete");
  });

  test("lists complete snapshots with bearer authentication", async () => {
    const qa = harness();

    expect(await runCli(["snapshot", "list"], qa.dependencies)).toBe(0);
    expect(JSON.parse(qa.output[0] ?? "")).toEqual([
      expect.objectContaining({ id: bundleId, status: "complete" }),
    ]);
    expect(qa.requests[0]?.headers.get("authorization")).toBe("Bearer synthetic-token");
  });

  test("downloads verified chunks before publishing the manifest", async () => {
    const qa = harness();

    expect(
      await runCli(["snapshot", "download", bundleId, "/backup/snapshot"], qa.dependencies),
    ).toBe(0);
    expect(qa.mkdirs).toHaveLength(1);
    const chunksDirectory = qa.mkdirs[0] ?? "";
    const staging = chunksDirectory.slice(0, -"/chunks".length);
    expect(qa.writes.get(`${chunksDirectory}/00000000.bin`)).toEqual(chunk);
    expect(qa.writes.get(`${staging}/manifest.sig`)).toEqual(signature);
    expect(qa.writes.get(`${staging}/manifest.json`)).toEqual(manifest);
    expect([...qa.writes.keys()].at(-1)).toBe(`${staging}/manifest.json`);
    expect(qa.renames).toEqual([[staging, "/backup/snapshot"]]);
    expect(qa.removes).toEqual([]);
    expect(qa.requests.every((request) => request.headers.has("authorization"))).toBe(true);
  });

  test("removes staging and refuses publication when a chunk is corrupt", async () => {
    const qa = harness(true);

    expect(
      await runCli(["snapshot", "download", bundleId, "/backup/snapshot"], qa.dependencies),
    ).toBe(1);
    expect(qa.renames).toEqual([]);
    expect(qa.removes).toEqual([(qa.mkdirs[0] ?? "").slice(0, -"/chunks".length)]);
    expect(qa.output.join("\n")).toContain("checksum");
  });

  test("deletes one snapshot through the authenticated API", async () => {
    const qa = harness();

    expect(await runCli(["snapshot", "delete", bundleId], qa.dependencies)).toBe(0);
    expect(qa.requests).toHaveLength(1);
    expect(qa.requests[0]?.method).toBe("DELETE");
    expect(qa.requests[0]?.headers.get("authorization")).toBe("Bearer synthetic-token");
  });
});
