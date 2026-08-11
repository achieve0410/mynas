import type { Database } from "bun:sqlite";

export const failAbandonedMaintenanceRuns = (database: Database, now: () => Date): number =>
  database
    .query(
      `UPDATE maintenance_runs
       SET status = 'failed', finished_at = ?, error = ?
       WHERE status = 'running'`,
    )
    .run(now().toISOString(), "maintenance interrupted before completion").changes;
