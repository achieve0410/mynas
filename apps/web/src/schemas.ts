import { z } from "zod";

export const setupStatusSchema = z.object({ setupComplete: z.boolean() });
export const systemStatusSchema = z.object({
  setupComplete: z.boolean(),
  version: z.string(),
});
export const healthSchema = z.object({ status: z.literal("ok") });

export const backendSchema = z
  .object({
    availableBytes: z.number().nonnegative().optional(),
    capacityBytes: z.number().nonnegative().optional(),
    id: z.string(),
    kind: z.enum(["local", "s3"]),
    reason: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();
export const backendsSchema = z.array(backendSchema);

export const volumeSchema = z
  .object({
    id: z.string(),
    kind: z.literal("mirror"),
    members: z.array(z.string()),
    status: z.string().optional(),
  })
  .passthrough();
export const volumesSchema = z.array(volumeSchema);
export const volumeHealthSchema = z.object({
  status: z.enum(["degraded", "healthy"]),
  unavailable: z.array(z.string()),
});
export const repairReportSchema = z.object({
  repaired: z.number().int().nonnegative(),
  unrecoverable: z.number().int().nonnegative(),
});

export const photoSchema = z.object({
  capturedAt: z.string(),
  checksum: z.string().length(64),
  filename: z.string(),
  format: z.literal("jpeg"),
  height: z.number().int().positive(),
  id: z.string().uuid(),
  importedAt: z.string(),
  originalPath: z.string(),
  previewPath: z.string(),
  width: z.number().int().positive(),
});
export const photosSchema = z.array(photoSchema);

export const jobSchema = z.object({
  error: z.string().nullable(),
  id: z.string().uuid(),
  photoId: z.string().uuid().nullable(),
  status: z.enum(["queued", "processing", "completed", "failed"]),
});

export const ingestSchema = z.object({
  deduplicated: z.boolean(),
  job: jobSchema,
  photo: photoSchema,
});

export const albumSchema = z.object({
  createdAt: z.string(),
  id: z.string().uuid(),
  name: z.string(),
  photos: photosSchema,
});
export const albumsSchema = z.array(albumSchema);

export const sessionSchema = z.object({
  expiresAt: z.string(),
  token: z.string().min(32),
});

export const apiTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  token: z.string().min(32),
});
export const apiTokenRecordSchema = z.object({
  createdAt: z.string(),
  id: z.string().uuid(),
  name: z.string(),
});
export const apiTokensSchema = z.array(apiTokenRecordSchema);

export const operationSchema = z.record(z.string(), z.unknown());

export type Album = z.infer<typeof albumSchema>;
export type ApiToken = z.infer<typeof apiTokenRecordSchema>;
export type Backend = z.infer<typeof backendSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type Volume = z.infer<typeof volumeSchema>;
