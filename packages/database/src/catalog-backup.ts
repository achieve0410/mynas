import { Database } from "bun:sqlite";
import { chmod, link, mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { CURRENT_SCHEMA_VERSION } from "./migrations";

type IntegrityRow = {
  readonly integrity_check: string;
};

type MigrationRow = {
  readonly version: number | null;
};

export type CatalogOperationResult = {
  readonly integrity: "ok";
  readonly path: string;
};

export type CatalogOperationErrorCode =
  | "backup_destination_exists"
  | "catalog_exists"
  | "catalog_not_found"
  | "invalid_backup"
  | "operation_failed";

export class CatalogOperationError extends Error {
  public constructor(
    public readonly code: CatalogOperationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CatalogOperationError";
  }
}

const hasErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

const validateCatalog = (database: Database, invalidMessage: string): void => {
  try {
    const integrity = database
      .query<IntegrityRow, []>("PRAGMA integrity_check")
      .all()
      .map(({ integrity_check }) => integrity_check);
    const foreignKeyViolations = database.query("PRAGMA foreign_key_check").all();
    const migration = database
      .query<MigrationRow, []>("SELECT MAX(version) AS version FROM schema_migrations")
      .get();

    if (
      integrity.length !== 1 ||
      integrity[0] !== "ok" ||
      foreignKeyViolations.length !== 0 ||
      migration?.version !== CURRENT_SCHEMA_VERSION
    ) {
      throw new CatalogOperationError("invalid_backup", invalidMessage);
    }
  } catch (error) {
    if (error instanceof CatalogOperationError) {
      throw error;
    }
    throw new CatalogOperationError("invalid_backup", invalidMessage, { cause: error });
  }
};

const openCatalog = (path: string, missingMessage: string): Database => {
  try {
    return new Database(path, { readonly: true });
  } catch (error) {
    throw new CatalogOperationError("catalog_not_found", missingMessage, { cause: error });
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
};

const snapshotCatalog = async (
  database: Database,
  targetPath: string,
  existsCode: CatalogOperationErrorCode,
  existsMessage: string,
  invalidMessage: string,
): Promise<void> => {
  if (await pathExists(targetPath)) {
    throw new CatalogOperationError(existsCode, existsMessage);
  }
  const temporaryPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.snapshot-${crypto.randomUUID()}`,
  );
  try {
    database.query("VACUUM INTO ?").run(temporaryPath);
    await chmod(temporaryPath, 0o600);

    const snapshot = openCatalog(temporaryPath, invalidMessage);
    try {
      validateCatalog(snapshot, invalidMessage);
    } finally {
      snapshot.close();
    }

    try {
      await link(temporaryPath, targetPath);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        throw new CatalogOperationError(existsCode, existsMessage, { cause: error });
      }
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

export const backupCatalog = async (
  dataDir: string,
  output: string,
): Promise<CatalogOperationResult> => {
  const sourcePath = join(resolve(dataDir), "mynas.sqlite");
  const outputPath = resolve(output);
  const source = openCatalog(sourcePath, `catalog not found at ${sourcePath}`);
  try {
    validateCatalog(source, `invalid catalog at ${sourcePath}`);
    await mkdir(dirname(outputPath), { mode: 0o700, recursive: true });
    await snapshotCatalog(
      source,
      outputPath,
      "backup_destination_exists",
      `backup output already exists at ${outputPath}`,
      `invalid catalog backup at ${outputPath}`,
    );
  } catch (error) {
    if (error instanceof CatalogOperationError) {
      throw error;
    }
    throw new CatalogOperationError("operation_failed", "catalog backup failed", { cause: error });
  } finally {
    source.close();
  }
  return { integrity: "ok", path: outputPath };
};

export const backupCatalogDatabase = async (
  database: Database,
  output: string,
  options: { readonly createParent?: boolean } = {},
): Promise<CatalogOperationResult> => {
  const outputPath = resolve(output);
  try {
    validateCatalog(database, "invalid live catalog");
    if (options.createParent !== false) {
      await mkdir(dirname(outputPath), { mode: 0o700, recursive: true });
    }
    await snapshotCatalog(
      database,
      outputPath,
      "backup_destination_exists",
      `backup output already exists at ${outputPath}`,
      `invalid catalog backup at ${outputPath}`,
    );
  } catch (error) {
    if (error instanceof CatalogOperationError) {
      throw error;
    }
    throw new CatalogOperationError("operation_failed", "catalog backup failed", {
      cause: error,
    });
  }
  return { integrity: "ok", path: outputPath };
};

export const restoreCatalog = async (
  dataDir: string,
  input: string,
): Promise<CatalogOperationResult> => {
  const inputPath = resolve(input);
  const targetDirectory = resolve(dataDir);
  const targetPath = join(targetDirectory, "mynas.sqlite");
  const inputCatalog = openCatalog(inputPath, `invalid catalog backup at ${inputPath}`);

  try {
    validateCatalog(inputCatalog, `invalid catalog backup at ${inputPath}`);
    await mkdir(targetDirectory, { mode: 0o700, recursive: true });
    await chmod(targetDirectory, 0o700);
    for (const artifact of [targetPath, `${targetPath}-wal`, `${targetPath}-shm`] as const) {
      if (await pathExists(artifact)) {
        throw new CatalogOperationError(
          "catalog_exists",
          `catalog already exists at ${targetPath}`,
        );
      }
    }
    await snapshotCatalog(
      inputCatalog,
      targetPath,
      "catalog_exists",
      `catalog already exists at ${targetPath}`,
      "catalog restore produced invalid output",
    );
  } catch (error) {
    if (error instanceof CatalogOperationError) {
      throw error;
    }
    throw new CatalogOperationError("operation_failed", "catalog restore failed", { cause: error });
  } finally {
    inputCatalog.close();
  }

  return { integrity: "ok", path: targetPath };
};
