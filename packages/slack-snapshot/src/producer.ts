import { encryptChunk, signManifest } from "../../snapshots/src/crypto";
import { canonicalManifestBytes, sha256 } from "../../snapshots/src/manifest";
import type { SnapshotManifest } from "../../snapshots/src/models";

export type SnapshotProducerStage = {
  readChunk(index: number): Promise<Uint8Array>;
  remove(): Promise<void>;
  writeChunk(index: number, contents: Uint8Array): Promise<void>;
};

export type SnapshotUploadClient = {
  begin(input: {
    readonly chunkCount: number;
    readonly totalBytes: number;
  }): Promise<{ readonly id: string }>;
  complete(id: string, manifest: Uint8Array, signature: Uint8Array): Promise<void>;
  uploadChunk(id: string, index: number, contents: Uint8Array): Promise<void>;
};

type ProducerOptions = {
  readonly client: SnapshotUploadClient;
  readonly createSnapshotId: () => string;
  readonly createStage: () => Promise<SnapshotProducerStage>;
  readonly encryptionKeyId: string;
  readonly encryptionRoot: Uint8Array;
  readonly plaintextChunkBytes: number;
  readonly signingKeyId: string;
  readonly signingPrivateKey: Uint8Array;
  readonly withLock: <Result>(operation: () => Promise<Result>) => Promise<Result>;
};

type StagedChunk = {
  readonly checksum: string;
  readonly index: number;
  readonly size: number;
};

const concatenate = (first: Uint8Array, second: Uint8Array): Uint8Array => {
  const result = new Uint8Array(first.byteLength + second.byteLength);
  result.set(first);
  result.set(second, first.byteLength);
  return result;
};

export class SlackSnapshotProducer {
  public constructor(private readonly options: ProducerOptions) {
    if (!Number.isInteger(options.plaintextChunkBytes) || options.plaintextChunkBytes <= 0) {
      throw new Error("plaintext chunk size must be a positive integer");
    }
  }

  public create(
    source: AsyncIterable<Uint8Array>,
  ): Promise<{ readonly bundleId: string; readonly snapshotId: string }> {
    return this.options.withLock(async () => this.createUnlocked(source));
  }

  private async createUnlocked(
    source: AsyncIterable<Uint8Array>,
  ): Promise<{ readonly bundleId: string; readonly snapshotId: string }> {
    const stage = await this.options.createStage();
    const snapshotId = this.options.createSnapshotId();
    try {
      const chunks = await this.encryptSource(source, stage, snapshotId);
      if (chunks.length === 0) {
        throw new Error("snapshot source produced no bytes");
      }
      const totalBytes = chunks.reduce((total, chunk) => total + chunk.size, 0);
      const bundle = await this.options.client.begin({
        chunkCount: chunks.length,
        totalBytes,
      });
      const manifest = canonicalManifestBytes(
        this.manifest(bundle.id, snapshotId, chunks, totalBytes),
      );
      const signature = await signManifest(this.options.signingPrivateKey, manifest);
      for (const chunk of chunks) {
        await this.options.client.uploadChunk(
          bundle.id,
          chunk.index,
          await stage.readChunk(chunk.index),
        );
      }
      await this.options.client.complete(bundle.id, manifest, signature);
      return { bundleId: bundle.id, snapshotId };
    } finally {
      await stage.remove();
    }
  }

  private async encryptSource(
    source: AsyncIterable<Uint8Array>,
    stage: SnapshotProducerStage,
    snapshotId: string,
  ): Promise<readonly StagedChunk[]> {
    const chunks: StagedChunk[] = [];
    let pending: Uint8Array = new Uint8Array();
    for await (const part of source) {
      if (part.byteLength === 0) {
        continue;
      }
      let offset = 0;
      if (pending.byteLength !== 0) {
        const required = this.options.plaintextChunkBytes - pending.byteLength;
        const consumed = Math.min(required, part.byteLength);
        pending = concatenate(pending, part.subarray(0, consumed));
        offset = consumed;
        if (pending.byteLength === this.options.plaintextChunkBytes) {
          chunks.push(await this.encryptAndStage(stage, snapshotId, chunks.length, pending));
          pending = new Uint8Array();
        }
      }
      while (part.byteLength - offset >= this.options.plaintextChunkBytes) {
        const end = offset + this.options.plaintextChunkBytes;
        chunks.push(
          await this.encryptAndStage(stage, snapshotId, chunks.length, part.subarray(offset, end)),
        );
        offset = end;
      }
      if (offset < part.byteLength) {
        pending = part.slice(offset);
      }
    }
    if (pending.byteLength !== 0) {
      chunks.push(await this.encryptAndStage(stage, snapshotId, chunks.length, pending));
    }
    return chunks;
  }

  private async encryptAndStage(
    stage: SnapshotProducerStage,
    snapshotId: string,
    index: number,
    plaintext: Uint8Array,
  ): Promise<StagedChunk> {
    const encrypted = await encryptChunk({
      encryptionKeyId: this.options.encryptionKeyId,
      index,
      plaintext,
      root: this.options.encryptionRoot,
      snapshotId,
    });
    await stage.writeChunk(index, encrypted);
    return { checksum: sha256(encrypted), index, size: encrypted.byteLength };
  }

  private manifest(
    bundleId: string,
    snapshotId: string,
    chunks: readonly StagedChunk[],
    totalBytes: number,
  ): SnapshotManifest {
    return {
      bundleId,
      chunkCount: chunks.length,
      chunks: [...chunks],
      format: "mynas.snapshot-bundle",
      metadata: {
        encryptionKeyId: this.options.encryptionKeyId,
        signingKeyId: this.options.signingKeyId,
        snapshotId,
        source: "slack-dashboard",
      },
      totalBytes,
      version: 1,
    };
  }
}
