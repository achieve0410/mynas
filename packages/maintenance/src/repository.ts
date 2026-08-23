import type { Database } from "bun:sqlite";
import { z } from "zod";

import { getMaintenanceOwnerId } from "./identity";
import { incidentByMaintenanceKind, type ProtectionIncidentStore } from "./incidents";
import { type AbandonedMaintenanceRun, failAbandonedMaintenanceRuns } from "./lifecycle";
import {
  getMaintenancePolicy,
  type MaintenancePolicy,
  type MaintenancePolicyInput,
  saveMaintenancePolicy,
} from "./policy";

export {
  type MaintenancePolicy,
  type MaintenancePolicyInput,
  maintenancePolicyInputSchema,
} from "./policy";

export type MaintenanceKind = "catalog_backup" | "volume_scrub";
export type MaintenanceTrigger = "manual" | "scheduled";
export type MaintenanceStatus = "completed" | "failed" | "running";
export type MaintenanceSummary = Readonly<Record<string, unknown>>;

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

  public completeRun(
    id: string,
    completion: RunCompletion,
    incidents: ProtectionIncidentStore,
  ): MaintenanceRun {
    this.database.exec("BEGIN IMMEDIATE");
    try {
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
      const run = this.getRun(id);
      const incident = incidentByMaintenanceKind[run.kind];
      if (completion.status === "failed") {
        incidents.recordInCurrentTransaction(incident.kind, incident.resourceKey);
      } else {
        incidents.resolveInCurrentTransaction(incident.kind, incident.resourceKey);
      }
      this.pruneRuns(100);
      this.database.exec("COMMIT");
      return run;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public failAbandonedRuns(incidents: ProtectionIncidentStore): readonly AbandonedMaintenanceRun[] {
    return failAbandonedMaintenanceRuns(this.database, incidents, this.now);
  }

  public getPolicy(): MaintenancePolicy | null {
    return getMaintenancePolicy(this.database);
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
    return saveMaintenancePolicy(this.database, {
      ...(destinationId === undefined ? {} : { destinationId }),
      input,
      now: this.now,
    });
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
