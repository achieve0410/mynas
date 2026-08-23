import { z } from "zod";

import type {
  ProtectionIncident,
  ProtectionIncidentKind,
} from "../../../packages/maintenance/src/incidents";

import type { AppInstance, AppServices } from "./types";

const incidentStatusSchema = z.enum(["active", "resolved", "all"]).default("active");

const definitionByKind = {
  catalog_backup_failed: {
    impact: "The metadata catalog may not have a current independent snapshot.",
    remediation: "Check the configured backup destination, then run maintenance again.",
    severity: "warning",
    title: "Catalog backup failed",
  },
  volume_scrub_failed: {
    impact: "One or more mirrored volumes did not complete integrity verification.",
    remediation: "Check member availability in Storage, then run scrub or repair.",
    severity: "critical",
    title: "Volume scrub failed",
  },
} as const satisfies Record<
  ProtectionIncidentKind,
  {
    readonly impact: string;
    readonly remediation: string;
    readonly severity: "critical" | "warning";
    readonly title: string;
  }
>;

const publicIncident = (incident: ProtectionIncident) => ({
  firstSeenAt: incident.firstSeenAt,
  id: incident.id,
  kind: incident.kind,
  lastSeenAt: incident.lastSeenAt,
  occurrenceCount: incident.occurrenceCount,
  resolvedAt: incident.resolvedAt,
  status: incident.status,
  ...definitionByKind[incident.kind],
});

export const registerProtectionRoutes = (app: AppInstance, services: AppServices): void => {
  app.get("/api/v1/incidents", (context) => {
    const status = incidentStatusSchema.parse(context.req.query("status"));
    return context.json(services.incidents.list(status, 100).map(publicIncident));
  });
};
