import { isAbsolute } from "node:path";

import type { BackendHealth, ByteRange, StorageBackend, StoredObject } from "./adapter";

export type S3BackendConfig = {
  readonly accessKeyIdEnv: string;
  readonly bucket: string;
  readonly endpoint: string;
  readonly id: string;
  readonly prefix?: string;
  readonly region: string;
  readonly secretAccessKeyEnv: string;
};

export type S3ObjectFile = {
  arrayBuffer(): Promise<ArrayBuffer>;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
  stat(): Promise<{ readonly size: number }>;
  write(contents: Uint8Array): Promise<number>;
};

export type S3ObjectClient = {
  file(path: string): S3ObjectFile;
  list(input?: { readonly maxKeys?: number; readonly prefix?: string }): Promise<unknown>;
};

export type S3StorageErrorCode =
  | "backend_unavailable"
  | "invalid_config"
  | "invalid_object_key"
  | "invalid_range";

export class S3StorageError extends Error {
  public constructor(
    public readonly code: S3StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "S3StorageError";
  }
}

const parseObjectPath = (value: string, label: string): readonly string[] => {
  if (value.length === 0 || value.includes("\0") || value.includes("\\") || isAbsolute(value)) {
    throw new S3StorageError("invalid_object_key", `invalid ${label}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new S3StorageError("invalid_object_key", `invalid ${label}`);
  }
  return segments;
};

const requireEnvironmentValue = (
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string => {
  if (!/^MYNAS_S3_[A-Z0-9_]+$/.test(name)) {
    throw new S3StorageError(
      "invalid_config",
      "credential environment variables must use the MYNAS_S3_ namespace",
    );
  }
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new S3StorageError("invalid_config", `missing credential environment variable ${name}`);
  }
  return value;
};

const validateEndpoint = (endpoint: string): void => {
  const url = URL.parse(endpoint);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new S3StorageError("invalid_config", "S3 endpoint must be an HTTP or HTTPS URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new S3StorageError("invalid_config", "S3 endpoint must not contain credentials");
  }
  const loopback = ["127.0.0.1", "[::1]", "::1", "localhost"].includes(url.hostname);
  if (url.protocol === "http:" && !loopback) {
    throw new S3StorageError(
      "invalid_config",
      "S3 endpoint must use HTTPS unless it is a loopback QA endpoint",
    );
  }
};

export class S3StorageBackend implements StorageBackend {
  public readonly id: string;
  public readonly kind = "s3";
  public readonly replicaIdentity: string;

  private readonly client: S3ObjectClient;
  private readonly prefix: string;

  public constructor(
    config: S3BackendConfig,
    environment: Readonly<Record<string, string | undefined>>,
    client?: S3ObjectClient,
  ) {
    if (config.bucket.length === 0 || config.region.length === 0) {
      throw new S3StorageError("invalid_config", "S3 bucket and region are required");
    }
    validateEndpoint(config.endpoint);
    const accessKeyId = requireEnvironmentValue(environment, config.accessKeyIdEnv);
    const secretAccessKey = requireEnvironmentValue(environment, config.secretAccessKeyEnv);

    this.id = config.id;
    this.prefix =
      config.prefix === undefined ? "" : parseObjectPath(config.prefix, "object prefix").join("/");
    this.replicaIdentity = `s3:${new URL(config.endpoint).toString()}\0${config.bucket}\0${this.prefix}`;
    this.client =
      client ??
      new Bun.S3Client({
        accessKeyId,
        bucket: config.bucket,
        endpoint: config.endpoint,
        region: config.region,
        secretAccessKey,
        virtualHostedStyle: false,
      });
  }

  public async delete(key: string): Promise<void> {
    const file = this.client.file(this.toRemoteKey(key));
    if (await file.exists()) {
      await file.delete();
    }
  }

  public async get(key: string, range?: ByteRange): Promise<Uint8Array> {
    const file = this.client.file(this.toRemoteKey(key));
    const contents = new Uint8Array(await file.arrayBuffer());
    if (range === undefined) {
      return contents;
    }
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.endExclusive) ||
      range.start < 0 ||
      range.endExclusive <= range.start ||
      range.endExclusive > contents.byteLength
    ) {
      throw new S3StorageError("invalid_range", "invalid byte range");
    }
    return contents.slice(range.start, range.endExclusive);
  }

  public async probe(): Promise<BackendHealth> {
    try {
      await this.client.list(
        this.prefix.length === 0 ? { maxKeys: 1 } : { maxKeys: 1, prefix: this.prefix },
      );
      return { status: "healthy" };
    } catch {
      return { reason: "S3 bucket probe failed", status: "unavailable" };
    }
  }

  public async put(key: string, contents: Uint8Array): Promise<StoredObject> {
    const written = await this.client.file(this.toRemoteKey(key)).write(contents);
    if (written !== contents.byteLength) {
      throw new S3StorageError("backend_unavailable", "S3 write did not persist every byte");
    }
    return { key, size: contents.byteLength };
  }

  public async stat(key: string): Promise<StoredObject | null> {
    const file = this.client.file(this.toRemoteKey(key));
    if (!(await file.exists())) {
      return null;
    }
    const metadata = await file.stat();
    return { key, size: metadata.size };
  }

  private toRemoteKey(key: string): string {
    const safeKey = parseObjectPath(key, "object key").join("/");
    return this.prefix.length === 0 ? safeKey : `${this.prefix}/${safeKey}`;
  }
}
