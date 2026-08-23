import { describe, expect, test } from "bun:test";

import { ApiError } from "./api";
import {
  type TransferBatchNotification,
  TransferManager,
  type TransferRequest,
  type TransferTask,
} from "./transfer-manager";

const eventWithin = async <Value>(
  promise: Promise<Value>,
  message: string,
  timeoutMs = 2_000,
): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });

const waitForTasks = (
  manager: TransferManager,
  predicate: (tasks: readonly TransferTask[]) => boolean,
): Promise<readonly TransferTask[]> =>
  new Promise((resolve) => {
    const unsubscribe = manager.subscribe(() => {
      const tasks = manager.getSnapshot().tasks;
      if (predicate(tasks)) {
        unsubscribe();
        resolve(tasks);
      }
    });
  });

describe("TransferManager", () => {
  test("bounds a ten-thousand-item batch with aggregate state and three active jobs", async () => {
    const notifications: TransferBatchNotification[] = [];
    let resolveNotification: (() => void) | undefined;
    const notified = new Promise<void>((resolve) => {
      resolveNotification = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    let settled = 0;
    let resolveThird: (() => void) | undefined;
    const thirdStarted = new Promise<void>((resolve) => {
      resolveThird = resolve;
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new TransferManager({
      concurrency: 3,
      notify: async (notification) => {
        notifications.push(notification);
        resolveNotification?.();
      },
      shouldPauseNetworkFailure: () => false,
    });
    const requests: TransferRequest[] = Array.from({ length: 10_000 }, (_, index) => ({
      execute: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        started += 1;
        if (started === 3) {
          resolveThird?.();
        }
        await gate;
        active -= 1;
      },
      id: `photo-${index}`,
      kind: "photo",
      label: `photo-${index}.jpg`,
      operation: "upload",
      path: `photo-${index}.jpg`,
      total: 1,
    }));
    const enqueueBatch = manager.enqueueBatch as (
      batchRequests: readonly TransferRequest[],
      options?: { readonly onSettled: () => void },
    ) => string | null;
    let boundedStateVerified = false;

    try {
      enqueueBatch.call(manager, requests, {
        onSettled: () => {
          settled += 1;
        },
      });
      await eventWithin(thirdStarted, "three transfers did not start from the large batch");

      const activeSnapshot = manager.getSnapshot() as ReturnType<TransferManager["getSnapshot"]> & {
        readonly batches?: readonly {
          readonly queued: number;
          readonly total: number;
          readonly transferring: number;
        }[];
      };
      expect(activeSnapshot.tasks.length).toBeLessThanOrEqual(23);
      expect(activeSnapshot.batches?.[0]).toMatchObject({
        queued: 9_997,
        total: 10_000,
        transferring: 3,
      });
      expect(maximumActive).toBe(3);

      boundedStateVerified = true;
      release?.();
      await eventWithin(notified, "large batch notification was not delivered", 10_000);
      const completedSnapshot = manager.getSnapshot() as ReturnType<
        TransferManager["getSnapshot"]
      > & {
        readonly batches?: readonly { readonly complete: number; readonly total: number }[];
      };
      expect(completedSnapshot.batches?.[0]).toMatchObject({
        complete: 10_000,
        total: 10_000,
      });
      expect(settled).toBe(1);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.items.length).toBeLessThanOrEqual(100);
      expect(Reflect.get(notifications[0] ?? {}, "summary")).toEqual({
        bytes: 10_000,
        failed: 0,
        succeeded: 10_000,
        total: 10_000,
      });
    } finally {
      if (boundedStateVerified) {
        release?.();
        manager.dispose();
      }
    }
  });

  test("runs at most three queued requests and posts one completed batch", async () => {
    const notifications: TransferBatchNotification[] = [];
    let resolveNotification: (() => void) | undefined;
    const notified = new Promise<void>((resolve) => {
      resolveNotification = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    let resolveThird: (() => void) | undefined;
    const thirdStarted = new Promise<void>((resolve) => {
      resolveThird = resolve;
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new TransferManager({
      concurrency: 3,
      notify: async (notification) => {
        notifications.push(notification);
        resolveNotification?.();
      },
      shouldPauseNetworkFailure: () => false,
    });
    const completed = waitForTasks(
      manager,
      (tasks) => tasks.length === 4 && tasks.every(({ status }) => status === "complete"),
    );

    manager.enqueueBatch(
      Array.from({ length: 4 }, (_, index) => ({
        execute: async ({ onProgress }) => {
          started += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          if (started === 3) {
            resolveThird?.();
          }
          await gate;
          onProgress({ loaded: 10, percent: 100, total: 10 });
          active -= 1;
        },
        id: `item-${index}`,
        kind: "file" as const,
        label: `item-${index}.txt`,
        operation: "upload" as const,
        path: `item-${index}.txt`,
        total: 10,
      })),
    );

    await eventWithin(thirdStarted, "three transfers did not start concurrently");
    expect(maximumActive).toBe(3);
    release?.();
    await eventWithin(completed, "queued transfers did not complete");
    await eventWithin(notified, "batch notification was not delivered");
    expect(notifications[0]?.items).toHaveLength(4);
    manager.dispose();
  });

  test("pauses hidden network failures and resumes from the exact signal", async () => {
    const notifications: TransferBatchNotification[] = [];
    let resolveNotification: (() => void) | undefined;
    const notified = new Promise<void>((resolve) => {
      resolveNotification = resolve;
    });
    let attempts = 0;
    let shouldPause = true;
    const manager = new TransferManager({
      notify: async (notification) => {
        notifications.push(notification);
        resolveNotification?.();
      },
      shouldPauseNetworkFailure: () => shouldPause,
    });
    const paused = waitForTasks(manager, (tasks) => tasks[0]?.status === "paused");
    manager.enqueueBatch([
      {
        execute: async ({ onProgress }) => {
          attempts += 1;
          if (attempts === 1) {
            throw new ApiError(0, "network request failed");
          }
          onProgress({ loaded: 4, percent: 100, total: 4 });
        },
        id: "resume.txt",
        kind: "file",
        label: "resume.txt",
        operation: "download",
        path: "resume.txt",
        total: 4,
      },
    ]);

    expect((await eventWithin(paused, "network failure did not pause"))[0]?.error).toBe(
      "network request failed",
    );
    const completed = waitForTasks(manager, (tasks) => tasks[0]?.status === "complete");
    shouldPause = false;
    manager.resume();
    await eventWithin(completed, "paused transfer did not resume");
    await eventWithin(notified, "resumed transfer notification did not settle");
    expect(attempts).toBe(2);
    expect(notifications[0]?.items[0]).toEqual({
      bytes: 4,
      outcome: "success",
      path: "resume.txt",
    });
    manager.dispose();
  });

  test("preserves a terminal failure reason in the batch notification", async () => {
    const notifications: TransferBatchNotification[] = [];
    let resolveNotification: (() => void) | undefined;
    const notified = new Promise<void>((resolve) => {
      resolveNotification = resolve;
    });
    const manager = new TransferManager({
      notify: async (notification) => {
        notifications.push(notification);
        resolveNotification?.();
      },
      shouldPauseNetworkFailure: () => false,
    });
    const failed = waitForTasks(manager, (tasks) => tasks[0]?.status === "failed");
    manager.enqueueBatch([
      {
        execute: async () => {
          throw new ApiError(400, "unsupported photo format");
        },
        id: "notes.exe",
        kind: "photo",
        label: "notes.exe",
        operation: "upload",
        path: "notes.exe",
        total: 1,
      },
    ]);

    await eventWithin(failed, "unsupported format did not fail");
    await eventWithin(notified, "failure notification did not settle");
    expect(notifications[0]?.items[0]).toEqual({
      outcome: "failure",
      path: "notes.exe",
      reason: "unsupported photo format",
    });
    manager.dispose();
  });
});
