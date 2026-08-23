import { describe, expect, test } from "bun:test";

import type { SnapshotNotification, SnapshotNotifier } from "./notifications";
import { runSnapshotWorkflow } from "./workflow";

class MemoryNotifier implements SnapshotNotifier {
  public readonly notifications: SnapshotNotification[] = [];

  public async send(notification: SnapshotNotification): Promise<void> {
    this.notifications.push(notification);
  }
}

const created = {
  bundleId: "00000000-0000-4000-8000-000000000001",
  snapshotId: "00112233445566778899aabbccddeeff",
  totalBytes: 26_047_286,
} as const;

describe("runSnapshotWorkflow", () => {
  test("retains completed snapshots before reporting success", async () => {
    const order: string[] = [];
    const notifier = new MemoryNotifier();

    const result = await runSnapshotWorkflow({
      create: async () => {
        order.push("create");
        return created;
      },
      notifier: {
        send: async (notification) => {
          order.push("notify");
          await notifier.send(notification);
        },
      },
      prepare: async () => {
        order.push("prepare");
      },
      retain: async () => {
        order.push("retain");
        return { deletedBundleIds: ["old-bundle"], retainedCount: 14 };
      },
    });

    expect(order).toEqual(["prepare", "create", "retain", "notify"]);
    expect(result).toEqual({
      ...created,
      retention: { deletedBundleIds: ["old-bundle"], retainedCount: 14 },
    });
    expect(notifier.notifications).toEqual([
      {
        ...created,
        deletedCount: 1,
        kind: "success",
        retainedCount: 14,
      },
    ]);
  });

  test("reports backup failure and preserves the original error", async () => {
    const notifier = new MemoryNotifier();
    const failure = new Error("mysqldump failed");

    await expect(
      runSnapshotWorkflow({
        create: async () => {
          throw failure;
        },
        notifier,
        prepare: async () => undefined,
        retain: async () => ({ deletedBundleIds: [], retainedCount: 0 }),
      }),
    ).rejects.toBe(failure);

    expect(notifier.notifications).toEqual([
      { kind: "backup_failure", reason: "mysqldump failed" },
    ]);
  });

  test("reports retention failure with the completed bundle id", async () => {
    const notifier = new MemoryNotifier();
    const failure = new Error("delete failed");

    await expect(
      runSnapshotWorkflow({
        create: async () => created,
        notifier,
        prepare: async () => undefined,
        retain: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(notifier.notifications).toEqual([
      {
        bundleId: created.bundleId,
        kind: "retention_failure",
        reason: "delete failed",
      },
    ]);
  });

  test("reports credential preparation failure before starting backup work", async () => {
    const notifier = new MemoryNotifier();
    const failure = new Error("Keychain item is unavailable");
    let createdSnapshot = false;

    await expect(
      runSnapshotWorkflow({
        create: async () => {
          createdSnapshot = true;
          return created;
        },
        notifier,
        prepare: async () => {
          throw failure;
        },
        retain: async () => ({ deletedBundleIds: [], retainedCount: 0 }),
      }),
    ).rejects.toBe(failure);

    expect(createdSnapshot).toBe(false);
    expect(notifier.notifications).toEqual([
      { kind: "backup_failure", reason: "Keychain item is unavailable" },
    ]);
  });
});
