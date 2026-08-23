import type { SnapshotBundle } from "../../snapshots/src/models";

export type SnapshotRetentionClient = {
  delete(bundleId: string): Promise<void>;
  list(): Promise<readonly SnapshotBundle[]>;
};

export type SnapshotRetentionResult = {
  readonly deletedBundleIds: readonly string[];
  readonly retainedCount: number;
};

type SnapshotRetentionOptions = {
  readonly client: SnapshotRetentionClient;
  readonly keepCount: number;
  readonly producerKind: string;
  readonly volumeId: string;
};

export class SnapshotRetentionPolicy {
  public constructor(private readonly options: SnapshotRetentionOptions) {
    if (!Number.isInteger(options.keepCount) || options.keepCount <= 0) {
      throw new RangeError("snapshot retention keep count must be a positive integer");
    }
  }

  public async apply(): Promise<SnapshotRetentionResult> {
    const completed = (await this.options.client.list())
      .filter(
        (bundle) =>
          bundle.status === "complete" &&
          bundle.completedAt !== null &&
          bundle.producerKind === this.options.producerKind &&
          bundle.volumeId === this.options.volumeId,
      )
      .toSorted((left, right) => {
        const completedOrder = left.completedAt?.localeCompare(right.completedAt ?? "") ?? 0;
        return completedOrder === 0 ? left.id.localeCompare(right.id) : completedOrder;
      });
    const expired = completed.slice(0, Math.max(0, completed.length - this.options.keepCount));
    const deletedBundleIds: string[] = [];
    for (const bundle of expired) {
      await this.options.client.delete(bundle.id);
      deletedBundleIds.push(bundle.id);
    }
    return {
      deletedBundleIds,
      retainedCount: completed.length - deletedBundleIds.length,
    };
  }
}
