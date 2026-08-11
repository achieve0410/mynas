import type { Database } from "bun:sqlite";
import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

import { AuthService } from "../../auth/src/auth";
import { openCatalogDatabase } from "../../database/src/catalog";
import { backendConfigSchema } from "../../storage/src/backend-factory";
import { StorageRegistry } from "../../storage/src/registry";

const inputSchema = z
  .object({
    dataDir: z.string().refine(isAbsolute, "data directory must be absolute"),
    environment: z.record(z.string(), z.string().optional()),
    password: z.string().min(12),
    primaryRoot: z.string().refine(isAbsolute, "primary root must be absolute"),
    secondaryRoot: z.string().refine(isAbsolute, "secondary root must be absolute"),
    username: z.string().trim().min(1),
    volumeId: z.string().trim().min(1),
  })
  .refine((input) => resolve(input.primaryRoot) !== resolve(input.secondaryRoot), {
    message: "mirror roots must be distinct",
    path: ["secondaryRoot"],
  });

export type BootstrapLocalOptions = z.input<typeof inputSchema>;
export type BootstrapLocalDependencies = {
  readonly storageDeviceId: (path: string) => Promise<bigint>;
};

export type BootstrapLocalResult = {
  readonly createdBackends: readonly string[];
  readonly createdOwner: boolean;
  readonly createdVolume: boolean;
  readonly dataDir: string;
  readonly volumeId: string;
};

export class BootstrapError extends Error {
  public constructor(
    public readonly code: "configuration_conflict" | "unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BootstrapError";
  }
}

type BackendRow = {
  readonly config_json: string;
};

type OwnerRow = {
  readonly username: string;
};

type VolumeRow = {
  readonly members_json: string;
};

const backendRow = (database: Database, id: string): BackendRow | null =>
  database
    .query<BackendRow, [string]>("SELECT config_json FROM storage_backends WHERE id = ?")
    .get(id);

const assertBackend = (database: Database, id: string, expectedRoot: string): boolean => {
  const row = backendRow(database, id);
  if (row === null) {
    return false;
  }
  const config = backendConfigSchema.parse(JSON.parse(row.config_json));
  if (config.kind !== "local" || resolve(config.root) !== expectedRoot) {
    throw new BootstrapError(
      "configuration_conflict",
      `backend ${id} already uses a different storage root`,
    );
  }
  return true;
};

const assertVolume = (database: Database, volumeId: string): boolean => {
  const row = database
    .query<VolumeRow, [string]>("SELECT members_json FROM storage_volumes WHERE id = ?")
    .get(volumeId);
  if (row === null) {
    return false;
  }
  const members = z.tuple([z.string(), z.string()]).parse(JSON.parse(row.members_json));
  if (members[0] !== "primary" || members[1] !== "secondary") {
    throw new BootstrapError(
      "configuration_conflict",
      `volume ${volumeId} already uses different mirror members`,
    );
  }
  return true;
};

const pathContains = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

const authenticateOwner = async (
  database: Database,
  username: string,
  password: string,
): Promise<boolean> => {
  const owner = database.query<OwnerRow, []>("SELECT username FROM users LIMIT 1").get();
  if (owner === null) {
    return false;
  }
  const auth = new AuthService(database);
  await auth.verifyPassword(username, password);
  return true;
};

export const bootstrapLocal = async (
  options: BootstrapLocalOptions,
  dependencies: BootstrapLocalDependencies = {
    storageDeviceId: async (path) => (await stat(path, { bigint: true })).dev,
  },
): Promise<BootstrapLocalResult> => {
  const input = inputSchema.parse(options);
  const dataDir = resolve(input.dataDir);
  const primaryRoot = resolve(input.primaryRoot);
  const secondaryRoot = resolve(input.secondaryRoot);
  const database = await openCatalogDatabase(dataDir);
  try {
    const ownerExists = await authenticateOwner(database, input.username, input.password);
    const primaryExists = assertBackend(database, "primary", primaryRoot);
    const secondaryExists = assertBackend(database, "secondary", secondaryRoot);
    const volumeExists = assertVolume(database, input.volumeId);

    await Promise.all([
      mkdir(primaryRoot, { mode: 0o700, recursive: true }),
      mkdir(secondaryRoot, { mode: 0o700, recursive: true }),
    ]);
    const [dataIdentity, primaryIdentity, secondaryIdentity, primaryDevice, secondaryDevice] =
      await Promise.all([
        realpath(dataDir),
        realpath(primaryRoot),
        realpath(secondaryRoot),
        dependencies.storageDeviceId(primaryRoot),
        dependencies.storageDeviceId(secondaryRoot),
      ]);
    if (
      pathContains(dataIdentity, primaryIdentity) ||
      pathContains(primaryIdentity, dataIdentity) ||
      pathContains(dataIdentity, secondaryIdentity) ||
      pathContains(secondaryIdentity, dataIdentity)
    ) {
      throw new BootstrapError(
        "configuration_conflict",
        "catalog and backend roots must not overlap",
      );
    }
    if (primaryIdentity === secondaryIdentity || primaryDevice === secondaryDevice) {
      throw new BootstrapError(
        "configuration_conflict",
        "mirror roots must use distinct filesystem devices",
      );
    }

    if (!ownerExists) {
      await new AuthService(database).setupOwner(input.username, input.password, "127.0.0.1");
    }

    const registry = new StorageRegistry(database, input.environment);
    const createdBackends: string[] = [];
    if (!primaryExists) {
      await registry.addBackend({ id: "primary", kind: "local", root: primaryRoot });
      createdBackends.push("primary");
    }
    if (!secondaryExists) {
      await registry.addBackend({ id: "secondary", kind: "local", root: secondaryRoot });
      createdBackends.push("secondary");
    }
    if (!volumeExists) {
      await registry.addMirror(input.volumeId, ["primary", "secondary"]);
    }
    const health = await registry.getVolumeHealth(input.volumeId);
    if (health.status !== "healthy") {
      throw new BootstrapError("unavailable", "bootstrapped mirror is degraded");
    }

    return {
      createdBackends,
      createdOwner: !ownerExists,
      createdVolume: !volumeExists,
      dataDir,
      volumeId: input.volumeId,
    };
  } finally {
    database.close();
  }
};
