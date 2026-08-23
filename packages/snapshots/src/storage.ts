import type { MirrorObject } from "../../storage/src/mirror";

export type SnapshotObjectStore = {
  deleteObject(key: string): Promise<void>;
  getObject(key: string, expectedChecksum: string): Promise<Uint8Array>;
  putObject(key: string, contents: Uint8Array): Promise<MirrorObject>;
};

export type SnapshotObjectResolver = (
  volumeId: string,
) => Promise<SnapshotObjectStore> | SnapshotObjectStore;

export const chunkKey = (bundleId: string, index: number): string =>
  `_snapshot-bundles/${bundleId}/chunks/${String(index).padStart(8, "0")}.bin`;

export const manifestKey = (bundleId: string): string =>
  `_snapshot-bundles/${bundleId}/manifest.json`;

export const signatureKey = (bundleId: string): string =>
  `_snapshot-bundles/${bundleId}/manifest.sig`;
