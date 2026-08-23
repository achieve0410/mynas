import type { Database } from "bun:sqlite";

import { incidentByMaintenanceKind, type ProtectionIncidentStore } from "./incidents";
import type { MaintenanceKind } from "./repository";

export type AbandonedMaintenanceRun = {
  readonly id: string;
  readonly kind: MaintenanceKind;
};

export const failAbandonedMaintenanceRuns = (
  database: Database,
  incidents: ProtectionIncidentStore,
  now: () => Date,
): readonly AbandonedMaintenanceRun[] => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const runs = database
      .query<AbandonedMaintenanceRun, []>(
        `SELECT id, kind
         FROM maintenance_runs
         WHERE status = 'running'
         ORDER BY sequence`,
      )
      .all();
    if (runs.length > 0) {
      database
        .query(
          `UPDATE maintenance_runs
           SET status = 'failed', finished_at = ?, error = ?
           WHERE status = 'running'`,
        )
        .run(now().toISOString(), "maintenance interrupted before completion");
      for (const run of runs) {
        const incident = incidentByMaintenanceKind[run.kind];
        incidents.recordInCurrentTransaction(incident.kind, incident.resourceKey);
      }
    }
    database.exec("COMMIT");
    return runs;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};
