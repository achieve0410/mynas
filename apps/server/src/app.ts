import type { Database } from "bun:sqlite";
import { Hono } from "hono";

import { ActivityRepository } from "../../../packages/activity/src/repository";
import { AuthService } from "../../../packages/auth/src/auth";
import { backupCatalogDatabase } from "../../../packages/database/src/catalog-backup";
import { ProtectionIncidentStore } from "../../../packages/maintenance/src/incidents";
import { MaintenanceCoordinator } from "../../../packages/maintenance/src/maintenance";
import { MaintenanceRepository } from "../../../packages/maintenance/src/repository";
import { MaintenanceScheduler } from "../../../packages/maintenance/src/scheduler";
import { SnapshotRepository } from "../../../packages/snapshots/src/repository";
import { SnapshotService } from "../../../packages/snapshots/src/service";
import { StorageRegistry } from "../../../packages/storage/src/registry";

import { registerActivityRoutes } from "./activity-routes";
import {
  registerAuthMiddleware,
  registerProtectedAuthRoutes,
  registerPublicAuthRoutes,
} from "./auth-routes";
import { errorResponse } from "./errors";
import { registerFileRoutes } from "./file-routes";
import { registerMaintenanceRoutes } from "./maintenance-routes";
import { registerPhotoRoutes } from "./photo-routes";
import { registerProtectionRoutes } from "./protection-routes";
import { registerSnapshotBundleRoutes } from "./snapshot-bundle-routes";
import { registerStorageRoutes } from "./storage-routes";
import {
  createTransferNotificationService,
  registerTransferNotificationRoutes,
} from "./transfer-notifications";
import type { AppEnvironment, AppServices } from "./types";
import { registerWebRoutes } from "./web-routes";

export type AppServiceOptions = {
  readonly dataDir: string;
  readonly database: Database;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly onActivityRecordError?: (error: unknown) => void;
  readonly onMaintenanceError?: (error: unknown) => void;
  readonly peerAddress?: (request: Request) => string;
};

export type CreateAppOptions = AppServiceOptions & {
  readonly services?: AppServices;
};

export const createAppServices = (options: AppServiceOptions): AppServices => {
  const registry = new StorageRegistry(options.database, options.environment);
  const repository = new MaintenanceRepository(options.database);
  const incidents = new ProtectionIncidentStore(options.database);
  repository.failAbandonedRuns(incidents);
  const maintenance = new MaintenanceCoordinator({
    backup: async (outputPath) => {
      await backupCatalogDatabase(options.database, outputPath, { createParent: false });
    },
    dataDir: options.dataDir,
    incidents,
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
    activity: new ActivityRepository(options.database),
    activityRecordError:
      options.onActivityRecordError ??
      ((error) => {
        process.emitWarning(
          error instanceof Error ? error : new Error("unknown activity recording error"),
          { code: "MYNAS_ACTIVITY_RECORD_FAILED" },
        );
      }),
    auth: new AuthService(options.database),
    database: options.database,
    incidents,
    maintenance,
    peerAddress: options.peerAddress ?? (() => "127.0.0.1"),
    registry,
    scheduler,
    snapshots: new SnapshotService(new SnapshotRepository(options.database), async (id) =>
      registry.getVolume(id),
    ),
    transferNotifications: createTransferNotificationService(options.environment),
  };
};

export const createApp = (options: CreateAppOptions): Hono<AppEnvironment> => {
  const app = new Hono<AppEnvironment>();
  const services = options.services ?? createAppServices(options);

  app.onError((error, context) => errorResponse(context, error));
  registerPublicAuthRoutes(app, services);
  registerAuthMiddleware(app, services);
  registerProtectedAuthRoutes(app, services);
  registerActivityRoutes(app, services);
  registerTransferNotificationRoutes(app, services);
  registerStorageRoutes(app, services);
  registerFileRoutes(app, services);
  registerSnapshotBundleRoutes(app, services);
  registerPhotoRoutes(app, services);
  registerMaintenanceRoutes(app, services);
  registerProtectionRoutes(app, services);
  registerWebRoutes(app, options.environment.MYNAS_WEB_ROOT);

  return app;
};
