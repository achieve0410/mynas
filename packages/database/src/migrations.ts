import type { Database } from "bun:sqlite";

const MIGRATION_VERSION = 2;

export const migrate = (database: Database): void => {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      volume_id TEXT NOT NULL,
      path TEXT NOT NULL,
      current_version_id TEXT NOT NULL,
      PRIMARY KEY (volume_id, path)
    );

    CREATE TABLE IF NOT EXISTS file_versions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      volume_id TEXT NOT NULL,
      path TEXT NOT NULL,
      blob_checksum TEXT,
      blob_key TEXT,
      blob_size INTEGER,
      tombstone INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
      created_at TEXT NOT NULL,
      CHECK (
        (tombstone = 1 AND blob_checksum IS NULL AND blob_key IS NULL AND blob_size IS NULL)
        OR
        (tombstone = 0 AND blob_checksum IS NOT NULL AND blob_key IS NOT NULL AND blob_size >= 0)
      )
    );

    CREATE INDEX IF NOT EXISTS file_versions_path_idx
      ON file_versions (volume_id, path, sequence);
  `);

  database
    .query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(MIGRATION_VERSION, new Date().toISOString());
};
