import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { sha256 } from "../../snapshots/src/manifest";
import { type SnapshotBundle, snapshotBundleSchema } from "../../snapshots/src/models";
import type { SnapshotProducerStage, SnapshotUploadClient } from "./producer";
import type { SnapshotDownloadClient } from "./restore";
import type { SnapshotRetentionClient } from "./retention";

export type FilesystemSnapshotStage = SnapshotProducerStage & {
  readonly directory: string;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type HttpClientOptions = {
  readonly fetch: FetchLike;
  readonly producerId: string;
  readonly producerKind: string;
  readonly token: string;
  readonly url: string;
  readonly volumeId: string;
};

const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const result = new ArrayBuffer(contents.byteLength);
  new Uint8Array(result).set(contents);
  return result;
};

const chunkPath = (directory: string, index: number): string =>
  join(directory, `${String(index).padStart(8, "0")}.bin`);

export const createFilesystemStage = async (parent: string): Promise<FilesystemSnapshotStage> => {
  await mkdir(parent, { mode: 0o700, recursive: true });
  const directory = await mkdtemp(join(parent, "run-"));
  await chmod(directory, 0o700);
  return {
    directory,
    readChunk: async (index) => new Uint8Array(await readFile(chunkPath(directory, index))),
    remove: async () => rm(directory, { force: true, recursive: true }),
    writeChunk: async (index, contents) => {
      await writeFile(chunkPath(directory, index), contents, { flag: "wx", mode: 0o600 });
    },
  };
};

export class HttpSnapshotUploadClient implements SnapshotRetentionClient, SnapshotUploadClient {
  public constructor(private readonly options: HttpClientOptions) {
    if (options.token.length === 0) {
      throw new Error("MyNAS snapshot token is required");
    }
  }

  public async begin(input: {
    readonly chunkCount: number;
    readonly totalBytes: number;
  }): Promise<{ readonly id: string }> {
    const response = await this.request("/api/v1/snapshot-bundles", {
      body: JSON.stringify({
        ...input,
        producerId: this.options.producerId,
        producerKind: this.options.producerKind,
        volumeId: this.options.volumeId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return z.object({ id: z.uuid() }).parse(await response.json());
  }

  public async complete(id: string, manifest: Uint8Array, signature: Uint8Array): Promise<void> {
    await this.request(`/api/v1/snapshot-bundles/${z.uuid().parse(id)}/manifest`, {
      body: exactArrayBuffer(manifest),
      headers: {
        "content-type": "application/json",
        "x-mynas-signature": Buffer.from(signature).toString("base64"),
      },
      method: "PUT",
    });
  }

  public async delete(bundleId: string): Promise<void> {
    await this.request(`/api/v1/snapshot-bundles/${z.uuid().parse(bundleId)}`, {
      method: "DELETE",
    });
  }

  public async list(): Promise<readonly SnapshotBundle[]> {
    const response = await this.request("/api/v1/snapshot-bundles", { method: "GET" });
    return z.array(snapshotBundleSchema).parse(await response.json());
  }

  public async uploadChunk(id: string, index: number, contents: Uint8Array): Promise<void> {
    await this.request(`/api/v1/snapshot-bundles/${z.uuid().parse(id)}/chunks/${index}`, {
      body: exactArrayBuffer(contents),
      headers: {
        "content-type": "application/octet-stream",
        "x-mynas-sha256": sha256(contents),
      },
      method: "PUT",
    });
  }

  protected async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.options.token}`);
    const response = await this.options.fetch(`${this.options.url.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      throw new Error(
        (await response.text()) || `MyNAS snapshot request failed: ${response.status}`,
      );
    }
    return response;
  }
}

export class HttpSnapshotDownloadClient
  extends HttpSnapshotUploadClient
  implements SnapshotDownloadClient
{
  public readChunk(bundleId: string, index: number): Promise<Uint8Array> {
    return this.read(
      `/api/v1/snapshot-bundles/${z.uuid().parse(bundleId)}/chunks/${z.number().int().nonnegative().parse(index)}`,
    );
  }

  public readManifest(bundleId: string): Promise<Uint8Array> {
    return this.read(`/api/v1/snapshot-bundles/${z.uuid().parse(bundleId)}/manifest`);
  }

  public readSignature(bundleId: string): Promise<Uint8Array> {
    return this.read(`/api/v1/snapshot-bundles/${z.uuid().parse(bundleId)}/signature`);
  }

  private async read(path: string): Promise<Uint8Array> {
    const response = await this.request(path, { method: "GET" });
    return new Uint8Array(await response.arrayBuffer());
  }
}
