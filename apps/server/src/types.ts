import type { Database } from "bun:sqlite";
import type { Hono } from "hono";

import type { AuthService, User } from "../../../packages/auth/src/auth";
import type { MaintenanceCoordinator } from "../../../packages/maintenance/src/maintenance";
import type { MaintenanceScheduler } from "../../../packages/maintenance/src/scheduler";
import type { StorageRegistry } from "../../../packages/storage/src/registry";

export type AppEnvironment = {
  Variables: {
    user: User;
  };
};

export type AppInstance = Hono<AppEnvironment>;

export type AppServices = {
  readonly auth: AuthService;
  readonly database: Database;
  readonly maintenance: MaintenanceCoordinator;
  readonly peerAddress: (request: Request) => string;
  readonly registry: StorageRegistry;
  readonly scheduler: MaintenanceScheduler;
};
