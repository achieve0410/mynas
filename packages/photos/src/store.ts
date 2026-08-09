import type { Database } from "bun:sqlite";

import {
  type Album,
  PhotoError,
  type PhotoJob,
  type PhotoJobStatus,
  type PhotoRecord,
} from "./models";

type PhotoRow = {
  readonly captured_at: string;
  readonly checksum: string;
  readonly filename: string;
  readonly format: "jpeg";
  readonly height: number;
  readonly id: string;
  readonly imported_at: string;
  readonly original_path: string;
  readonly preview_path: string;
  readonly width: number;
};

type JobRow = {
  readonly error: string | null;
  readonly id: string;
  readonly photo_id: string | null;
  readonly status: PhotoJobStatus;
};

type AlbumRow = {
  readonly created_at: string;
  readonly id: string;
  readonly name: string;
};

const PHOTO_SELECT = `SELECT id, checksum, filename, format, width, height,
                             captured_at, imported_at, original_path, preview_path
                      FROM photos`;

const toPhoto = (row: PhotoRow): PhotoRecord => ({
  capturedAt: row.captured_at,
  checksum: row.checksum,
  filename: row.filename,
  format: row.format,
  height: row.height,
  id: row.id,
  importedAt: row.imported_at,
  originalPath: row.original_path,
  previewPath: row.preview_path,
  width: row.width,
});

export class PhotoStore {
  public constructor(
    private readonly database: Database,
    private readonly clock: () => Date,
  ) {}

  public addToAlbum(albumId: string, photoId: string): void {
    this.database
      .query(
        `INSERT OR IGNORE INTO photo_album_items (album_id, photo_id, added_at)
         VALUES (?, ?, ?)`,
      )
      .run(albumId, photoId, this.clock().toISOString());
  }

  public createAlbum(name: string): Album {
    const album: Album = {
      createdAt: this.clock().toISOString(),
      id: crypto.randomUUID(),
      name,
      photos: [],
    };
    this.database
      .query("INSERT INTO photo_albums (id, name, created_at) VALUES (?, ?, ?)")
      .run(album.id, album.name, album.createdAt);
    return album;
  }

  public findByChecksum(value: string): PhotoRecord | null {
    const row = this.database
      .query<PhotoRow, [string]>(`${PHOTO_SELECT} WHERE checksum = ?`)
      .get(value);
    return row === null ? null : toPhoto(row);
  }

  public getAlbum(albumId: string): Album {
    const row = this.database
      .query<AlbumRow, [string]>("SELECT id, name, created_at FROM photo_albums WHERE id = ?")
      .get(albumId);
    if (row === null) {
      throw new PhotoError("not_found", "album not found");
    }
    const photos = this.database
      .query<PhotoRow, [string]>(
        `SELECT p.id, p.checksum, p.filename, p.format, p.width, p.height,
                p.captured_at, p.imported_at, p.original_path, p.preview_path
         FROM photo_album_items AS i
         JOIN photos AS p ON p.id = i.photo_id
         WHERE i.album_id = ?
         ORDER BY i.added_at, p.id`,
      )
      .all(albumId)
      .map(toPhoto);
    return { createdAt: row.created_at, id: row.id, name: row.name, photos };
  }

  public getJob(jobId: string): PhotoJob {
    const row = this.database
      .query<JobRow, [string]>("SELECT id, status, photo_id, error FROM photo_jobs WHERE id = ?")
      .get(jobId);
    if (row === null) {
      throw new PhotoError("not_found", "photo job not found");
    }
    return { error: row.error, id: row.id, photoId: row.photo_id, status: row.status };
  }

  public getPhoto(photoId: string): PhotoRecord {
    const row = this.database
      .query<PhotoRow, [string]>(`${PHOTO_SELECT} WHERE id = ?`)
      .get(photoId);
    if (row === null) {
      throw new PhotoError("not_found", "photo not found");
    }
    return toPhoto(row);
  }

  public insertPhoto(photo: PhotoRecord): boolean {
    const result = this.database
      .query(
        `INSERT OR IGNORE INTO photos
         (id, checksum, filename, format, width, height, captured_at, imported_at,
          original_path, preview_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        photo.id,
        photo.checksum,
        photo.filename,
        photo.format,
        photo.width,
        photo.height,
        photo.capturedAt,
        photo.importedAt,
        photo.originalPath,
        photo.previewPath,
      );
    return result.changes === 1;
  }

  public listTimeline(): readonly PhotoRecord[] {
    return this.database
      .query<PhotoRow, []>(`${PHOTO_SELECT} ORDER BY captured_at DESC, imported_at DESC, id`)
      .all()
      .map(toPhoto);
  }

  public listAlbums(): readonly Album[] {
    return this.database
      .query<AlbumRow, []>(
        "SELECT id, name, created_at FROM photo_albums ORDER BY created_at DESC, id",
      )
      .all()
      .map(({ id }) => this.getAlbum(id));
  }

  public recordCompletedJob(photoId: string): PhotoJob {
    const job: PhotoJob = {
      error: null,
      id: crypto.randomUUID(),
      photoId,
      status: "completed",
    };
    this.database
      .query(
        `INSERT INTO photo_jobs (id, status, photo_id, error, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(job.id, job.status, job.photoId, job.error, this.clock().toISOString());
    return job;
  }
}
