import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { migrate } from "../../../packages/database/src/migrations";

import { createApp } from "./app";
import { createServiceLogger } from "./logging";

export type StartServerOptions = {
  readonly dataDir: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly host: string;
  readonly port: number;
};

const activeDatabases = new Set<Database>();

export const startServer = async (options: StartServerOptions): Promise<void> => {
  await mkdir(options.dataDir, { mode: 0o700, recursive: true });
  await chmod(options.dataDir, 0o700);

  const database = new Database(join(options.dataDir, "mynas.sqlite"), { create: true });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  migrate(database);
  activeDatabases.add(database);

  const logger = createServiceLogger(options.environment);

  let server: ReturnType<typeof Bun.serve> | undefined;
  const app = createApp({
    dataDir: options.dataDir,
    database,
    environment: options.environment,
    peerAddress: (request) => server?.requestIP(request)?.address ?? "unknown",
  });
  server = Bun.serve({
    fetch: app.fetch,
    hostname: options.host,
    port: options.port,
  });
  logger.info({ host: options.host, port: server.port }, "MyNAS listening");
};
