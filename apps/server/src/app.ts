import type { Database } from "bun:sqlite";
import { Hono } from "hono";

import { AuthService } from "../../../packages/auth/src/auth";
import { backupCatalogDatabase } from "../../../packages/database/src/catalog-backup";
import { MaintenanceCoordinator } from "../../../packages/maintenance/src/maintenance";
import { MaintenanceRepository } from "../../../packages/maintenance/src/repository";
import { MaintenanceScheduler } from "../../../packages/maintenance/src/scheduler";
import { StorageRegistry } from "../../../packages/storage/src/registry";

import {
  registerAuthMiddleware,
  registerProtectedAuthRoutes,
  registerPublicAuthRoutes,
} from "./auth-routes";
import { errorResponse } from "./errors";
import { registerMaintenanceRoutes } from "./maintenance-routes";
import { registerPhotoRoutes } from "./photo-routes";
import { registerStorageRoutes } from "./storage-routes";
import type { AppEnvironment, AppServices } from "./types";
import { registerWebRoutes } from "./web-routes";

export type AppServiceOptions = {
  readonly dataDir: string;
  readonly database: Database;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly onMaintenanceError?: (error: unknown) => void;
  readonly peerAddress?: (request: Request) => string;
};

export type CreateAppOptions = AppServiceOptions & {
  readonly services?: AppServices;
};

export const createAppServices = (options: AppServiceOptions): AppServices => {
  const registry = new StorageRegistry(options.database, options.environment);
  const repository = new MaintenanceRepository(options.database);
  repository.failAbandonedRuns();
  const maintenance = new MaintenanceCoordinator({
    backup: async (outputPath) => {
      await backupCatalogDatabase(options.database, outputPath, { createParent: false });
    },
    dataDir: options.dataDir,
    repository,
    volumes: {
      listIds: () => registry.listVolumes().map(({ id }) => id),
      scrub: async (id) => (await registry.getVolume(id)).scrub(),
    },
  });
  const scheduler = new MaintenanceScheduler({
    coordinator: maintenance,
    repository,
    ...(options.onMaintenanceError === undefined ? {} : { onError: options.onMaintenanceError }),
  });
  return {
    auth: new AuthService(options.database),
    database: options.database,
    maintenance,
    peerAddress: options.peerAddress ?? (() => "127.0.0.1"),
    registry,
    scheduler,
  };
};

export const createApp = (options: CreateAppOptions): Hono<AppEnvironment> => {
  const app = new Hono<AppEnvironment>();
  const services = options.services ?? createAppServices(options);

  app.onError((error, context) => errorResponse(context, error));
  registerPublicAuthRoutes(app, services);
  registerAuthMiddleware(app, services);
  registerProtectedAuthRoutes(app, services);
  registerStorageRoutes(app, services);
  registerPhotoRoutes(app, services);
  registerMaintenanceRoutes(app, services);
  registerWebRoutes(app);

  return app;
};
