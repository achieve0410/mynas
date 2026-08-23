import type { Database } from "bun:sqlite";

type SchemaVersionRow = {
  readonly version: number | null;
};

export class UnsupportedCatalogSchemaError extends Error {
  public constructor(
    public readonly foundVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `catalog uses newer schema ${foundVersion}; this runtime supports through ${currentVersion}`,
    );
    this.name = "UnsupportedCatalogSchemaError";
  }
}

export const assertCatalogSchemaSupported = (database: Database, currentVersion: number): void => {
  const migrationTable = database
    .query<{ readonly exists: number }, []>(
      `SELECT 1 AS "exists"
       FROM sqlite_master
       WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get();
  if (migrationTable === null) {
    return;
  }
  const stored = database
    .query<SchemaVersionRow, []>("SELECT MAX(version) AS version FROM schema_migrations")
    .get();
  if (
    stored?.version !== null &&
    stored?.version !== undefined &&
    stored.version > currentVersion
  ) {
    throw new UnsupportedCatalogSchemaError(stored.version, currentVersion);
  }
};
