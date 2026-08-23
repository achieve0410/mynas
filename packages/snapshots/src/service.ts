import type { z } from "zod";

import { canonicalManifestBytes, parseCanonicalManifest, sha256 } from "./manifest";
import {
  type BeginSnapshotInput,
  beginSnapshotSchema,
  type SnapshotBundle,
  type SnapshotChunk,
  SnapshotError,
  type SnapshotManifest,
  snapshotChecksumSchema,
} from "./models";
import { SnapshotReader } from "./reader";
import { SnapshotRepository } from "./repository";
import { chunkKey, manifestKey, type SnapshotObjectResolver, signatureKey } from "./storage";

export {
  canonicalManifestBytes,
  type SnapshotBundle,
  SnapshotError,
  type SnapshotManifest,
  SnapshotRepository,
};

export const MAX_SNAPSHOT_CHUNK_BYTES = 64 * 1024 * 1024;

export class SnapshotService {
  private readonly reader: SnapshotReader;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly repository: SnapshotRepository,
    private readonly resolveStore: SnapshotObjectResolver,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    this.reader = new SnapshotReader(repository, resolveStore);
  }

  public async begin(value: BeginSnapshotInput): Promise<SnapshotBundle> {
    const input = this.parse(beginSnapshotSchema, value, "snapshot request is invalid");
    await this.resolveStore(input.volumeId);
    return this.repository.create(this.createId(), input, this.clock().toISOString());
  }

  public cleanupUploadingBefore(cutoff: Date): Promise<number> {
    return this.serializeWrite(async () => {
      const bundles = this.repository.listUploadingBefore(cutoff.toISOString());
      for (const bundle of bundles) {
        await this.deleteObjects(bundle);
        this.repository.remove(bundle.id);
      }
      return bundles.length;
    });
  }

  public complete(
    bundleId: string,
    manifestContents: Uint8Array,
    signature: Uint8Array,
  ): Promise<SnapshotBundle> {
    const manifest = parseCanonicalManifest(manifestContents);
    if (signature.byteLength !== 64) {
      throw new SnapshotError("invalid", "manifest signature must be 64 bytes");
    }
    return this.serializeWrite(async () => {
      const bundle = this.requireBundle(bundleId);
      const manifestHash = sha256(manifestContents);
      const signatureHash = sha256(signature);
      if (bundle.status === "complete") {
        if (
          bundle.manifestChecksum === manifestHash &&
          bundle.signatureChecksum === signatureHash
        ) {
          return bundle;
        }
        throw new SnapshotError("conflict", "snapshot completion conflicts");
      }
      if (bundle.status !== "uploading") {
        throw new SnapshotError("conflict", "snapshot is not uploadable");
      }
      this.validateManifest(bundle, manifest);
      const chunks = this.repository.listChunks(bundle.id);
      if (chunks.length !== bundle.expectedChunkCount) {
        throw new SnapshotError("invalid", "snapshot chunk count does not match");
      }
      const store = await this.resolveStore(bundle.volumeId);
      for (const chunk of chunks) {
        await store.getObject(chunkKey(bundle.id, chunk.index), chunk.checksum);
      }
      const manifestObject = await store.putObject(manifestKey(bundle.id), manifestContents);
      const signatureObject = await store.putObject(signatureKey(bundle.id), signature);
      const completed = this.repository.complete(bundle.id, {
        completedAt: this.clock().toISOString(),
        manifestChecksum: manifestObject.checksum,
        manifestKey: manifestObject.key,
        signatureChecksum: signatureObject.checksum,
        signatureKey: signatureObject.key,
      });
      if (completed === null) {
        throw new SnapshotError("conflict", "snapshot completion raced");
      }
      return completed;
    });
  }

  public delete(bundleId: string): Promise<void> {
    return this.serializeWrite(async () => {
      const current = this.requireBundle(bundleId);
      if (current.status === "uploading") {
        throw new SnapshotError("conflict", "uploading snapshot cannot be deleted");
      }
      const bundle =
        current.status === "deleting"
          ? current
          : (this.repository.markDeleting(bundleId) ?? current);
      await this.deleteObjects(bundle);
      this.repository.remove(bundle.id);
    });
  }

  public list(): readonly SnapshotBundle[] {
    return this.repository.listComplete();
  }

  public async readChunk(bundleId: string, index: number): Promise<Uint8Array> {
    return this.reader.readChunk(bundleId, index);
  }

  public async readManifest(bundleId: string): Promise<Uint8Array> {
    return this.reader.readManifest(bundleId);
  }

  public async readSignature(bundleId: string): Promise<Uint8Array> {
    return this.reader.readSignature(bundleId);
  }

  public uploadChunk(
    bundleId: string,
    index: number,
    contents: Uint8Array,
    expectedChecksum: string,
  ): Promise<SnapshotChunk> {
    return this.serializeWrite(async () => {
      const bundle = this.requireBundle(bundleId);
      if (bundle.status !== "uploading") {
        throw new SnapshotError("conflict", "snapshot is not uploadable");
      }
      if (!Number.isInteger(index) || index < 0 || index >= bundle.expectedChunkCount) {
        throw new SnapshotError("invalid", "snapshot chunk index is invalid");
      }
      if (contents.byteLength === 0 || contents.byteLength > MAX_SNAPSHOT_CHUNK_BYTES) {
        throw new SnapshotError("invalid", "snapshot chunk size is invalid");
      }
      const expected = this.parse(
        snapshotChecksumSchema,
        expectedChecksum,
        "snapshot chunk checksum is invalid",
      );
      const actual = sha256(contents);
      if (actual !== expected) {
        throw new SnapshotError("invalid", "snapshot chunk checksum mismatch");
      }
      const existing = this.repository.getChunk(bundle.id, index);
      if (existing !== null) {
        if (existing.checksum === actual && existing.size === contents.byteLength) {
          return existing;
        }
        throw new SnapshotError("conflict", "snapshot chunk conflicts with existing upload");
      }
      const object = await (await this.resolveStore(bundle.volumeId)).putObject(
        chunkKey(bundle.id, index),
        contents,
      );
      const chunk: SnapshotChunk = {
        bundleId: bundle.id,
        checksum: object.checksum,
        index,
        size: object.size,
        uploadedAt: this.clock().toISOString(),
      };
      this.repository.addChunk(chunk);
      return chunk;
    });
  }

  private async deleteObjects(bundle: SnapshotBundle): Promise<void> {
    const store = await this.resolveStore(bundle.volumeId);
    await store.deleteObject(signatureKey(bundle.id));
    await store.deleteObject(manifestKey(bundle.id));
    for (let index = 0; index < bundle.expectedChunkCount; index += 1) {
      await store.deleteObject(chunkKey(bundle.id, index));
    }
  }

  private parse<Output>(schema: z.ZodType<Output>, value: unknown, message: string): Output {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new SnapshotError("invalid", message);
    }
    return result.data;
  }

  private requireBundle(id: string): SnapshotBundle {
    const bundle = this.repository.get(id);
    if (bundle === null) {
      throw new SnapshotError("not_found", "snapshot not found");
    }
    return bundle;
  }

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private validateManifest(bundle: SnapshotBundle, manifest: SnapshotManifest): void {
    if (manifest.bundleId !== bundle.id) {
      throw new SnapshotError("invalid", "manifest bundle id does not match");
    }
    if (manifest.chunkCount !== bundle.expectedChunkCount) {
      throw new SnapshotError("invalid", "manifest chunk count does not match");
    }
    if (manifest.totalBytes !== bundle.expectedTotalBytes) {
      throw new SnapshotError("invalid", "manifest total bytes do not match");
    }
    for (const [index, chunk] of manifest.chunks.entries()) {
      if (chunk.index !== index) {
        throw new SnapshotError("invalid", "manifest chunk indexes must be contiguous");
      }
      const stored = this.repository.getChunk(bundle.id, index);
      if (stored === null || stored.checksum !== chunk.checksum || stored.size !== chunk.size) {
        throw new SnapshotError("invalid", "manifest chunk does not match uploaded data");
      }
    }
  }
}
