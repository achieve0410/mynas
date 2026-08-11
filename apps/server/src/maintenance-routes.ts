import {
  type MaintenancePolicy,
  maintenancePolicyInputSchema,
} from "../../../packages/maintenance/src/repository";

import type { AppInstance, AppServices } from "./types";

const publicPolicy = (policy: MaintenancePolicy | null) =>
  policy === null
    ? null
    : {
        backupDirectory: policy.backupDirectory,
        backupIntervalHours: policy.backupIntervalHours,
        enabled: policy.enabled,
        retentionCount: policy.retentionCount,
        scrubIntervalHours: policy.scrubIntervalHours,
        updatedAt: policy.updatedAt,
      };

export const registerMaintenanceRoutes = (app: AppInstance, services: AppServices): void => {
  app.get("/api/v1/maintenance", (context) =>
    context.json({
      nextDue: services.scheduler.nextDue(),
      policy: publicPolicy(services.maintenance.getPolicy()),
      runs: services.maintenance.listRuns(100),
    }),
  );

  app.put("/api/v1/maintenance/policy", async (context) => {
    const policy = await services.maintenance.savePolicy(
      maintenancePolicyInputSchema.parse(await context.req.json()),
    );
    services.scheduler.refresh();
    return context.json(publicPolicy(policy));
  });

  app.post("/api/v1/maintenance/run", async (context) => {
    const batch = await services.maintenance.runManual();
    services.scheduler.refresh();
    return context.json(batch, 201);
  });
};
