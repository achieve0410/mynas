import { describe, expect, test } from "bun:test";

import type { SnapshotBundle } from "../../snapshots/src/models";
import { type SnapshotRetentionClient, SnapshotRetentionPolicy } from "./retention";

const bundle = (sequence: number, overrides: Partial<SnapshotBundle> = {}): SnapshotBundle => ({
  completedAt: `2026-08-${String(sequence).padStart(2, "0")}T03:20:00.000Z`,
  createdAt: `2026-08-${String(sequence).padStart(2, "0")}T03:15:00.000Z`,
  expectedChunkCount: 4,
  expectedTotalBytes: 26_000_000,
  id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  manifestChecksum: "1".repeat(64),
  manifestKey: `manifest-${sequence}`,
  producerId: "fixture-producer",
  producerKind: "slack-dashboard",
  signatureChecksum: "2".repeat(64),
  signatureKey: `signature-${sequence}`,
  status: "complete",
  volumeId: "slack-backups",
  ...overrides,
});

class MemoryRetentionClient implements SnapshotRetentionClient {
  public readonly deleted: string[] = [];

  public constructor(private readonly bundles: readonly SnapshotBundle[]) {}

  public async delete(bundleId: string): Promise<void> {
    this.deleted.push(bundleId);
  }

  public async list(): Promise<readonly SnapshotBundle[]> {
    return this.bundles;
  }
}

describe("SnapshotRetentionPolicy", () => {
  test("deletes oldest completed Slack snapshots beyond the keep count", async () => {
    const scoped = Array.from({ length: 16 }, (_, index) => bundle(index + 1));
    const client = new MemoryRetentionClient([
      ...scoped.reverse(),
      bundle(17, { producerKind: "another-producer" }),
      bundle(18, { volumeId: "another-volume" }),
      bundle(19, { completedAt: null, status: "uploading" }),
    ]);
    const policy = new SnapshotRetentionPolicy({
      client,
      keepCount: 14,
      producerKind: "slack-dashboard",
      volumeId: "slack-backups",
    });

    const result = await policy.apply();

    expect(result).toEqual({
      deletedBundleIds: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ],
      retainedCount: 14,
    });
    expect(client.deleted).toEqual([...result.deletedBundleIds]);
  });

  test("preserves all completed snapshots while below the keep count", async () => {
    const client = new MemoryRetentionClient([bundle(2), bundle(1)]);
    const policy = new SnapshotRetentionPolicy({
      client,
      keepCount: 14,
      producerKind: "slack-dashboard",
      volumeId: "slack-backups",
    });

    const result = await policy.apply();

    expect(result).toEqual({ deletedBundleIds: [], retainedCount: 2 });
    expect(client.deleted).toEqual([]);
  });

  test("rejects a keep count that could remove every successful backup", () => {
    const client = new MemoryRetentionClient([]);

    expect(
      () =>
        new SnapshotRetentionPolicy({
          client,
          keepCount: 0,
          producerKind: "slack-dashboard",
          volumeId: "slack-backups",
        }),
    ).toThrow("positive integer");
  });
});
