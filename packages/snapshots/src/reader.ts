import { type SnapshotBundle, SnapshotError } from "./models";
import type { SnapshotRepository } from "./repository";
import { chunkKey, type SnapshotObjectResolver } from "./storage";

export class SnapshotReader {
  public constructor(
    private readonly repository: SnapshotRepository,
    private readonly resolveStore: SnapshotObjectResolver,
  ) {}

  public async readChunk(bundleId: string, index: number): Promise<Uint8Array> {
    const bundle = this.requireComplete(bundleId);
    const chunk = this.repository.getChunk(bundle.id, index);
    if (chunk === null) {
      throw new SnapshotError("not_found", "snapshot chunk not found");
    }
    return (await this.resolveStore(bundle.volumeId)).getObject(
      chunkKey(bundle.id, index),
      chunk.checksum,
    );
  }

  public async readManifest(bundleId: string): Promise<Uint8Array> {
    const bundle = this.requireComplete(bundleId);
    if (bundle.manifestKey === null || bundle.manifestChecksum === null) {
      throw new SnapshotError("storage", "completed snapshot manifest is unavailable");
    }
    return (await this.resolveStore(bundle.volumeId)).getObject(
      bundle.manifestKey,
      bundle.manifestChecksum,
    );
  }

  public async readSignature(bundleId: string): Promise<Uint8Array> {
    const bundle = this.requireComplete(bundleId);
    if (bundle.signatureKey === null || bundle.signatureChecksum === null) {
      throw new SnapshotError("storage", "completed snapshot signature is unavailable");
    }
    return (await this.resolveStore(bundle.volumeId)).getObject(
      bundle.signatureKey,
      bundle.signatureChecksum,
    );
  }

  private requireComplete(bundleId: string): SnapshotBundle {
    const bundle = this.repository.get(bundleId);
    if (bundle === null || bundle.status !== "complete") {
      throw new SnapshotError("not_found", "snapshot not found");
    }
    return bundle;
  }
}
