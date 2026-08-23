import { randomUUID } from "node:crypto";
import { chmod, type FileHandle, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

import { decryptChunk, verifyManifestSignature } from "../../snapshots/src/crypto";
import { parseCanonicalManifest, sha256 } from "../../snapshots/src/manifest";
import type { SnapshotManifest } from "../../snapshots/src/models";
import { decodeArchive, type SnapshotArchiveSink } from "./archive";

export type SnapshotDownloadClient = {
  readChunk(bundleId: string, index: number): Promise<Uint8Array>;
  readManifest(bundleId: string): Promise<Uint8Array>;
  readSignature(bundleId: string): Promise<Uint8Array>;
};

type RestoreOptions = {
  readonly bundleId: string;
  readonly client: SnapshotDownloadClient;
  readonly destination: string;
  readonly encryptionRoot: Uint8Array;
  readonly signingPublicKey: Uint8Array;
};

const metadataSchema = z.object({
  encryptionKeyId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  signingKeyId: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotId: z.string().regex(/^[a-f0-9]{32}$/),
  source: z.literal("slack-dashboard"),
});

class FilesystemArchiveSink implements SnapshotArchiveSink {
  private current: FileHandle | null = null;
  private mode = 0o600;

  public constructor(private readonly root: string) {}

  public async abort(): Promise<void> {
    await this.current?.close();
    this.current = null;
  }

  public async end(): Promise<void> {
    if (this.current === null) {
      throw new Error("snapshot archive file is not open");
    }
    const handle = this.current;
    this.current = null;
    await handle.sync();
    await handle.chmod(this.mode);
    await handle.close();
  }

  public async start(record: { readonly mode: number; readonly path: string }): Promise<void> {
    if (this.current !== null) {
      throw new Error("snapshot archive file is already open");
    }
    const path = join(this.root, record.path);
    await mkdir(dirname(path), { mode: 0o700, recursive: true });
    this.current = await open(path, "wx", 0o600);
    this.mode = record.mode;
  }

  public async write(contents: Uint8Array): Promise<void> {
    if (this.current === null) {
      throw new Error("snapshot archive file is not open");
    }
    await this.current.write(contents);
  }
}

const validateChunks = (manifest: SnapshotManifest): void => {
  if (
    manifest.chunkCount !== manifest.chunks.length ||
    manifest.totalBytes !== manifest.chunks.reduce((total, chunk) => total + chunk.size, 0) ||
    manifest.chunks.some((chunk, index) => chunk.index !== index)
  ) {
    throw new Error("snapshot manifest chunk layout is invalid");
  }
};

const assertDestinationAbsent = async (destination: string): Promise<void> => {
  try {
    await lstat(destination);
    throw new Error("snapshot restore destination already exists");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
};

export const restoreSnapshot = async (options: RestoreOptions): Promise<void> => {
  const manifestBytes = await options.client.readManifest(options.bundleId);
  const signature = await options.client.readSignature(options.bundleId);
  const manifest = parseCanonicalManifest(manifestBytes);
  const metadata = metadataSchema.parse(manifest.metadata);
  if (manifest.bundleId !== options.bundleId) {
    throw new Error("snapshot manifest bundle id does not match");
  }
  validateChunks(manifest);
  if (metadata.signingKeyId !== sha256(options.signingPublicKey)) {
    throw new Error("snapshot signing key id does not match pinned public key");
  }
  if (!(await verifyManifestSignature(options.signingPublicKey, manifestBytes, signature))) {
    throw new Error("snapshot manifest signature is invalid");
  }

  await assertDestinationAbsent(options.destination);
  const parent = dirname(options.destination);
  const stage = join(parent, `.${basename(options.destination)}.partial-${randomUUID()}`);
  await mkdir(parent, { mode: 0o700, recursive: true });
  await mkdir(stage, { mode: 0o700 });
  const sink = new FilesystemArchiveSink(stage);
  try {
    await decodeArchive(
      (async function* () {
        for (const expected of manifest.chunks) {
          const encrypted = await options.client.readChunk(options.bundleId, expected.index);
          if (encrypted.byteLength !== expected.size || sha256(encrypted) !== expected.checksum) {
            throw new Error(`snapshot chunk ${expected.index} failed verification`);
          }
          yield await decryptChunk({
            encrypted,
            encryptionKeyId: metadata.encryptionKeyId,
            index: expected.index,
            root: options.encryptionRoot,
            snapshotId: metadata.snapshotId,
          });
        }
      })(),
      sink,
    );
    await rename(stage, options.destination);
  } catch (error) {
    await sink.abort();
    await rm(stage, { force: true, recursive: true });
    throw error;
  }
  await chmod(options.destination, 0o700);
};
