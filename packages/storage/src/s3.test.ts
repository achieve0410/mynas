import { afterEach, describe, expect, test } from "bun:test";

import type { S3ObjectClient, S3ObjectFile } from "./s3";
import { S3StorageBackend } from "./s3";

class MemoryObjectFile implements S3ObjectFile {
  public constructor(
    private readonly key: string,
    private readonly objects: Map<string, Uint8Array>,
  ) {}

  public async arrayBuffer(): Promise<ArrayBuffer> {
    const value = this.objects.get(this.key);
    if (value === undefined) {
      throw new Error("NoSuchKey");
    }
    return value.slice().buffer;
  }

  public async delete(): Promise<void> {
    this.objects.delete(this.key);
  }

  public async exists(): Promise<boolean> {
    return this.objects.has(this.key);
  }

  public async stat(): Promise<{ readonly size: number }> {
    const value = this.objects.get(this.key);
    if (value === undefined) {
      throw new Error("NoSuchKey");
    }
    return { size: value.byteLength };
  }

  public async write(contents: Uint8Array): Promise<number> {
    this.objects.set(this.key, contents.slice());
    return contents.byteLength;
  }
}

class MemoryObjectClient implements S3ObjectClient {
  private readonly objects = new Map<string, Uint8Array>();

  public file(path: string): S3ObjectFile {
    return new MemoryObjectFile(path, this.objects);
  }

  public async list(): Promise<unknown> {
    return { contents: [...this.objects.keys()] };
  }
}

const endpoint = process.env.MYNAS_TEST_S3_ENDPOINT;
const useMinio = endpoint !== undefined;
const environment: Readonly<Record<string, string | undefined>> = useMinio
  ? {
      MYNAS_S3_TEST_ACCESS_KEY: process.env.MYNAS_TEST_S3_ACCESS_KEY,
      MYNAS_S3_TEST_SECRET_KEY: process.env.MYNAS_TEST_S3_SECRET_KEY,
    }
  : {
      MYNAS_S3_TEST_ACCESS_KEY: "memory-access",
      MYNAS_S3_TEST_SECRET_KEY: "memory-secret",
    };

const backend = new S3StorageBackend(
  {
    accessKeyIdEnv: "MYNAS_S3_TEST_ACCESS_KEY",
    bucket: process.env.MYNAS_TEST_S3_BUCKET ?? "mynas-test",
    endpoint: endpoint ?? "http://127.0.0.1",
    id: "s3-test",
    prefix: "objects",
    region: "us-east-1",
    secretAccessKeyEnv: "MYNAS_S3_TEST_SECRET_KEY",
  },
  environment,
  useMinio ? undefined : new MemoryObjectClient(),
);

const objectKey = `qa/${crypto.randomUUID()}.bin`;
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

afterEach(async () => {
  await backend.delete(objectKey);
});

describe("S3StorageBackend", () => {
  test("probes the configured bucket", async () => {
    expect(await backend.probe()).toEqual({ status: "healthy" });
  });

  test("round-trips bytes, ranges, metadata, and deletion", async () => {
    const stored = await backend.put(objectKey, bytes("0123456789"));
    expect(stored).toEqual({ key: objectKey, size: 10 });
    expect(text(await backend.get(objectKey))).toBe("0123456789");
    expect(text(await backend.get(objectKey, { start: 3, endExclusive: 7 }))).toBe("3456");
    expect(await backend.stat(objectKey)).toEqual(stored);

    await backend.delete(objectKey);
    expect(await backend.stat(objectKey)).toBeNull();
  });

  test("rejects unsafe object keys", async () => {
    await expect(backend.put("../escape.bin", bytes("escape"))).rejects.toThrow("object key");
    await expect(backend.get("/absolute.bin")).rejects.toThrow("object key");
  });

  test("requires credentials by environment-variable reference", () => {
    expect(
      () =>
        new S3StorageBackend(
          {
            accessKeyIdEnv: "MYNAS_S3_MISSING_ACCESS",
            bucket: "missing",
            endpoint: "http://127.0.0.1:9000",
            id: "missing",
            region: "us-east-1",
            secretAccessKeyEnv: "MYNAS_S3_MISSING_SECRET",
          },
          {},
        ),
    ).toThrow("MYNAS_S3_MISSING_ACCESS");
  });

  test("rejects credential references outside the MyNAS S3 namespace", () => {
    expect(
      () =>
        new S3StorageBackend(
          {
            accessKeyIdEnv: "DATABASE_URL",
            bucket: "hostile",
            endpoint: "https://s3.example.com",
            id: "hostile",
            region: "us-east-1",
            secretAccessKeyEnv: "SESSION_SECRET",
          },
          {
            DATABASE_URL: "synthetic-database-value",
            SESSION_SECRET: "synthetic-session-value",
          },
        ),
    ).toThrow("MYNAS_S3_");
  });

  test("rejects plaintext non-loopback endpoints", () => {
    expect(
      () =>
        new S3StorageBackend(
          {
            accessKeyIdEnv: "MYNAS_S3_TEST_ACCESS_KEY",
            bucket: "hostile",
            endpoint: "http://s3.example.com",
            id: "hostile",
            region: "us-east-1",
            secretAccessKeyEnv: "MYNAS_S3_TEST_SECRET_KEY",
          },
          environment,
        ),
    ).toThrow("HTTPS");
  });

  test("rejects credentials embedded in endpoints", () => {
    expect(
      () =>
        new S3StorageBackend(
          {
            accessKeyIdEnv: "MYNAS_S3_TEST_ACCESS_KEY",
            bucket: "hostile",
            endpoint: "https://synthetic-user:synthetic-secret@[::1]",
            id: "hostile",
            region: "us-east-1",
            secretAccessKeyEnv: "MYNAS_S3_TEST_SECRET_KEY",
          },
          environment,
        ),
    ).toThrow("must not contain credentials");
  });
});
