import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";

const loginSchema = z.object({ token: z.string().min(32) });
export const maintenancePolicySchema = z.object({
  backupDirectory: z.string(),
  backupIntervalHours: z.number().int(),
  enabled: z.boolean(),
  retentionCount: z.number().int(),
  scrubIntervalHours: z.number().int(),
  updatedAt: z.string(),
});
export const maintenanceRunSchema = z.object({
  error: z.string().nullable(),
  finishedAt: z.string().nullable(),
  id: z.string().uuid(),
  kind: z.enum(["catalog_backup", "volume_scrub"]),
  outputPath: z.string().nullable(),
  startedAt: z.string(),
  status: z.enum(["completed", "failed", "running"]),
  summary: z.record(z.string(), z.unknown()).nullable(),
  trigger: z.enum(["manual", "scheduled"]),
});
export const maintenanceBatchSchema = z.object({
  runs: z.array(maintenanceRunSchema).length(2),
});
export const maintenanceSnapshotSchema = z.object({
  nextDue: z.object({
    backupAt: z.string().nullable(),
    scrubAt: z.string().nullable(),
  }),
  policy: maintenancePolicySchema.nullable(),
  runs: z.array(z.unknown()),
});

export type MaintenanceApiFixture = {
  readonly app: ReturnType<typeof createApp>;
  readonly authorized: () => Record<string, string>;
  readonly backupDirectory: string;
  readonly cleanup: () => Promise<void>;
  readonly database: Database;
  readonly dataDir: string;
  readonly root: string;
  readonly savePolicy: (retentionCount?: number) => Promise<void>;
};

export const createMaintenanceApiFixture = async (): Promise<MaintenanceApiFixture> => {
  const root = await mkdtemp(join(tmpdir(), "mynas-maintenance-policy-"));
  const dataDir = join(root, "data");
  const backupDirectory = join(root, "backups");
  await Promise.all([mkdir(dataDir), mkdir(backupDirectory)]);
  const database = new Database(":memory:");
  migrate(database);
  const app = createApp({ dataDir, database, environment: {} });
  await app.request("/api/v1/setup", {
    body: JSON.stringify({ password: "synthetic owner passphrase", username: "owner" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const login = await app.request("/api/v1/login", {
    body: JSON.stringify({ password: "synthetic owner passphrase", username: "owner" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const token = loginSchema.parse(await login.json()).token;
  const authorized = (): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });
  const savePolicy = async (retentionCount = 2): Promise<void> => {
    const response = await app.request("/api/v1/maintenance/policy", {
      body: JSON.stringify({
        backupDirectory,
        backupIntervalHours: 24,
        enabled: true,
        retentionCount,
        scrubIntervalHours: 168,
      }),
      headers: authorized(),
      method: "PUT",
    });
    if (response.status !== 200) {
      throw new Error(`policy fixture failed with status ${response.status}`);
    }
  };
  return {
    app,
    authorized,
    backupDirectory,
    cleanup: async () => {
      database.close();
      await rm(root, { force: true, recursive: true });
    },
    database,
    dataDir,
    root,
    savePolicy,
  };
};
