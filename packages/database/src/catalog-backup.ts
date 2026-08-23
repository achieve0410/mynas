import type { Database } from "bun:sqlite";
import { chmod, link, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  CatalogOperationError,
  type CatalogOperationErrorCode,
  type CatalogOperationResult,
  hasErrorCode,
  openCatalog,
  pathExists,
  validateCatalog,
} from "./catalog-validation";
import { CURRENT_SCHEMA_VERSION } from "./migrations";

const MINIMUM_RESTORABLE_SCHEMA_VERSION = 6;

export {
  CatalogOperationError,
  type CatalogOperationErrorCode,
  type CatalogOperationResult,
} from "./catalog-validation";

const snapshotCatalog = async (
  database: Database,
  targetPath: string,
  existsCode: CatalogOperationErrorCode,
  existsMessage: string,
  invalidMessage: string,
  minimumSchemaVersion = CURRENT_SCHEMA_VERSION,
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
      validateCatalog(snapshot, invalidMessage, minimumSchemaVersion);
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

const restoreCatalogVersion = async (options: {
  readonly dataDir: string;
  readonly input: string;
  readonly minimumSchemaVersion: number;
}): Promise<CatalogOperationResult> => {
  const inputPath = resolve(options.input);
  const targetDirectory = resolve(options.dataDir);
  const targetPath = join(targetDirectory, "mynas.sqlite");
  const inputCatalog = openCatalog(inputPath, `invalid catalog backup at ${inputPath}`);

  try {
    validateCatalog(
      inputCatalog,
      `invalid catalog backup at ${inputPath}`,
      options.minimumSchemaVersion,
    );
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
      options.minimumSchemaVersion,
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

export const restoreCatalog = async (
  dataDir: string,
  input: string,
): Promise<CatalogOperationResult> =>
  restoreCatalogVersion({
    dataDir,
    input,
    minimumSchemaVersion: CURRENT_SCHEMA_VERSION,
  });

export const stageCatalogForRestore = async (
  dataDir: string,
  input: string,
): Promise<CatalogOperationResult> =>
  restoreCatalogVersion({
    dataDir,
    input,
    minimumSchemaVersion: MINIMUM_RESTORABLE_SCHEMA_VERSION,
  });
