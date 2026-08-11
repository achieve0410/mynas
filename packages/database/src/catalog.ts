import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { migrate } from "./migrations";

export const openCatalogDatabase = async (dataDir: string): Promise<Database> => {
  const directory = resolve(dataDir);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  const database = new Database(join(directory, "mynas.sqlite"), { create: true });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    migrate(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};
