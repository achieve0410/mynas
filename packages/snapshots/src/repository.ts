import type { Database } from "bun:sqlite";

import type { BeginSnapshotInput, SnapshotBundle, SnapshotChunk, SnapshotStatus } from "./models";

type BundleRow = {
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly expected_chunk_count: number;
  readonly expected_total_bytes: number;
  readonly id: string;
  readonly manifest_checksum: string | null;
  readonly manifest_key: string | null;
  readonly producer_id: string;
  readonly producer_kind: string;
  readonly signature_checksum: string | null;
  readonly signature_key: string | null;
  readonly status: SnapshotStatus;
  readonly volume_id: string;
};

type ChunkRow = {
  readonly bundle_id: string;
  readonly checksum: string;
  readonly chunk_index: number;
  readonly size: number;
  readonly uploaded_at: string;
};

const mapBundle = (row: BundleRow): SnapshotBundle => ({
  completedAt: row.completed_at,
  createdAt: row.created_at,
  expectedChunkCount: row.expected_chunk_count,
  expectedTotalBytes: row.expected_total_bytes,
  id: row.id,
  manifestChecksum: row.manifest_checksum,
  manifestKey: row.manifest_key,
  producerId: row.producer_id,
  producerKind: row.producer_kind,
  signatureChecksum: row.signature_checksum,
  signatureKey: row.signature_key,
  status: row.status,
  volumeId: row.volume_id,
});

const mapChunk = (row: ChunkRow): SnapshotChunk => ({
  bundleId: row.bundle_id,
  checksum: row.checksum,
  index: row.chunk_index,
  size: row.size,
  uploadedAt: row.uploaded_at,
});

export class SnapshotRepository {
  public constructor(private readonly database: Database) {}

  public addChunk(chunk: SnapshotChunk): void {
    this.database
      .query(
        `INSERT INTO snapshot_bundle_chunks
         (bundle_id, chunk_index, checksum, size, uploaded_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(chunk.bundleId, chunk.index, chunk.checksum, chunk.size, chunk.uploadedAt);
  }

  public complete(
    id: string,
    values: {
      readonly completedAt: string;
      readonly manifestChecksum: string;
      readonly manifestKey: string;
      readonly signatureChecksum: string;
      readonly signatureKey: string;
    },
  ): SnapshotBundle | null {
    return this.database.transaction(() => {
      const update = this.database
        .query(
          `UPDATE snapshot_bundles
           SET status = 'complete', manifest_key = ?, manifest_checksum = ?,
               signature_key = ?, signature_checksum = ?, completed_at = ?
           WHERE id = ? AND status = 'uploading'`,
        )
        .run(
          values.manifestKey,
          values.manifestChecksum,
          values.signatureKey,
          values.signatureChecksum,
          values.completedAt,
          id,
        );
      return update.changes === 1 ? this.get(id) : null;
    })();
  }

  public create(id: string, input: BeginSnapshotInput, createdAt: string): SnapshotBundle {
    this.database
      .query(
        `INSERT INTO snapshot_bundles
         (id, volume_id, producer_kind, producer_id, expected_chunk_count,
          expected_total_bytes, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?)`,
      )
      .run(
        id,
        input.volumeId,
        input.producerKind,
        input.producerId,
        input.chunkCount,
        input.totalBytes,
        createdAt,
      );
    const bundle = this.get(id);
    if (bundle === null) {
      throw new Error("snapshot bundle insert did not persist");
    }
    return bundle;
  }

  public get(id: string): SnapshotBundle | null {
    const row = this.database
      .query<BundleRow, [string]>("SELECT * FROM snapshot_bundles WHERE id = ?")
      .get(id);
    return row === null ? null : mapBundle(row);
  }

  public getChunk(bundleId: string, index: number): SnapshotChunk | null {
    const row = this.database
      .query<ChunkRow, [string, number]>(
        "SELECT * FROM snapshot_bundle_chunks WHERE bundle_id = ? AND chunk_index = ?",
      )
      .get(bundleId, index);
    return row === null ? null : mapChunk(row);
  }

  public listChunks(bundleId: string): readonly SnapshotChunk[] {
    return this.database
      .query<ChunkRow, [string]>(
        "SELECT * FROM snapshot_bundle_chunks WHERE bundle_id = ? ORDER BY chunk_index",
      )
      .all(bundleId)
      .map(mapChunk);
  }

  public listComplete(): readonly SnapshotBundle[] {
    return this.database
      .query<BundleRow, []>(
        "SELECT * FROM snapshot_bundles WHERE status = 'complete' ORDER BY created_at DESC",
      )
      .all()
      .map(mapBundle);
  }

  public listUploadingBefore(cutoff: string): readonly SnapshotBundle[] {
    return this.database
      .query<BundleRow, [string]>(
        `SELECT * FROM snapshot_bundles
         WHERE status = 'uploading' AND created_at < ?
         ORDER BY created_at`,
      )
      .all(cutoff)
      .map(mapBundle);
  }

  public markDeleting(id: string): SnapshotBundle | null {
    return this.database.transaction(() => {
      this.database
        .query(
          `UPDATE snapshot_bundles SET status = 'deleting'
           WHERE id = ? AND status = 'complete'`,
        )
        .run(id);
      return this.get(id);
    })();
  }

  public remove(id: string): void {
    this.database.query("DELETE FROM snapshot_bundles WHERE id = ?").run(id);
  }
}
