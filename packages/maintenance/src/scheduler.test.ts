import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "../../database/src/migrations";
import { MaintenanceCoordinator } from "./maintenance";
import { MaintenanceRepository } from "./repository";
import {
  MaintenanceScheduler,
  type MaintenanceTimer,
  type MaintenanceTimerHandle,
} from "./scheduler";

class FakeMaintenanceTimer implements MaintenanceTimer {
  private currentMilliseconds = Date.parse("2026-08-11T10:00:00.000Z");
  private nextHandle = 1;
  private readonly timers = new Map<
    number,
    { readonly callback: () => Promise<void> | void; readonly dueAt: number }
  >();

  public clearTimer(handle: MaintenanceTimerHandle): void {
    this.timers.delete(handle as number);
  }

  public now = (): Date => new Date(this.currentMilliseconds);

  public pendingCount(): number {
    return this.timers.size;
  }

  public nextDelay(): number | null {
    const nextDue = Math.min(...[...this.timers.values()].map(({ dueAt }) => dueAt));
    return Number.isFinite(nextDue) ? nextDue - this.currentMilliseconds : null;
  }

  public setTimer(
    callback: () => Promise<void> | void,
    delayMilliseconds: number,
  ): MaintenanceTimerHandle {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, {
      callback,
      dueAt: this.currentMilliseconds + delayMilliseconds,
    });
    return handle;
  }

  public async advanceBy(milliseconds: number): Promise<void> {
    this.currentMilliseconds += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.dueAt <= this.currentMilliseconds)
      .sort((left, right) => left[1].dueAt - right[1].dueAt);
    for (const [handle, timer] of due) {
      this.timers.delete(handle);
      await timer.callback();
    }
  }
}

describe("MaintenanceScheduler", () => {
  let backupDirectory: string;
  let coordinator: MaintenanceCoordinator;
  let dataDir: string;
  let database: Database;
  let repository: MaintenanceRepository;
  let root: string;
  let timer: FakeMaintenanceTimer;
  let backupRuns: number;
  let scrubRuns: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-maintenance-scheduler-"));
    dataDir = join(root, "data");
    backupDirectory = join(root, "backups");
    await Promise.all([mkdir(dataDir), mkdir(backupDirectory)]);
    database = new Database(":memory:");
    migrate(database);
    timer = new FakeMaintenanceTimer();
    repository = new MaintenanceRepository(database, timer.now);
    backupRuns = 0;
    scrubRuns = 0;
    coordinator = new MaintenanceCoordinator({
      backup: async (outputPath) => {
        backupRuns += 1;
        await writeFile(outputPath, "scheduled backup");
      },
      dataDir,
      now: timer.now,
      repository,
      volumes: {
        listIds: () => ["photos"],
        scrub: async () => {
          scrubRuns += 1;
          return { healthy: 1, issues: [], unrecoverable: 0 };
        },
      },
    });
    await coordinator.savePolicy({
      backupDirectory,
      backupIntervalHours: 24,
      enabled: true,
      retentionCount: 2,
      scrubIntervalHours: 168,
    });
    await timer.advanceBy(23 * 60 * 60 * 1_000 + 59 * 60 * 1_000);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { force: true, recursive: true });
  });

  test("fires exactly one due operation and does not double-run after restart", async () => {
    const scheduler = new MaintenanceScheduler({ coordinator, repository, timer });
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = coordinator.subscribe((batch) => {
        if (batch.trigger === "scheduled") {
          unsubscribe();
          resolve();
        }
      });
    });
    scheduler.start();
    expect(timer.pendingCount()).toBe(1);

    await timer.advanceBy(60_000);
    await completed;
    expect({ backupRuns, scrubRuns }).toEqual({ backupRuns: 1, scrubRuns: 0 });

    scheduler.stop();
    const restarted = new MaintenanceScheduler({ coordinator, repository, timer });
    restarted.start();
    await timer.advanceBy(23 * 60 * 60 * 1_000);
    expect({ backupRuns, scrubRuns }).toEqual({ backupRuns: 1, scrubRuns: 0 });
    restarted.stop();
    expect(timer.pendingCount()).toBe(0);
  });

  test("disabled policy schedules nothing and stop clears the exact timer", () => {
    const policy = repository.getPolicy();
    if (policy === null) {
      throw new Error("policy fixture must exist");
    }
    repository.savePolicy({ ...policy, enabled: false });
    const scheduler = new MaintenanceScheduler({ coordinator, repository, timer });
    scheduler.start();
    expect(timer.pendingCount()).toBe(0);

    repository.savePolicy({ ...policy, enabled: true });
    scheduler.refresh();
    expect(timer.pendingCount()).toBe(1);
    scheduler.stop();
    expect(timer.pendingCount()).toBe(0);
  });

  test("chunks valid intervals that exceed the platform timer limit", () => {
    const policy = repository.getPolicy();
    if (policy === null) {
      throw new Error("policy fixture must exist");
    }
    repository.savePolicy({
      ...policy,
      backupIntervalHours: 8_760,
      scrubIntervalHours: 8_760,
    });
    const scheduler = new MaintenanceScheduler({ coordinator, repository, timer });
    scheduler.start();
    expect(timer.nextDelay()).toBe(2_147_483_647);
    scheduler.stop();
  });

  test("waits for an overlapping manual run without retrying overdue work", async () => {
    let releaseBackup: (() => void) | undefined;
    const backupStarted = new Promise<void>((resolveStarted) => {
      coordinator = new MaintenanceCoordinator({
        backup: async () => {
          resolveStarted();
          await new Promise<void>((resolve) => {
            releaseBackup = resolve;
          });
        },
        dataDir,
        now: timer.now,
        repository,
        volumes: {
          listIds: () => [],
          scrub: async () => ({ healthy: 0, issues: [], unrecoverable: 0 }),
        },
      });
    });
    const errors: unknown[] = [];
    const scheduler = new MaintenanceScheduler({
      coordinator,
      onError: (error) => errors.push(error),
      repository,
      timer,
    });

    const manual = coordinator.runManual();
    await backupStarted;
    scheduler.start();
    const due = timer.advanceBy(60_000);
    releaseBackup?.();
    await Promise.all([manual, due]);

    expect(errors).toEqual([]);
    expect(repository.listRuns(10).map(({ trigger }) => trigger)).toEqual(["manual", "manual"]);
    expect(timer.pendingCount()).toBe(1);
  });
});
