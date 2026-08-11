import type { Database } from "bun:sqlite";

export const CURRENT_SCHEMA_VERSION = 5;

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

    CREATE TABLE IF NOT EXISTS storage_backends (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('local', 's3')),
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storage_volumes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind = 'mirror'),
      members_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format = 'jpeg'),
      width INTEGER NOT NULL CHECK (width > 0),
      height INTEGER NOT NULL CHECK (height > 0),
      captured_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      original_path TEXT NOT NULL UNIQUE,
      preview_path TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS photos_timeline_idx
      ON photos (captured_at DESC, imported_at DESC);

    CREATE TABLE IF NOT EXISTS photo_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
      photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photo_albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photo_album_items (
      album_id TEXT NOT NULL REFERENCES photo_albums(id) ON DELETE CASCADE,
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      PRIMARY KEY (album_id, photo_id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      owner_id TEXT NOT NULL UNIQUE
        CHECK (length(owner_id) = 32 AND owner_id NOT GLOB '*[^0-9a-f]*')
    );

    CREATE TABLE IF NOT EXISTS maintenance_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      backup_directory TEXT NOT NULL,
      backup_interval_hours INTEGER NOT NULL CHECK (backup_interval_hours BETWEEN 1 AND 8760),
      scrub_interval_hours INTEGER NOT NULL CHECK (scrub_interval_hours BETWEEN 1 AND 8760),
      retention_count INTEGER NOT NULL CHECK (retention_count BETWEEN 1 AND 100),
      destination_id TEXT NOT NULL
        CHECK (length(destination_id) = 32 AND destination_id NOT GLOB '*[^0-9a-f]*'),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maintenance_runs (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('catalog_backup', 'volume_scrub')),
      trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      output_path TEXT,
      summary_json TEXT,
      error TEXT,
      CHECK (
        (status = 'running' AND finished_at IS NULL)
        OR
        (status IN ('completed', 'failed') AND finished_at IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS maintenance_runs_kind_time_idx
      ON maintenance_runs (kind, started_at DESC);
  `);

  database
    .query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
};
