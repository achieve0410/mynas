export type PhotoJobStatus = "completed" | "failed" | "processing" | "queued";
export type PhotoFormat = "heic" | "jpeg" | "png";

export type PhotoRecord = {
  readonly capturedAt: string;
  readonly checksum: string;
  readonly filename: string;
  readonly format: PhotoFormat;
  readonly height: number;
  readonly id: string;
  readonly importedAt: string;
  readonly originalPath: string;
  readonly previewPath: string;
  readonly width: number;
};

export type PhotoJob = {
  readonly error: string | null;
  readonly id: string;
  readonly photoId: string | null;
  readonly status: PhotoJobStatus;
};

export type PhotoIngestResult = {
  readonly deduplicated: boolean;
  readonly job: PhotoJob;
  readonly photo: PhotoRecord;
};

export type Album = {
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly photos: readonly PhotoRecord[];
};

export type IngestPhotoInput = {
  readonly contents: Uint8Array;
  readonly filename: string;
};

export type PhotoErrorCode = "invalid_image" | "invalid_input" | "not_found";

export class PhotoError extends Error {
  public constructor(
    public readonly code: PhotoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PhotoError";
  }
}
