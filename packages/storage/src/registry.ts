import type { Database } from "bun:sqlite";
import { z } from "zod";

import type { BackendHealth, StorageBackend } from "./adapter";
import { FileCatalog } from "./catalog";
import { LocalDirectoryBackend } from "./local";
import { MirrorVolume } from "./mirror";
import { type S3BackendConfig, S3StorageBackend } from "./s3";

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

const backendConfigSchema = z.discriminatedUnion("kind", [localConfigSchema, s3ConfigSchema]);
const membersSchema = z.tuple([z.string().min(1), z.string().min(1)]);

export type LocalBackendConfig = z.infer<typeof localConfigSchema>;
export type S3BackendRegistryConfig = z.infer<typeof s3ConfigSchema>;
export type BackendConfig = z.infer<typeof backendConfigSchema>;

type BackendRow = {
  readonly config_json: string;
};

type VolumeRow = {
  readonly members_json: string;
};

export type VolumeHealth = {
  readonly status: "degraded" | "healthy";
  readonly unavailable: readonly string[];
};

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

export class StorageRegistry {
  private readonly backends = new Map<string, StorageBackend>();
  private readonly volumes = new Map<string, MirrorVolume>();

  public constructor(
    private readonly database: Database,
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async addBackend(config: BackendConfig): Promise<BackendHealth> {
    const parsed = backendConfigSchema.parse(config);
    if (this.hasBackend(parsed.id)) {
      throw new RegistryError("conflict", "backend already exists");
    }
    const backend = await this.createBackend(parsed);
    const health = await backend.probe();
    if (health.status !== "healthy") {
      throw new RegistryError("unavailable", health.reason);
    }
    const persisted =
      parsed.kind === "local"
        ? { ...parsed, filesystemIdentity: health.filesystemIdentity }
        : parsed;
    this.database
      .query("INSERT INTO storage_backends (id, kind, config_json, created_at) VALUES (?, ?, ?, ?)")
      .run(parsed.id, parsed.kind, JSON.stringify(persisted), this.now().toISOString());
    this.backends.set(parsed.id, backend);
    return health;
  }

  public async addMirror(id: string, members: readonly [string, string]): Promise<MirrorVolume> {
    if (id.length === 0 || members[0] === members[1]) {
      throw new RegistryError("invalid_config", "mirror requires two distinct members");
    }
    if (this.hasVolume(id)) {
      throw new RegistryError("conflict", "volume already exists");
    }
    const first = await this.getBackend(members[0]);
    const second = await this.getBackend(members[1]);
    const health = await Promise.all([first.probe(), second.probe()]);
    if (health.some((entry) => entry.status !== "healthy")) {
      throw new RegistryError("unavailable", "mirror member is unavailable");
    }
    this.database
      .query(
        "INSERT INTO storage_volumes (id, kind, members_json, created_at) VALUES (?, 'mirror', ?, ?)",
      )
      .run(id, JSON.stringify(members), this.now().toISOString());
    const volume = new MirrorVolume(id, [first, second], new FileCatalog(this.database, id));
    this.volumes.set(id, volume);
    return volume;
  }

  public async getBackend(id: string): Promise<StorageBackend> {
    const cached = this.backends.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const row = this.database
      .query<BackendRow, [string]>("SELECT config_json FROM storage_backends WHERE id = ?")
      .get(id);
    if (row === null) {
      throw new RegistryError("not_found", "backend not found");
    }
    const config = backendConfigSchema.parse(JSON.parse(row.config_json));
    const backend = await this.createBackend(config);
    this.backends.set(id, backend);
    return backend;
  }

  public async getVolume(id: string): Promise<MirrorVolume> {
    const cached = this.volumes.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const row = this.database
      .query<VolumeRow, [string]>("SELECT members_json FROM storage_volumes WHERE id = ?")
      .get(id);
    if (row === null) {
      throw new RegistryError("not_found", "volume not found");
    }
    const members = membersSchema.parse(JSON.parse(row.members_json));
    const volume = new MirrorVolume(
      id,
      [await this.getBackend(members[0]), await this.getBackend(members[1])],
      new FileCatalog(this.database, id),
    );
    this.volumes.set(id, volume);
    return volume;
  }

  public async getVolumeHealth(id: string): Promise<VolumeHealth> {
    const row = this.database
      .query<VolumeRow, [string]>("SELECT members_json FROM storage_volumes WHERE id = ?")
      .get(id);
    if (row === null) {
      throw new RegistryError("not_found", "volume not found");
    }
    const memberIds = membersSchema.parse(JSON.parse(row.members_json));
    const members = await Promise.all(memberIds.map((memberId) => this.getBackend(memberId)));
    const probes = await Promise.all(members.map((member) => member.probe()));
    const unavailable = memberIds.filter((_, index) => probes[index]?.status !== "healthy");
    return {
      status: unavailable.length === 0 ? "healthy" : "degraded",
      unavailable,
    };
  }

  public async listBackends() {
    const configs = this.database
      .query<BackendRow, []>("SELECT config_json FROM storage_backends ORDER BY created_at, id")
      .all()
      .map(({ config_json }) => backendConfigSchema.parse(JSON.parse(config_json)));
    return Promise.all(
      configs.map(async (config) => {
        const health = await (await this.getBackend(config.id)).probe();
        return health.status === "healthy"
          ? {
              availableBytes: health.availableBytes,
              capacityBytes: health.capacityBytes,
              id: config.id,
              kind: config.kind,
              status: health.status,
            }
          : { id: config.id, kind: config.kind, reason: health.reason, status: health.status };
      }),
    );
  }

  public listVolumes() {
    return this.database
      .query<{ readonly id: string; readonly members_json: string }, []>(
        "SELECT id, members_json FROM storage_volumes ORDER BY created_at, id",
      )
      .all()
      .map(({ id, members_json }) => ({
        id,
        kind: "mirror",
        members: membersSchema.parse(JSON.parse(members_json)),
      }));
  }

  private async createBackend(config: BackendConfig): Promise<StorageBackend> {
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
    return new S3StorageBackend(s3Config, this.environment);
  }

  private hasBackend(id: string): boolean {
    return (
      this.database
        .query<{ readonly count: number }, [string]>(
          "SELECT COUNT(*) AS count FROM storage_backends WHERE id = ?",
        )
        .get(id)?.count === 1
    );
  }

  private hasVolume(id: string): boolean {
    return (
      this.database
        .query<{ readonly count: number }, [string]>(
          "SELECT COUNT(*) AS count FROM storage_volumes WHERE id = ?",
        )
        .get(id)?.count === 1
    );
  }
}
