import type { Database } from "bun:sqlite";

import type { PhotoMetadata } from "./metadata";

export type PhotoMetadataCandidate = {
  readonly claimedAt: string;
  readonly id: string;
  readonly importedAt: string;
  readonly originalPath: string;
};

type CandidateRow = {
  readonly id: string;
  readonly imported_at: string;
  readonly original_path: string;
};

const CLAIM_STALE_AFTER_MS = 30 * 60 * 1_000;

export class PhotoMetadataStore {
  public constructor(
    private readonly database: Database,
    private readonly clock: () => Date,
  ) {}

  public claim(limit: number): readonly PhotoMetadataCandidate[] {
    const claimedAt = this.clock();
    const staleBefore = new Date(claimedAt.getTime() - CLAIM_STALE_AFTER_MS).toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.database
        .query<CandidateRow, [string, number]>(
          `SELECT id, imported_at, original_path
           FROM photos
           WHERE metadata_version = 0
              OR (metadata_version = -1 AND metadata_claimed_at <= ?)
           ORDER BY imported_at, id
           LIMIT ?`,
        )
        .all(staleBefore, limit);
      const claim = this.database.query(
        `UPDATE photos
         SET metadata_version = -1, metadata_claimed_at = ?
         WHERE id = ?
           AND (
             metadata_version = 0
             OR (metadata_version = -1 AND metadata_claimed_at <= ?)
           )`,
      );
      const candidates = rows.flatMap((row) => {
        const claimToken = claimedAt.toISOString();
        const result = claim.run(claimToken, row.id, staleBefore);
        return result.changes === 1
          ? [
              {
                claimedAt: claimToken,
                id: row.id,
                importedAt: row.imported_at,
                originalPath: row.original_path,
              },
            ]
          : [];
      });
      this.database.exec("COMMIT");
      return candidates;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public complete(photoId: string, claimedAt: string, metadata: PhotoMetadata): boolean {
    const result = this.database
      .query(
        `UPDATE photos
         SET captured_at = ?, latitude = ?, longitude = ?,
             metadata_version = 1, metadata_claimed_at = NULL
         WHERE id = ? AND metadata_version = -1 AND metadata_claimed_at = ?`,
      )
      .run(
        metadata.capturedAt,
        metadata.location?.latitude ?? null,
        metadata.location?.longitude ?? null,
        photoId,
        claimedAt,
      );
    return result.changes === 1;
  }

  public release(photoId: string, claimedAt: string): boolean {
    const result = this.database
      .query(
        `UPDATE photos
         SET metadata_version = 0, metadata_claimed_at = NULL
         WHERE id = ? AND metadata_version = -1 AND metadata_claimed_at = ?`,
      )
      .run(photoId, claimedAt);
    return result.changes === 1;
  }

  public remaining(): number {
    return (
      this.database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM photos WHERE metadata_version != 1",
        )
        .get()?.count ?? 0
    );
  }
}
