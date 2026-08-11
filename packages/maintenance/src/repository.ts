import type { Database } from "bun:sqlite";
import { z } from "zod";

import { getMaintenanceOwnerId } from "./identity";
import { failAbandonedMaintenanceRuns } from "./lifecycle";

export const maintenancePolicyInputSchema = z.object({
  backupDirectory: z.string().min(1),
  backupIntervalHours: z.number().int().min(1).max(8_760),
  enabled: z.boolean(),
  retentionCount: z.number().int().min(1).max(100),
  scrubIntervalHours: z.number().int().min(1).max(8_760),
});

export type MaintenancePolicyInput = z.infer<typeof maintenancePolicyInputSchema>;
export type MaintenanceKind = "catalog_backup" | "volume_scrub";
export type MaintenanceTrigger = "manual" | "scheduled";
export type MaintenanceStatus = "completed" | "failed" | "running";
export type MaintenanceSummary = Readonly<Record<string, unknown>>;

export type MaintenancePolicy = MaintenancePolicyInput & {
  readonly destinationId: string;
  readonly updatedAt: string;
};

export type MaintenanceRun = {
  readonly error: string | null;
  readonly finishedAt: string | null;
  readonly id: string;
  readonly kind: MaintenanceKind;
  readonly outputPath: string | null;
  readonly startedAt: string;
  readonly status: MaintenanceStatus;
  readonly summary: MaintenanceSummary | null;
  readonly trigger: MaintenanceTrigger;
};

type PolicyRow = {
  readonly backup_directory: string;
  readonly backup_interval_hours: number;
  readonly destination_id: string;
  readonly enabled: number;
  readonly retention_count: number;
  readonly scrub_interval_hours: number;
  readonly updated_at: string;
};

type RunRow = {
  readonly error: string | null;
  readonly finished_at: string | null;
  readonly id: string;
  readonly kind: MaintenanceKind;
  readonly output_path: string | null;
  readonly started_at: string;
  readonly status: MaintenanceStatus;
  readonly summary_json: string | null;
  readonly trigger: MaintenanceTrigger;
};

type RunCompletion = {
  readonly error: string | null;
  readonly outputPath: string | null;
  readonly status: Exclude<MaintenanceStatus, "running">;
  readonly summary: MaintenanceSummary | null;
};

const summarySchema = z.record(z.string(), z.unknown());

const toPolicy = (row: PolicyRow): MaintenancePolicy => ({
  backupDirectory: row.backup_directory,
  backupIntervalHours: row.backup_interval_hours,
  destinationId: row.destination_id,
  enabled: row.enabled === 1,
  retentionCount: row.retention_count,
  scrubIntervalHours: row.scrub_interval_hours,
  updatedAt: row.updated_at,
});

const toRun = (row: RunRow): MaintenanceRun => ({
  error: row.error,
  finishedAt: row.finished_at,
  id: row.id,
  kind: row.kind,
  outputPath: row.output_path,
  startedAt: row.started_at,
  status: row.status,
  summary: row.summary_json === null ? null : summarySchema.parse(JSON.parse(row.summary_json)),
  trigger: row.trigger,
});

export class MaintenanceRepository {
  public constructor(
    private readonly database: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public completeRun(id: string, completion: RunCompletion): MaintenanceRun {
    const result = this.database
      .query(
        `UPDATE maintenance_runs
         SET status = ?, finished_at = ?, output_path = ?, summary_json = ?, error = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        completion.status,
        this.now().toISOString(),
        completion.outputPath,
        completion.summary === null ? null : JSON.stringify(completion.summary),
        completion.error,
        id,
      );
    if (result.changes !== 1) {
      throw new Error("running maintenance record not found");
    }
    this.pruneRuns(100);
    return this.getRun(id);
  }

  public failAbandonedRuns(): number {
    return failAbandonedMaintenanceRuns(this.database, this.now);
  }

  public getPolicy(): MaintenancePolicy | null {
    const row = this.database
      .query<PolicyRow, []>(
        `SELECT enabled, backup_directory, backup_interval_hours, scrub_interval_hours,
                retention_count, destination_id, updated_at
         FROM maintenance_policy
         WHERE id = 1`,
      )
      .get();
    return row === null ? null : toPolicy(row);
  }

  public getOwnerId(): string {
    return getMaintenanceOwnerId(this.database);
  }

  public getRun(id: string): MaintenanceRun {
    const row = this.database
      .query<RunRow, [string]>(
        `SELECT id, kind, trigger, status, started_at, finished_at, output_path,
                summary_json, error
         FROM maintenance_runs
         WHERE id = ?`,
      )
      .get(id);
    if (row === null) {
      throw new Error("maintenance record not found");
    }
    return toRun(row);
  }

  public lastFinishedAt(kind: MaintenanceKind): string | null {
    const row = this.database
      .query<{ readonly finished_at: string | null }, [MaintenanceKind]>(
        `SELECT MAX(finished_at) AS finished_at
         FROM maintenance_runs
         WHERE kind = ? AND status IN ('completed', 'failed')`,
      )
      .get(kind);
    return row?.finished_at ?? null;
  }

  public listRuns(limit: number): readonly MaintenanceRun[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("invalid maintenance history limit");
    }
    return this.database
      .query<RunRow, [number]>(
        `SELECT id, kind, trigger, status, started_at, finished_at, output_path,
                summary_json, error
         FROM maintenance_runs
         ORDER BY sequence DESC
         LIMIT ?`,
      )
      .all(limit)
      .map(toRun);
  }

  public savePolicy(input: MaintenancePolicyInput, destinationId?: string): MaintenancePolicy {
    const policy = maintenancePolicyInputSchema.parse(input);
    const storedDestinationId =
      destinationId ?? this.getPolicy()?.destinationId ?? crypto.randomUUID().replaceAll("-", "");
    if (!/^[0-9a-f]{32}$/.test(storedDestinationId)) {
      throw new Error("maintenance destination identity is invalid");
    }
    const updatedAt = this.now().toISOString();
    this.database
      .query(
        `INSERT INTO maintenance_policy
         (id, enabled, backup_directory, backup_interval_hours, scrub_interval_hours,
          retention_count, destination_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           enabled = excluded.enabled,
           backup_directory = excluded.backup_directory,
           backup_interval_hours = excluded.backup_interval_hours,
           scrub_interval_hours = excluded.scrub_interval_hours,
           retention_count = excluded.retention_count,
           destination_id = excluded.destination_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        policy.enabled ? 1 : 0,
        policy.backupDirectory,
        policy.backupIntervalHours,
        policy.scrubIntervalHours,
        policy.retentionCount,
        storedDestinationId,
        updatedAt,
      );
    return { ...policy, destinationId: storedDestinationId, updatedAt };
  }

  public startRun(kind: MaintenanceKind, trigger: MaintenanceTrigger): MaintenanceRun {
    const run: MaintenanceRun = {
      error: null,
      finishedAt: null,
      id: crypto.randomUUID(),
      kind,
      outputPath: null,
      startedAt: this.now().toISOString(),
      status: "running",
      summary: null,
      trigger,
    };
    this.database
      .query(
        `INSERT INTO maintenance_runs
         (id, kind, trigger, status, started_at)
         VALUES (?, ?, ?, 'running', ?)`,
      )
      .run(run.id, run.kind, run.trigger, run.startedAt);
    return run;
  }

  private pruneRuns(keep: number): void {
    this.database
      .query(
        `DELETE FROM maintenance_runs
         WHERE sequence NOT IN (
           SELECT sequence FROM maintenance_runs ORDER BY sequence DESC LIMIT ?
         )`,
      )
      .run(keep);
  }
}
