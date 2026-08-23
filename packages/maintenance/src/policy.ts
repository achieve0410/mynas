import type { Database } from "bun:sqlite";
import { z } from "zod";

export const maintenancePolicyInputSchema = z.object({
  backupDirectory: z.string().min(1),
  backupIntervalHours: z.number().int().min(1).max(8_760),
  enabled: z.boolean(),
  retentionCount: z.number().int().min(1).max(100),
  scrubIntervalHours: z.number().int().min(1).max(8_760),
});

export type MaintenancePolicyInput = z.infer<typeof maintenancePolicyInputSchema>;
export type MaintenancePolicy = MaintenancePolicyInput & {
  readonly destinationId: string;
  readonly updatedAt: string;
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

const toPolicy = (row: PolicyRow): MaintenancePolicy => ({
  backupDirectory: row.backup_directory,
  backupIntervalHours: row.backup_interval_hours,
  destinationId: row.destination_id,
  enabled: row.enabled === 1,
  retentionCount: row.retention_count,
  scrubIntervalHours: row.scrub_interval_hours,
  updatedAt: row.updated_at,
});

export const getMaintenancePolicy = (database: Database): MaintenancePolicy | null => {
  const row = database
    .query<PolicyRow, []>(
      `SELECT enabled, backup_directory, backup_interval_hours, scrub_interval_hours,
              retention_count, destination_id, updated_at
       FROM maintenance_policy
       WHERE id = 1`,
    )
    .get();
  return row === null ? null : toPolicy(row);
};

export const saveMaintenancePolicy = (
  database: Database,
  options: {
    readonly destinationId?: string;
    readonly input: MaintenancePolicyInput;
    readonly now: () => Date;
  },
): MaintenancePolicy => {
  const policy = maintenancePolicyInputSchema.parse(options.input);
  const storedDestinationId =
    options.destinationId ??
    getMaintenancePolicy(database)?.destinationId ??
    crypto.randomUUID().replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(storedDestinationId)) {
    throw new Error("maintenance destination identity is invalid");
  }
  const updatedAt = options.now().toISOString();
  database
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
};
