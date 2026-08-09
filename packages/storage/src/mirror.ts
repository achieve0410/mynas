import type { StorageBackend } from "./adapter";
import type { BlobDescriptor, FileCatalog, FileVersion } from "./catalog";
import { serializeReplicaWrite } from "./write-lock";

export type MirrorMembers = readonly [StorageBackend, StorageBackend];
export type ScrubIssueStatus = "corrupt" | "missing" | "unavailable";

export type ScrubIssue = {
  readonly backendId: string;
  readonly checksum: string;
  readonly status: ScrubIssueStatus;
};

export type ScrubReport = {
  readonly corrupt: number;
  readonly healthy: number;
  readonly issues: readonly ScrubIssue[];
  readonly missing: number;
  readonly unavailable: number;
  readonly unrecoverable: number;
};

export type RepairReport = {
  readonly repaired: number;
  readonly unrecoverable: number;
};

type ReplicaInspection =
  | { readonly status: "healthy"; readonly contents: Uint8Array }
  | { readonly status: ScrubIssueStatus };

export type MirrorErrorCode = "degraded" | "not_found" | "unrecoverable" | "write_failed";

export class MirrorError extends Error {
  public constructor(
    public readonly code: MirrorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MirrorError";
  }
}

const checksum = (contents: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(contents).digest("hex");

export class MirrorVolume {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    public readonly id: string,
    private readonly members: MirrorMembers,
    private readonly catalog: FileCatalog,
  ) {}

  public async delete(path: string): Promise<FileVersion> {
    return this.serializeWrite(async () => this.catalog.delete(path));
  }

  public async get(path: string): Promise<Uint8Array> {
    const version = this.catalog.getCurrent(path);
    if (version?.blob === null || version === null) {
      throw new MirrorError("not_found", "file not found");
    }
    for (const member of this.members) {
      const inspection = await this.inspectReplica(member, version.blob);
      if (inspection.status === "healthy") {
        return inspection.contents;
      }
    }
    throw new MirrorError("unrecoverable", "file is unrecoverable");
  }

  public async put(path: string, contents: Uint8Array): Promise<FileVersion> {
    return this.serializeWrite(async () => {
      const health = await Promise.all(this.members.map((member) => member.probe()));
      if (health.some((memberHealth) => memberHealth.status !== "healthy")) {
        throw new MirrorError("degraded", "mirror is degraded; writes are refused");
      }

      const blob: BlobDescriptor = {
        checksum: checksum(contents),
        key: `blobs/${checksum(contents)}`,
        size: contents.byteLength,
      };
      const [first, second] = this.members;
      return serializeReplicaWrite(
        this.members.map((member) => `${member.replicaIdentity}\0${blob.key}`),
        async () => {
          const [firstExisting, secondExisting] = await Promise.all([
            first.stat(blob.key),
            second.stat(blob.key),
          ]);
          const [firstWrite, secondWrite] = await Promise.allSettled([
            first.put(blob.key, contents),
            second.put(blob.key, contents),
          ]);
          if (firstWrite.status === "rejected" || secondWrite.status === "rejected") {
            await this.rollbackNewReplica(first, blob.key, firstExisting, firstWrite);
            await this.rollbackNewReplica(second, blob.key, secondExisting, secondWrite);
            throw new MirrorError("write_failed", "mirror write failed");
          }

          try {
            return this.catalog.addVersion(path, blob);
          } catch (error) {
            await this.rollbackNewReplica(first, blob.key, firstExisting, firstWrite);
            await this.rollbackNewReplica(second, blob.key, secondExisting, secondWrite);
            throw error;
          }
        },
      );
    });
  }

  public async repair(): Promise<RepairReport> {
    let repaired = 0;
    let unrecoverable = 0;
    for (const blob of this.catalog.listBlobs()) {
      const inspections = await Promise.all(
        this.members.map((member) => this.inspectReplica(member, blob)),
      );
      const source = inspections.find(
        (inspection): inspection is Extract<ReplicaInspection, { status: "healthy" }> =>
          inspection.status === "healthy",
      );
      if (source === undefined) {
        unrecoverable += 1;
        continue;
      }
      for (const [index, inspection] of inspections.entries()) {
        if (inspection.status === "healthy") {
          continue;
        }
        const member = this.members[index];
        if (member === undefined || (await member.probe()).status !== "healthy") {
          continue;
        }
        await member.put(blob.key, source.contents);
        repaired += 1;
      }
    }
    return { repaired, unrecoverable };
  }

  public async restore(path: string, versionId: string): Promise<FileVersion> {
    return this.serializeWrite(async () => this.catalog.restore(path, versionId));
  }

  public async scrub(): Promise<ScrubReport> {
    const issues: ScrubIssue[] = [];
    let healthy = 0;
    let unrecoverable = 0;
    for (const blob of this.catalog.listBlobs()) {
      let healthyReplicas = 0;
      for (const member of this.members) {
        const inspection = await this.inspectReplica(member, blob);
        if (inspection.status === "healthy") {
          healthy += 1;
          healthyReplicas += 1;
        } else {
          issues.push({ backendId: member.id, checksum: blob.checksum, status: inspection.status });
        }
      }
      if (healthyReplicas === 0) {
        unrecoverable += 1;
      }
    }
    return {
      corrupt: issues.filter((issue) => issue.status === "corrupt").length,
      healthy,
      issues,
      missing: issues.filter((issue) => issue.status === "missing").length,
      unavailable: issues.filter((issue) => issue.status === "unavailable").length,
      unrecoverable,
    };
  }

  public versions(path: string): readonly FileVersion[] {
    return this.catalog.listVersions(path);
  }

  private async inspectReplica(
    member: StorageBackend,
    blob: BlobDescriptor,
  ): Promise<ReplicaInspection> {
    try {
      if ((await member.probe()).status !== "healthy") {
        return { status: "unavailable" };
      }
      if ((await member.stat(blob.key)) === null) {
        return { status: "missing" };
      }
      const contents = await member.get(blob.key);
      return checksum(contents) === blob.checksum
        ? { contents, status: "healthy" }
        : { status: "corrupt" };
    } catch {
      return { status: "unavailable" };
    }
  }

  private async rollbackNewReplica(
    member: StorageBackend,
    key: string,
    existing: Awaited<ReturnType<StorageBackend["stat"]>>,
    write: PromiseSettledResult<unknown>,
  ): Promise<void> {
    if (existing === null && write.status === "fulfilled") {
      await member.delete(key);
    }
  }

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
