import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";

import { migrate } from "../../database/src/migrations";
import { FileCatalog } from "./catalog";

describe("FileCatalog browsing", () => {
  let database: Database;

  const createCatalog = (): FileCatalog => {
    database = new Database(":memory:");
    migrate(database);
    return new FileCatalog(database, "photos", () => new Date("2026-08-11T00:00:00.000Z"));
  };

  const add = (catalog: FileCatalog, path: string, marker: string): void => {
    catalog.addVersion(path, {
      checksum: marker.repeat(64).slice(0, 64),
      key: `blobs/${marker}`,
      size: marker.length,
    });
  };

  afterEach(() => {
    database.close();
  });

  test("paginates live direct children across file and folder collisions", () => {
    const catalog = createCatalog();
    add(catalog, "documents/guides", "a");
    add(catalog, "documents/guides/start.txt", "b");
    add(catalog, "documents/notes.txt", "c");
    add(catalog, "documents/readme.txt", "d");
    add(catalog, "documents/deleted.txt", "e");
    catalog.delete("documents/deleted.txt");

    const first = catalog.listCurrent("documents/", 2, null);
    expect(first.entries).toEqual([
      { kind: "folder", path: "documents/guides" },
      expect.objectContaining({
        kind: "file",
        path: "documents/guides",
        size: 1,
      }),
    ]);
    expect(first.nextCursor).toEqual({ kind: "file", path: "documents/guides" });

    const second = catalog.listCurrent("documents/", 2, first.nextCursor);
    expect(second.entries).toEqual([
      expect.objectContaining({ kind: "file", path: "documents/notes.txt" }),
      expect.objectContaining({ kind: "file", path: "documents/readme.txt" }),
    ]);
    expect(second.nextCursor).toBeNull();
  });

  test("escapes wildcard prefixes and validates browse boundaries", () => {
    const catalog = createCatalog();
    add(catalog, "100%/proof.txt", "p");
    add(catalog, "1000/unrelated.txt", "u");
    add(catalog, "case-sensitive/proof.txt", "c");

    expect(catalog.listCurrent("100%/", 50, null).entries).toEqual([
      expect.objectContaining({ kind: "file", path: "100%/proof.txt" }),
    ]);
    expect(catalog.listCurrent("Case-Sensitive/", 50, null).entries).toEqual([]);
    for (const prefix of ["documents", "../", "/absolute/", "documents//", "a\0/"]) {
      expect(() => catalog.listCurrent(prefix, 50, null), prefix).toThrow("invalid");
    }
    for (const limit of [0, 101]) {
      expect(() => catalog.listCurrent("", limit, null), String(limit)).toThrow("invalid");
    }
  });
});
