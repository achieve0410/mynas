import { z } from "zod";

export const snapshotChecksumSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "checksum must be lowercase SHA-256");

export const snapshotChunkSchema = z
  .object({
    checksum: snapshotChecksumSchema,
    index: z.number().int().nonnegative(),
    size: z.number().int().positive(),
  })
  .strict();

const metadataValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const snapshotManifestSchema = z
  .object({
    bundleId: z.uuid(),
    chunkCount: z.number().int().positive(),
    chunks: z.array(snapshotChunkSchema).min(1),
    format: z.literal("mynas.snapshot-bundle"),
    metadata: z.record(z.string(), metadataValueSchema),
    totalBytes: z.number().int().positive(),
    version: z.literal(1),
  })
  .strict();

export const beginSnapshotSchema = z
  .object({
    chunkCount: z.number().int().positive(),
    producerId: z.string().trim().min(1).max(200),
    producerKind: z.string().trim().min(1).max(80),
    totalBytes: z.number().int().positive(),
    volumeId: z.string().trim().min(1).max(120),
  })
  .strict();

export type BeginSnapshotInput = z.infer<typeof beginSnapshotSchema>;
export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;

export type SnapshotStatus = "complete" | "deleting" | "uploading";

export type SnapshotBundle = {
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly expectedChunkCount: number;
  readonly expectedTotalBytes: number;
  readonly id: string;
  readonly manifestChecksum: string | null;
  readonly manifestKey: string | null;
  readonly producerId: string;
  readonly producerKind: string;
  readonly signatureChecksum: string | null;
  readonly signatureKey: string | null;
  readonly status: SnapshotStatus;
  readonly volumeId: string;
};

export type SnapshotChunk = {
  readonly bundleId: string;
  readonly checksum: string;
  readonly index: number;
  readonly size: number;
  readonly uploadedAt: string;
};

export type SnapshotErrorCode = "conflict" | "invalid" | "not_found" | "storage";

export class SnapshotError extends Error {
  public constructor(
    public readonly code: SnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SnapshotError";
  }
}
