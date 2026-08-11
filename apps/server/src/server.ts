import { openCatalogDatabase } from "../../../packages/database/src/catalog";

import { createApp, createAppServices } from "./app";
import { createServiceLogger } from "./logging";
import type { AppServices } from "./types";

export type StartServerOptions = {
  readonly dataDir: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly host: string;
  readonly port: number;
};

export type StartedServer = {
  readonly port: number;
  readonly stop: () => Promise<void>;
};

export const startServer = async (options: StartServerOptions): Promise<StartedServer> => {
  const database = await openCatalogDatabase(options.dataDir);
  let server: ReturnType<typeof Bun.serve> | undefined;
  let services: AppServices | undefined;
  try {
    const logger = createServiceLogger(options.environment);
    services = createAppServices({
      dataDir: options.dataDir,
      database,
      environment: options.environment,
      onMaintenanceError: (error) => {
        logger.error(
          { err: error instanceof Error ? error : new Error("unknown maintenance error") },
          "maintenance scheduler failed",
        );
      },
      peerAddress: (request) => server?.requestIP(request)?.address ?? "unknown",
    });
    const app = createApp({
      dataDir: options.dataDir,
      database,
      environment: options.environment,
      services,
    });
    server = Bun.serve({
      fetch: app.fetch,
      hostname: options.host,
      maxRequestBodySize: 64 * 1_024 * 1_024,
      port: options.port,
    });
    if (server.port === undefined) {
      throw new Error("server did not bind a TCP port");
    }
    const port = server.port;
    services.scheduler.start();
    logger.info({ host: options.host, port }, "MyNAS listening");
    const runningServer = server;
    const runningServices = services;
    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      if (stopPromise !== undefined) {
        return stopPromise;
      }
      stopPromise = (async () => {
        runningServer.stop(true);
        runningServices.scheduler.stop();
        try {
          await runningServices.maintenance.waitForIdle();
        } finally {
          database.close();
        }
      })();
      return stopPromise;
    };
    return {
      port,
      stop,
    };
  } catch (error) {
    server?.stop(true);
    services?.scheduler.stop();
    database.close();
    throw error;
  }
};
