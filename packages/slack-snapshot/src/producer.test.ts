import { describe, expect, test } from "bun:test";

import {
  decryptChunk,
  generateSigningKeyPair,
  verifyManifestSignature,
} from "../../snapshots/src/crypto";
import { parseCanonicalManifest, sha256 } from "../../snapshots/src/manifest";
import {
  SlackSnapshotProducer,
  type SnapshotProducerStage,
  type SnapshotUploadClient,
} from "./producer";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MemoryStage implements SnapshotProducerStage {
  public readonly chunks = new Map<number, Uint8Array>();
  public removed = false;

  public async readChunk(index: number): Promise<Uint8Array> {
    const contents = this.chunks.get(index);
    if (contents === undefined) {
      throw new Error("missing staged chunk");
    }
    return contents;
  }

  public async remove(): Promise<void> {
    this.removed = true;
  }

  public async writeChunk(index: number, contents: Uint8Array): Promise<void> {
    this.chunks.set(index, contents);
  }
}

const source = async function* (): AsyncIterable<Uint8Array> {
  yield encoder.encode("mysql-dump\n");
  yield encoder.encode("artifact-data\n");
};

describe("SlackSnapshotProducer", () => {
  test("stages only ciphertext and commits the signed manifest last", async () => {
    const calls: string[] = [];
    const stage = new MemoryStage();
    let completedManifest: Uint8Array = new Uint8Array();
    let completedSignature: Uint8Array = new Uint8Array();
    const client: SnapshotUploadClient = {
      begin: async () => {
        calls.push("begin");
        return { id: "00000000-0000-4000-8000-000000000001" };
      },
      complete: async (_id, manifest, signature) => {
        completedManifest = manifest;
        completedSignature = signature;
        calls.push("complete");
      },
      uploadChunk: async (_id, index, contents) => {
        expect(sha256(contents)).toMatch(/^[a-f0-9]{64}$/);
        calls.push(`chunk:${index}`);
      },
    };
    const signing = await generateSigningKeyPair();
    const root = crypto.getRandomValues(new Uint8Array(32));
    const producer = new SlackSnapshotProducer({
      client,
      createSnapshotId: () => "00112233445566778899aabbccddeeff",
      createStage: async () => stage,
      encryptionKeyId: "enc-v1",
      encryptionRoot: root,
      plaintextChunkBytes: 8,
      signingKeyId: "sig-v1",
      signingPrivateKey: signing.privateKey,
      withLock: async (operation) => operation(),
    });

    const result = await producer.create(source());

    expect(calls).toEqual(["begin", "chunk:0", "chunk:1", "chunk:2", "chunk:3", "complete"]);
    expect(result.bundleId).toBe("00000000-0000-4000-8000-000000000001");
    expect(stage.removed).toBe(true);
    expect(
      [...stage.chunks.values()].every(
        (contents) => !decoder.decode(contents).includes("mysql-dump"),
      ),
    ).toBe(true);
    const manifest = parseCanonicalManifest(completedManifest);
    expect(result.totalBytes).toBe(manifest.totalBytes);
    expect(manifest.metadata).toEqual({
      encryptionKeyId: "enc-v1",
      signingKeyId: "sig-v1",
      snapshotId: "00112233445566778899aabbccddeeff",
      source: "slack-dashboard",
    });
    expect(
      await verifyManifestSignature(signing.publicKey, completedManifest, completedSignature),
    ).toBe(true);
    const decrypted = await Promise.all(
      manifest.chunks.map(async (chunk) =>
        decryptChunk({
          encrypted: stage.chunks.get(chunk.index) ?? new Uint8Array(),
          encryptionKeyId: "enc-v1",
          index: chunk.index,
          root,
          snapshotId: "00112233445566778899aabbccddeeff",
        }),
      ),
    );
    expect(decoder.decode(Buffer.concat(decrypted))).toBe("mysql-dump\nartifact-data\n");
  });

  test("cleans encrypted staging when upload fails", async () => {
    const stage = new MemoryStage();
    const signing = await generateSigningKeyPair();
    const producer = new SlackSnapshotProducer({
      client: {
        begin: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
        complete: async () => undefined,
        uploadChunk: async () => {
          throw new Error("upload failed");
        },
      },
      createSnapshotId: () => "00112233445566778899aabbccddeeff",
      createStage: async () => stage,
      encryptionKeyId: "enc-v1",
      encryptionRoot: new Uint8Array(32),
      plaintextChunkBytes: 8,
      signingKeyId: "sig-v1",
      signingPrivateKey: signing.privateKey,
      withLock: async (operation) => operation(),
    });

    await expect(producer.create(source())).rejects.toThrow("upload failed");
    expect(stage.removed).toBe(true);
  });

  test("rejects overlapping runs before consuming the second source", async () => {
    let active = false;
    let releaseFirst: () => void = () => undefined;
    let reportFirst: () => void = () => undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      reportFirst = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const signing = await generateSigningKeyPair();
    const producer = new SlackSnapshotProducer({
      client: {
        begin: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
        complete: async () => undefined,
        uploadChunk: async () => undefined,
      },
      createSnapshotId: () => "00112233445566778899aabbccddeeff",
      createStage: async () => new MemoryStage(),
      encryptionKeyId: "enc-v1",
      encryptionRoot: new Uint8Array(32),
      plaintextChunkBytes: 8,
      signingKeyId: "sig-v1",
      signingPrivateKey: signing.privateKey,
      withLock: async (operation) => {
        if (active) {
          throw new Error("snapshot run already active");
        }
        active = true;
        try {
          return await operation();
        } finally {
          active = false;
        }
      },
    });
    const blockedSource = async function* (): AsyncIterable<Uint8Array> {
      reportFirst();
      await release;
      yield encoder.encode("first");
    };

    const first = producer.create(blockedSource());
    await firstBlocked;
    await expect(producer.create(source())).rejects.toThrow("already active");
    releaseFirst();
    await first;
  });
});
