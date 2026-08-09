import { z } from "zod";

import type { StorageBackend } from "./adapter";
import { LocalDirectoryBackend, LocalStorageError } from "./local";
import { type S3BackendConfig, S3StorageBackend, S3StorageError } from "./s3";

const localConfigSchema = z.object({
  filesystemIdentity: z.string().min(1).optional(),
  id: z.string().min(1),
  kind: z.literal("local"),
  root: z.string().min(1),
});

const s3ConfigSchema = z.object({
  accessKeyIdEnv: z.string().min(1),
  bucket: z.string().min(1),
  endpoint: z.url(),
  id: z.string().min(1),
  kind: z.literal("s3"),
  prefix: z.string().min(1).optional(),
  region: z.string().min(1),
  secretAccessKeyEnv: z.string().min(1),
});

export const backendConfigSchema = z.discriminatedUnion("kind", [
  localConfigSchema,
  s3ConfigSchema,
]);

export type LocalBackendConfig = z.infer<typeof localConfigSchema>;
export type S3BackendRegistryConfig = z.infer<typeof s3ConfigSchema>;
export type BackendConfig = z.infer<typeof backendConfigSchema>;
export type RegistryErrorCode = "conflict" | "invalid_config" | "not_found" | "unavailable";

export class RegistryError extends Error {
  public constructor(
    public readonly code: RegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export const registryBackendError = (error: unknown): RegistryError => {
  if (error instanceof RegistryError) {
    return error;
  }
  if (error instanceof LocalStorageError || error instanceof S3StorageError) {
    const code = error.code === "backend_unavailable" ? "unavailable" : "invalid_config";
    return new RegistryError(code, error.message);
  }
  return new RegistryError(
    "unavailable",
    error instanceof Error ? error.message : "backend is unavailable",
  );
};

export const createStorageBackend = async (
  config: BackendConfig,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<StorageBackend> => {
  if (config.kind === "local") {
    const backend = new LocalDirectoryBackend(config.id, config.root, config.filesystemIdentity);
    await backend.initialize();
    return backend;
  }
  const s3Config: S3BackendConfig =
    config.prefix === undefined
      ? {
          accessKeyIdEnv: config.accessKeyIdEnv,
          bucket: config.bucket,
          endpoint: config.endpoint,
          id: config.id,
          region: config.region,
          secretAccessKeyEnv: config.secretAccessKeyEnv,
        }
      : {
          accessKeyIdEnv: config.accessKeyIdEnv,
          bucket: config.bucket,
          endpoint: config.endpoint,
          id: config.id,
          prefix: config.prefix,
          region: config.region,
          secretAccessKeyEnv: config.secretAccessKeyEnv,
        };
  return new S3StorageBackend(s3Config, environment);
};
