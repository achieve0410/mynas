import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { migrate } from "../../../packages/database/src/migrations";

import { createApp, createAppServices } from "./app";
import { createServiceLogger } from "./logging";

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
  await mkdir(options.dataDir, { mode: 0o700, recursive: true });
  await chmod(options.dataDir, 0o700);

  const database = new Database(join(options.dataDir, "mynas.sqlite"), { create: true });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  migrate(database);

  const logger = createServiceLogger(options.environment);

  let server: ReturnType<typeof Bun.serve> | undefined;
  const services = createAppServices({
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
  try {
    server = Bun.serve({
      fetch: app.fetch,
      hostname: options.host,
      maxRequestBodySize: 64 * 1_024 * 1_024,
      port: options.port,
    });
  } catch (error) {
    database.close();
    throw error;
  }
  if (server.port === undefined) {
    server.stop(true);
    database.close();
    throw new Error("server did not bind a TCP port");
  }
  const port = server.port;
  try {
    services.scheduler.start();
  } catch (error) {
    server.stop(true);
    database.close();
    throw error;
  }
  logger.info({ host: options.host, port }, "MyNAS listening");
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopPromise !== undefined) {
      return stopPromise;
    }
    stopPromise = (async () => {
      server.stop(true);
      services.scheduler.stop();
      try {
        await services.maintenance.waitForIdle();
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
};
