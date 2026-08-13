import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { migrate } from "./migrations";

describe("migrate", () => {
  test("creates the complete schema and remains idempotent", () => {
    const database = new Database(":memory:");
    try {
      migrate(database);
      migrate(database);

      const tables = database
        .query<{ readonly name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map(({ name }) => name);

      expect(tables).toContain("api_tokens");
      expect(tables).toContain("file_versions");
      expect(tables).toContain("files");
      expect(tables).toContain("photo_albums");
      expect(tables).toContain("photo_album_items");
      expect(tables).toContain("photo_jobs");
      expect(tables).toContain("photos");
      expect(tables).toContain("schema_migrations");
      expect(tables).toContain("sessions");
      expect(tables).toContain("storage_backends");
      expect(tables).toContain("storage_volumes");
      expect(tables).toContain("users");
      expect(
        database
          .query<{ readonly sql: string }, []>(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'photos'",
          )
          .get()?.sql,
      ).toContain("'heic'");
    } finally {
      database.close();
    }
  });

  test("widens an existing JPEG-only photo table without losing rows", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE photos (
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
        INSERT INTO photos VALUES (
          'photo-1', '${"a".repeat(64)}', 'existing.jpg', 'jpeg', 4, 3,
          '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z',
          'photos/originals/existing.jpg', 'photos/previews/existing.webp'
        );
      `);

      migrate(database);

      expect(
        database
          .query<{ readonly filename: string; readonly format: string }, []>(
            "SELECT filename, format FROM photos",
          )
          .get(),
      ).toEqual({ filename: "existing.jpg", format: "jpeg" });
      expect(
        database
          .query<{ readonly sql: string }, []>(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'photos'",
          )
          .get()?.sql,
      ).toContain("'heic'");
    } finally {
      database.close();
    }
  });
});
