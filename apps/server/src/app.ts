import type { Database } from "bun:sqlite";
import { Hono } from "hono";

import { AuthService } from "../../../packages/auth/src/auth";
import { StorageRegistry } from "../../../packages/storage/src/registry";

import {
  registerAuthMiddleware,
  registerProtectedAuthRoutes,
  registerPublicAuthRoutes,
} from "./auth-routes";
import { errorResponse } from "./errors";
import { registerStorageRoutes } from "./storage-routes";
import type { AppEnvironment, AppServices } from "./types";

export type CreateAppOptions = {
  readonly dataDir: string;
  readonly database: Database;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly peerAddress?: (request: Request) => string;
};

export const createApp = (options: CreateAppOptions): Hono<AppEnvironment> => {
  const app = new Hono<AppEnvironment>();
  const services: AppServices = {
    auth: new AuthService(options.database),
    database: options.database,
    peerAddress: options.peerAddress ?? (() => "127.0.0.1"),
    registry: new StorageRegistry(options.database, options.environment),
  };

  app.onError((error, context) => errorResponse(context, error));
  registerPublicAuthRoutes(app, services);
  registerAuthMiddleware(app, services);
  registerProtectedAuthRoutes(app, services);
  registerStorageRoutes(app, services);

  return app;
};
