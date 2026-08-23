import type { Database } from "bun:sqlite";
import { isAbsolute } from "node:path";

import { CatalogError } from "./catalog-error";
import { listUnicodeCurrentFiles } from "./catalog-unicode-search";

export type FileListCursor = {
  readonly kind: "file" | "folder";
  readonly path: string;
};

export type FileListEntry =
  | {
      readonly kind: "folder";
      readonly path: string;
    }
  | {
      readonly checksum: string;
      readonly createdAt: string;
      readonly kind: "file";
      readonly path: string;
      readonly size: number;
      readonly versionId: string;
    };

export type FileListPage = {
  readonly entries: readonly FileListEntry[];
  readonly nextCursor: FileListCursor | null;
  readonly prefix: string;
};

export type FileListOptions = {
  readonly search?: string;
  readonly sort?: "name" | "type";
};

type BrowseRow = {
  readonly blob_checksum: string | null;
  readonly blob_size: number | null;
  readonly created_at: string | null;
  readonly kind: "file" | "folder";
  readonly path: string;
  readonly version_id: string | null;
};

const validatePrefix = (prefix: string): string => {
  if (prefix === "") {
    return prefix;
  }
  if (
    prefix.length > 1_024 ||
    !prefix.endsWith("/") ||
    prefix.includes("\0") ||
    prefix.includes("\\") ||
    isAbsolute(prefix)
  ) {
    throw new CatalogError("invalid_path", "invalid file prefix");
  }
  const segments = prefix.slice(0, -1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new CatalogError("invalid_path", "invalid file prefix");
  }
  return `${segments.join("/")}/`;
};

const validateCursor = (cursor: FileListCursor | null, prefix: string): FileListCursor | null => {
  if (cursor === null) {
    return null;
  }
  const relative = cursor.path.slice(prefix.length);
  if (
    !["file", "folder"].includes(cursor.kind) ||
    cursor.path.length > 1_024 ||
    !cursor.path.startsWith(prefix) ||
    relative.length === 0 ||
    relative.includes("/")
  ) {
    throw new CatalogError("invalid_page", "invalid file cursor");
  }
  return cursor;
};

const searchPattern = (search: string | undefined): string | null => {
  const normalized = search?.trim() ?? "";
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length > 256 || normalized.includes("\0")) {
    throw new CatalogError("invalid_page", "invalid file search");
  }
  return `%${normalized.toLocaleLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
};

const containsNonAscii = (value: string): boolean =>
  [...value].some((character) => (character.codePointAt(0) ?? 0) > 127);

export const listCurrentFiles = (
  database: Database,
  volumeId: string,
  prefix: string,
  limit: number,
  cursor: FileListCursor | null,
  options: FileListOptions = {},
): FileListPage => {
  const safePrefix = validatePrefix(prefix);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new CatalogError("invalid_page", "invalid file page limit");
  }
  const safeCursor = validateCursor(cursor, safePrefix);
  const pattern = searchPattern(options.search);
  const sort = options.sort ?? "name";
  const normalizedSearch = options.search?.trim().toLocaleLowerCase() ?? "";
  if (pattern !== null && containsNonAscii(normalizedSearch)) {
    return listUnicodeCurrentFiles({
      cursor: safeCursor,
      fetchPage: (scanCursor) =>
        listCurrentFiles(database, volumeId, safePrefix, 100, scanCursor, { sort }),
      limit,
      prefix: safePrefix,
      search: normalizedSearch,
    });
  }
  const cursorPath = safeCursor?.path ?? null;
  const cursorKindRank = safeCursor?.kind === "file" ? 1 : 0;
  const cursorClause =
    sort === "type"
      ? `(? IS NULL
          OR kind_rank > ?
          OR (kind_rank = ? AND path > ?))`
      : `(? IS NULL
          OR path > ?
          OR (path = ? AND kind_rank > ?))`;
  const orderClause = sort === "type" ? "kind_rank, path" : "path, kind_rank";
  const cursorValues =
    sort === "type"
      ? ([cursorKindRank, cursorKindRank, cursorPath] as const)
      : ([cursorPath, cursorPath, cursorKindRank] as const);
  const rows = database
    .query<
      BrowseRow,
      [
        string,
        string,
        string,
        string,
        string,
        string | null,
        string,
        string | null,
        string | null,
        string | number | null,
        string | number | null,
        string | number | null,
        number,
      ]
    >(
      `WITH current_files AS (
         SELECT
           v.id AS version_id,
           v.path AS source_path,
           v.blob_checksum,
           v.blob_size,
           v.created_at,
           substr(v.path, length(?) + 1) AS relative_path
         FROM files AS f
         JOIN file_versions AS v ON v.id = f.current_version_id
         WHERE f.volume_id = ?
           AND v.tombstone = 0
           AND substr(v.path, 1, length(?)) = ? COLLATE BINARY
       ),
       entries AS (
         SELECT
           CASE WHEN instr(relative_path, '/') = 0 THEN 'file' ELSE 'folder' END AS kind,
           CASE
             WHEN instr(relative_path, '/') = 0 THEN source_path
             ELSE ? || substr(relative_path, 1, instr(relative_path, '/') - 1)
           END AS path,
           CASE WHEN instr(relative_path, '/') = 0 THEN version_id ELSE NULL END AS version_id,
           CASE WHEN instr(relative_path, '/') = 0 THEN blob_checksum ELSE NULL END AS blob_checksum,
           CASE WHEN instr(relative_path, '/') = 0 THEN blob_size ELSE NULL END AS blob_size,
           CASE WHEN instr(relative_path, '/') = 0 THEN created_at ELSE NULL END AS created_at
         FROM current_files
       ),
       distinct_entries AS (
         SELECT DISTINCT
           kind,
           path,
           version_id,
           blob_checksum,
           blob_size,
           created_at,
           CASE kind WHEN 'folder' THEN 0 ELSE 1 END AS kind_rank
         FROM entries
       )
       SELECT kind, path, version_id, blob_checksum, blob_size, created_at
       FROM distinct_entries
         WHERE (? IS NULL OR lower(substr(path, length(?) + 1)) LIKE ? ESCAPE '\\')
         AND ${cursorClause}
       ORDER BY ${orderClause}
       LIMIT ?`,
    )
    .all(
      safePrefix,
      volumeId,
      safePrefix,
      safePrefix,
      safePrefix,
      pattern,
      safePrefix,
      pattern,
      cursorPath,
      cursorValues[0],
      cursorValues[1],
      cursorValues[2],
      limit + 1,
    );
  const pageRows = rows.slice(0, limit);
  const entries = pageRows.map((row): FileListEntry => {
    if (row.kind === "folder") {
      return { kind: "folder", path: row.path };
    }
    if (
      row.version_id === null ||
      row.blob_checksum === null ||
      row.blob_size === null ||
      row.created_at === null
    ) {
      throw new Error("current file listing row is incomplete");
    }
    return {
      checksum: row.blob_checksum,
      createdAt: row.created_at,
      kind: "file",
      path: row.path,
      size: row.blob_size,
      versionId: row.version_id,
    };
  });
  const last = pageRows.at(-1);
  return {
    entries,
    nextCursor:
      rows.length > limit && last !== undefined ? { kind: last.kind, path: last.path } : null,
    prefix: safePrefix,
  };
};
