import type { Database } from "bun:sqlite";

export const photoTableSql = (tableName: "photos" | "photos_v9", ifNotExists = false): string => `
  CREATE TABLE${ifNotExists ? " IF NOT EXISTS" : ""} ${tableName} (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('jpeg', 'png', 'heic')),
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    captured_at TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    original_path TEXT NOT NULL UNIQUE,
    preview_path TEXT NOT NULL UNIQUE,
    latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    metadata_version INTEGER NOT NULL DEFAULT 0
      CHECK (metadata_version IN (-1, 0, 1)),
    metadata_claimed_at TEXT,
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (latitude IS NOT NULL AND longitude IS NOT NULL)
    ),
    CHECK (
      (metadata_version = -1 AND metadata_claimed_at IS NOT NULL)
      OR (metadata_version IN (0, 1) AND metadata_claimed_at IS NULL)
    )
  )`;

export const migratePhotoMetadata = (database: Database): void => {
  const existingPhotoTableSql = database
    .query<{ readonly sql: string }, []>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'photos'",
    )
    .get()?.sql;
  if (
    existingPhotoTableSql === undefined ||
    (!existingPhotoTableSql.includes("CHECK (format = 'jpeg')") &&
      existingPhotoTableSql.includes("metadata_version"))
  ) {
    return;
  }
  database.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    ${photoTableSql("photos_v9")};
    INSERT INTO photos_v9 (
      id, checksum, filename, format, width, height, captured_at, imported_at,
      original_path, preview_path, latitude, longitude, metadata_version, metadata_claimed_at
    )
    SELECT id, checksum, filename, format, width, height, captured_at, imported_at,
           original_path, preview_path, NULL, NULL, 0, NULL
    FROM photos;
    DROP TABLE photos;
    ALTER TABLE photos_v9 RENAME TO photos;
    CREATE INDEX photos_timeline_idx
      ON photos (captured_at DESC, imported_at DESC);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
};
