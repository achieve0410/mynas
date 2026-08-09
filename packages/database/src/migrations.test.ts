import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { migrate } from "./migrations";

describe("migrate", () => {
  test("creates the auth schema and remains idempotent", () => {
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
      expect(tables).toContain("schema_migrations");
      expect(tables).toContain("sessions");
      expect(tables).toContain("storage_backends");
      expect(tables).toContain("storage_volumes");
      expect(tables).toContain("users");
    } finally {
      database.close();
    }
  });
});
