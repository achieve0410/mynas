import { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";

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

export const hasErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

export const validateCatalog = (
  database: Database,
  invalidMessage: string,
  minimumSchemaVersion = CURRENT_SCHEMA_VERSION,
): void => {
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
      migration?.version === null ||
      migration?.version === undefined ||
      migration.version < minimumSchemaVersion ||
      migration.version > CURRENT_SCHEMA_VERSION
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

export const openCatalog = (path: string, missingMessage: string): Database => {
  try {
    return new Database(path, { readonly: true });
  } catch (error) {
    throw new CatalogOperationError("catalog_not_found", missingMessage, { cause: error });
  }
};

export const pathExists = async (path: string): Promise<boolean> => {
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
