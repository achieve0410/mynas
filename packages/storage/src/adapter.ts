export type BackendHealth =
  | {
      readonly availableBytes?: number;
      readonly capacityBytes?: number;
      readonly status: "healthy";
      readonly filesystemIdentity?: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
    };

export type ByteRange = {
  readonly start: number;
  readonly endExclusive: number;
};

export type StoredObject = {
  readonly key: string;
  readonly size: number;
};

export interface StorageBackend {
  readonly id: string;
  readonly kind: "local" | "s3";
  readonly replicaIdentity: string;

  delete(key: string): Promise<void>;
  get(key: string, range?: ByteRange): Promise<Uint8Array>;
  probe(): Promise<BackendHealth>;
  put(key: string, contents: Uint8Array): Promise<StoredObject>;
  stat(key: string): Promise<StoredObject | null>;
}
