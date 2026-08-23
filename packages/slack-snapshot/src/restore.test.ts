import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decryptChunk,
  encryptChunk,
  generateSigningKeyPair,
  signManifest,
} from "../../snapshots/src/crypto";
import { canonicalJsonBytes, canonicalManifestBytes, sha256 } from "../../snapshots/src/manifest";
import type { SnapshotManifest } from "../../snapshots/src/models";
import { encodeArchive, type SnapshotArchiveRecord } from "./archive";
import { restoreSnapshot, type SnapshotDownloadClient } from "./restore";

const encoder = new TextEncoder();
const temporaryPaths: string[] = [];
const bundleId = "00000000-0000-4000-8000-000000000001";
const snapshotId = "00112233445566778899aabbccddeeff";

const bytes = async (source: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of source) {
    parts.push(part);
    size += part.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const record = (path: string, contents: string): SnapshotArchiveRecord => ({
  contents: (async function* () {
    yield encoder.encode(contents);
  })(),
  mode: 0o600,
  path,
});

const fixture = async (records: readonly SnapshotArchiveRecord[]) => {
  const root = Uint8Array.fromHex(
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  );
  const keys = await generateSigningKeyPair();
  const plaintext = await bytes(encodeArchive(records));
  const chunk = await encryptChunk({
    encryptionKeyId: "enc-v1",
    index: 0,
    plaintext,
    root,
    snapshotId,
  });
  const manifest: SnapshotManifest = {
    bundleId,
    chunkCount: 1,
    chunks: [{ checksum: sha256(chunk), index: 0, size: chunk.byteLength }],
    format: "mynas.snapshot-bundle",
    metadata: {
      encryptionKeyId: "enc-v1",
      signingKeyId: sha256(keys.publicKey),
      snapshotId,
      source: "slack-dashboard",
    },
    totalBytes: chunk.byteLength,
    version: 1,
  };
  const manifestBytes = canonicalManifestBytes(manifest);
  const signature = await signManifest(keys.privateKey, manifestBytes);
  return { chunk, keys, manifest: manifestBytes, root, signature };
};

const clientFor = (
  value: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<{
    readonly chunk: Uint8Array;
    readonly manifest: Uint8Array;
    readonly signature: Uint8Array;
  }> = {},
): SnapshotDownloadClient => ({
  readChunk: async () => overrides.chunk ?? value.chunk,
  readManifest: async () => overrides.manifest ?? value.manifest,
  readSignature: async () => overrides.signature ?? value.signature,
});

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Slack snapshot restore", () => {
  test("verifies, decrypts, and atomically materializes an isolated destination", async () => {
    const parent = await mkdtemp(join(tmpdir(), "slack-snapshot-restore-"));
    temporaryPaths.push(parent);
    const destination = join(parent, "restored");
    const value = await fixture([
      record("mysql/slack-dashboard.sql", "CREATE TABLE restored (id int);\n"),
      record("platform-artifacts/report.txt", "verified"),
    ]);

    await restoreSnapshot({
      bundleId,
      client: clientFor(value),
      destination,
      encryptionRoot: value.root,
      signingPublicKey: value.keys.publicKey,
    });

    expect(await readFile(join(destination, "mysql/slack-dashboard.sql"), "utf8")).toContain(
      "CREATE TABLE restored",
    );
    expect(await readFile(join(destination, "platform-artifacts/report.txt"), "utf8")).toBe(
      "verified",
    );
    expect((await stat(join(destination, "mysql/slack-dashboard.sql"))).mode & 0o777).toBe(0o600);
  });

  test("fails closed and publishes nothing for signature, chunk, root, and key mutations", async () => {
    const parent = await mkdtemp(join(tmpdir(), "slack-snapshot-tamper-"));
    temporaryPaths.push(parent);
    const value = await fixture([record("mysql/slack-dashboard.sql", "verified")]);
    const mutations = [
      {
        client: clientFor(value, {
          signature: Uint8Array.from(value.signature, (byte, index) => byte ^ Number(index === 0)),
        }),
        root: value.root,
        signingPublicKey: value.keys.publicKey,
      },
      {
        client: clientFor(value, {
          chunk: Uint8Array.from(value.chunk, (byte, index) => byte ^ Number(index === 10)),
        }),
        root: value.root,
        signingPublicKey: value.keys.publicKey,
      },
      {
        client: clientFor(value),
        root: Uint8Array.from(value.root, (byte, index) => byte ^ Number(index === 0)),
        signingPublicKey: value.keys.publicKey,
      },
      {
        client: clientFor(value),
        root: value.root,
        signingPublicKey: (await generateSigningKeyPair()).publicKey,
      },
    ];

    for (const [index, mutation] of mutations.entries()) {
      const destination = join(parent, String(index));
      await expect(
        restoreSnapshot({
          bundleId,
          client: mutation.client,
          destination,
          encryptionRoot: mutation.root,
          signingPublicKey: mutation.signingPublicKey,
        }),
      ).rejects.toThrow();
      await expect(stat(destination)).rejects.toThrow();
    }
  });

  test("rejects an encrypted traversal path without writing outside the destination", async () => {
    const parent = await mkdtemp(join(tmpdir(), "slack-snapshot-path-"));
    temporaryPaths.push(parent);
    const value = await fixture([record("good", "payload")]);
    const plaintext = await bytes(
      (async function* () {
        const decrypted = await decryptChunk({
          encrypted: value.chunk,
          encryptionKeyId: "enc-v1",
          index: 0,
          root: value.root,
          snapshotId,
        });
        const text = new TextDecoder().decode(decrypted).replace('"good"', '"../x"');
        yield encoder.encode(text);
      })(),
    );
    const chunk = await encryptChunk({
      encryptionKeyId: "enc-v1",
      index: 0,
      plaintext,
      root: value.root,
      snapshotId,
    });
    const parsed = JSON.parse(new TextDecoder().decode(value.manifest)) as SnapshotManifest;
    const manifest = canonicalManifestBytes({
      ...parsed,
      chunks: [{ checksum: sha256(chunk), index: 0, size: chunk.byteLength }],
      totalBytes: chunk.byteLength,
    });
    const signature = await signManifest(value.keys.privateKey, manifest);
    await expect(
      restoreSnapshot({
        bundleId,
        client: clientFor(value, { chunk, manifest, signature }),
        destination: join(parent, "restore"),
        encryptionRoot: value.root,
        signingPublicKey: value.keys.publicKey,
      }),
    ).rejects.toThrow("unsafe");
    await expect(stat(join(parent, "x"))).rejects.toThrow();
    await expect(stat(join(parent, "restore"))).rejects.toThrow();
  });

  test("rejects incompatible manifests and missing chunks without publishing", async () => {
    const parent = await mkdtemp(join(tmpdir(), "slack-snapshot-incomplete-"));
    temporaryPaths.push(parent);
    const value = await fixture([record("mysql/slack-dashboard.sql", "verified")]);
    const parsed = JSON.parse(new TextDecoder().decode(value.manifest)) as SnapshotManifest;
    const incompatibleManifest = canonicalJsonBytes({ ...parsed, version: 2 });
    const incompatibleSignature = await signManifest(value.keys.privateKey, incompatibleManifest);
    await expect(
      restoreSnapshot({
        bundleId,
        client: clientFor(value, {
          manifest: incompatibleManifest,
          signature: incompatibleSignature,
        }),
        destination: join(parent, "incompatible"),
        encryptionRoot: value.root,
        signingPublicKey: value.keys.publicKey,
      }),
    ).rejects.toThrow();
    await expect(
      restoreSnapshot({
        bundleId,
        client: {
          ...clientFor(value),
          readChunk: async () => {
            throw new Error("snapshot chunk not found");
          },
        },
        destination: join(parent, "missing"),
        encryptionRoot: value.root,
        signingPublicKey: value.keys.publicKey,
      }),
    ).rejects.toThrow("not found");
    await expect(stat(join(parent, "incompatible"))).rejects.toThrow();
    await expect(stat(join(parent, "missing"))).rejects.toThrow();
  });
});
