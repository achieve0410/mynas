import type { Database } from "bun:sqlite";
import { z } from "zod";

import type { BackendHealth, StorageBackend } from "./adapter";
import {
  type BackendConfig,
  backendConfigSchema,
  createStorageBackend,
  type LocalBackendConfig,
  RegistryError,
  registryBackendError,
  type S3BackendRegistryConfig,
} from "./backend-factory";
import { FileCatalog } from "./catalog";
import { MirrorVolume } from "./mirror";

export type { BackendConfig, LocalBackendConfig, S3BackendRegistryConfig };
export { RegistryError };

const membersSchema = z.tuple([z.string().min(1), z.string().min(1)]);

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
    let backend: StorageBackend;
    let health: BackendHealth;
    try {
      backend = await createStorageBackend(parsed, this.environment);
      health = await backend.probe();
    } catch (error) {
      throw registryBackendError(error);
    }
    if (health.status !== "healthy") {
      throw new RegistryError("unavailable", health.reason);
    }
    const persisted =
      parsed.kind === "local"
        ? { ...parsed, filesystemIdentity: health.filesystemIdentity }
        : parsed;
    try {
      this.database
        .query(
          "INSERT INTO storage_backends (id, kind, config_json, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(parsed.id, parsed.kind, JSON.stringify(persisted), this.now().toISOString());
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new RegistryError("conflict", "backend already exists");
      }
      throw error;
    }
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
    if (first.replicaIdentity === second.replicaIdentity) {
      throw new RegistryError("invalid_config", "mirror members must use distinct storage targets");
    }
    const health = await Promise.all([first.probe(), second.probe()]);
    if (health.some((entry) => entry.status !== "healthy")) {
      throw new RegistryError("unavailable", "mirror member is unavailable");
    }
    try {
      this.database
        .query(
          "INSERT INTO storage_volumes (id, kind, members_json, created_at) VALUES (?, 'mirror', ?, ?)",
        )
        .run(id, JSON.stringify(members), this.now().toISOString());
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new RegistryError("conflict", "volume already exists");
      }
      throw error;
    }
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
    let backend: StorageBackend;
    try {
      backend = await createStorageBackend(config, this.environment);
    } catch (error) {
      throw registryBackendError(error);
    }
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
    const probes = await Promise.all(memberIds.map((memberId) => this.probeBackend(memberId)));
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
        const health = await this.probeBackend(config.id);
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

  private async probeBackend(id: string): Promise<BackendHealth> {
    try {
      return await (await this.getBackend(id)).probe();
    } catch (error) {
      return {
        reason: registryBackendError(error).message,
        status: "unavailable",
      };
    }
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
