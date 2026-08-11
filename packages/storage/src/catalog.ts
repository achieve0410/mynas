import type { Database } from "bun:sqlite";
import { isAbsolute } from "node:path";

import { CatalogError } from "./catalog-error";
import { type FileListCursor, type FileListPage, listCurrentFiles } from "./catalog-listing";

export { CatalogError, type CatalogErrorCode } from "./catalog-error";
export type { FileListCursor, FileListEntry, FileListPage } from "./catalog-listing";

export type BlobDescriptor = {
  readonly checksum: string;
  readonly key: string;
  readonly size: number;
};

export type FileVersion = {
  readonly blob: BlobDescriptor | null;
  readonly createdAt: string;
  readonly id: string;
  readonly path: string;
  readonly tombstone: boolean;
};

type VersionRow = {
  readonly blob_checksum: string | null;
  readonly blob_key: string | null;
  readonly blob_size: number | null;
  readonly created_at: string;
  readonly id: string;
  readonly path: string;
  readonly tombstone: number;
};

type BlobRow = {
  readonly blob_checksum: string;
  readonly blob_key: string;
  readonly blob_size: number;
};

const validatePath = (path: string): string => {
  if (path.length === 0 || path.includes("\0") || path.includes("\\") || isAbsolute(path)) {
    throw new CatalogError("invalid_path", "invalid virtual path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new CatalogError("invalid_path", "invalid virtual path");
  }
  return segments.join("/");
};

const toVersion = (row: VersionRow): FileVersion => {
  const tombstone = row.tombstone === 1;
  return {
    blob: tombstone
      ? null
      : {
          checksum: row.blob_checksum ?? "",
          key: row.blob_key ?? "",
          size: row.blob_size ?? 0,
        },
    createdAt: row.created_at,
    id: row.id,
    path: row.path,
    tombstone,
  };
};

export class FileCatalog {
  public constructor(
    private readonly database: Database,
    private readonly volumeId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public addVersion(path: string, blob: BlobDescriptor): FileVersion {
    const safePath = validatePath(path);
    return this.withTransaction(() => this.insertVersion(safePath, blob));
  }

  public delete(path: string): FileVersion {
    const safePath = validatePath(path);
    return this.withTransaction(() => {
      if (this.getCurrent(safePath) === null) {
        throw new CatalogError("not_found", "file not found");
      }
      return this.insertVersion(safePath, null);
    });
  }

  public getCurrent(path: string): FileVersion | null {
    const safePath = validatePath(path);
    const row = this.database
      .query<VersionRow, [string, string]>(
        `SELECT v.id, v.path, v.blob_checksum, v.blob_key, v.blob_size, v.tombstone, v.created_at
         FROM files AS f
         JOIN file_versions AS v ON v.id = f.current_version_id
         WHERE f.volume_id = ? AND f.path = ?`,
      )
      .get(this.volumeId, safePath);
    if (row === null || row.tombstone === 1) {
      return null;
    }
    return toVersion(row);
  }

  public getVersion(path: string, versionId: string): FileVersion {
    const safePath = validatePath(path);
    const row = this.database
      .query<VersionRow, [string, string, string]>(
        `SELECT id, path, blob_checksum, blob_key, blob_size, tombstone, created_at
         FROM file_versions
         WHERE volume_id = ? AND path = ? AND id = ?`,
      )
      .get(this.volumeId, safePath, versionId);
    if (row === null || row.tombstone === 1) {
      throw new CatalogError("not_found", "restorable version not found");
    }
    return toVersion(row);
  }

  public listCurrent(prefix: string, limit: number, cursor: FileListCursor | null): FileListPage {
    return listCurrentFiles(this.database, this.volumeId, prefix, limit, cursor);
  }

  public listBlobs(): readonly BlobDescriptor[] {
    return this.database
      .query<BlobRow, [string]>(
        `SELECT blob_checksum, blob_key, blob_size
         FROM file_versions
         WHERE volume_id = ? AND tombstone = 0
         GROUP BY blob_checksum, blob_key, blob_size
         ORDER BY blob_checksum`,
      )
      .all(this.volumeId)
      .map((row) => ({
        checksum: row.blob_checksum,
        key: row.blob_key,
        size: row.blob_size,
      }));
  }

  public listVersions(path: string): readonly FileVersion[] {
    const safePath = validatePath(path);
    return this.database
      .query<VersionRow, [string, string]>(
        `SELECT id, path, blob_checksum, blob_key, blob_size, tombstone, created_at
         FROM file_versions
         WHERE volume_id = ? AND path = ?
         ORDER BY sequence`,
      )
      .all(this.volumeId, safePath)
      .map(toVersion);
  }

  public restore(path: string, versionId: string): FileVersion {
    const version = this.getVersion(path, versionId);
    if (version.blob === null) {
      throw new CatalogError("not_found", "restorable version not found");
    }
    return this.withTransaction(() => {
      return this.insertVersion(version.path, version.blob);
    });
  }

  private insertVersion(path: string, blob: BlobDescriptor | null): FileVersion {
    const version: FileVersion = {
      blob,
      createdAt: this.now().toISOString(),
      id: crypto.randomUUID(),
      path,
      tombstone: blob === null,
    };
    this.database
      .query(
        `INSERT INTO file_versions
         (id, volume_id, path, blob_checksum, blob_key, blob_size, tombstone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        this.volumeId,
        version.path,
        blob?.checksum ?? null,
        blob?.key ?? null,
        blob?.size ?? null,
        version.tombstone ? 1 : 0,
        version.createdAt,
      );
    this.database
      .query(
        `INSERT INTO files (volume_id, path, current_version_id)
         VALUES (?, ?, ?)
         ON CONFLICT (volume_id, path)
         DO UPDATE SET current_version_id = excluded.current_version_id`,
      )
      .run(this.volumeId, version.path, version.id);
    return version;
  }

  private withTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
