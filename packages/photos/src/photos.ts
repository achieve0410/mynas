import type { Database } from "bun:sqlite";
import decodeHeic from "heic-decode";
import type { Sharp } from "sharp";
import sharp from "sharp";

import type { MirrorVolume } from "../../storage/src/mirror";
import {
  type Album,
  type IngestPhotoInput,
  PhotoError,
  type PhotoFormat,
  type PhotoIngestResult,
  type PhotoJob,
  type PhotoRecord,
} from "./models";
import { PhotoStore } from "./store";

export {
  type Album,
  type IngestPhotoInput,
  PhotoError,
  type PhotoErrorCode,
  type PhotoFormat,
  type PhotoIngestResult,
  type PhotoJob,
  type PhotoJobStatus,
  type PhotoRecord,
} from "./models";

export class PhotoService {
  private readonly store: PhotoStore;

  public constructor(
    database: Database,
    private readonly volume: MirrorVolume,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.store = new PhotoStore(database, this.clock);
  }

  public addToAlbum(albumId: string, photoId: string): Album {
    this.getAlbum(albumId);
    this.getPhoto(photoId);
    this.store.addToAlbum(albumId, photoId);
    return this.getAlbum(albumId);
  }

  public createAlbum(name: string): Album {
    const cleanName = name.trim();
    if (cleanName.length === 0) {
      throw new PhotoError("invalid_input", "album name is required");
    }
    return this.store.createAlbum(cleanName);
  }

  public getAlbum(albumId: string): Album {
    return this.store.getAlbum(albumId);
  }

  public getJob(jobId: string): PhotoJob {
    return this.store.getJob(jobId);
  }

  public async getOriginal(photoId: string): Promise<Uint8Array> {
    return this.volume.get(this.getPhoto(photoId).originalPath);
  }

  public getPhoto(photoId: string): PhotoRecord {
    return this.store.getPhoto(photoId);
  }

  public async getPreview(photoId: string): Promise<Uint8Array> {
    return this.volume.get(this.getPhoto(photoId).previewPath);
  }

  public async ingest(input: IngestPhotoInput): Promise<PhotoIngestResult> {
    const digest = checksum(input.contents);
    const existing = this.store.findByChecksum(digest);
    if (existing !== null) {
      return {
        deduplicated: true,
        job: this.store.recordCompletedJob(existing.id),
        photo: existing,
      };
    }

    const image = sharp(input.contents, { failOn: "error" });
    let format: PhotoFormat;
    let height: number;
    let preview: Uint8Array;
    let width: number;
    try {
      const metadata = await image.metadata();
      if (metadata.width === undefined || metadata.height === undefined) {
        throw new PhotoError("invalid_image", "unsupported or invalid image");
      }
      format = photoFormat(metadata.format);
      if (format === "heic") {
        const decoded = await decodeHeic({ buffer: input.contents });
        width = decoded.width;
        height = decoded.height;
        preview = await previewFrom(
          sharp(decoded.data, {
            raw: { channels: 4, height: decoded.height, width: decoded.width },
          }),
        );
      } else {
        width = metadata.width;
        height = metadata.height;
        preview = await previewFrom(image);
      }
    } catch {
      throw new PhotoError("invalid_image", "unsupported or invalid image");
    }

    const importedAt = this.clock().toISOString();
    const photo: PhotoRecord = {
      capturedAt: importedAt,
      checksum: digest,
      filename: input.filename,
      format,
      height,
      id: crypto.randomUUID(),
      importedAt,
      originalPath: `photos/originals/${digest}.${extensionFor(format)}`,
      previewPath: `photos/previews/${digest}.webp`,
      width,
    };
    await this.volume.put(photo.originalPath, input.contents);
    await this.volume.put(photo.previewPath, preview);
    const inserted = this.store.insertPhoto(photo);
    const persisted = inserted ? photo : this.store.findByChecksum(digest);
    if (persisted === null) {
      throw new PhotoError("invalid_input", "photo could not be persisted");
    }
    return {
      deduplicated: !inserted,
      job: this.store.recordCompletedJob(persisted.id),
      photo: persisted,
    };
  }

  public listTimeline(): readonly PhotoRecord[] {
    return this.store.listTimeline();
  }

  public listAlbums(): readonly Album[] {
    return this.store.listAlbums();
  }
}

const checksum = (contents: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(contents).digest("hex");

const extensionFor = (format: PhotoFormat): string =>
  format === "jpeg" ? "jpg" : format === "heic" ? "heic" : "png";

const photoFormat = (format: string | undefined): PhotoFormat => {
  if (format === "jpeg" || format === "png") {
    return format;
  }
  if (format === "heif") {
    return "heic";
  }
  throw new PhotoError("invalid_image", "unsupported or invalid image");
};

const previewFrom = async (image: Sharp): Promise<Uint8Array> =>
  new Uint8Array(
    await image
      .rotate()
      .resize({ fit: "inside", height: 1280, width: 1280, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer(),
  );
