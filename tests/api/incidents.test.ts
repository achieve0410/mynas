import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { ProtectionIncidentStore } from "../../packages/maintenance/src/incidents";
import { createMaintenanceApiFixture, type MaintenanceApiFixture } from "./maintenance-fixture";

const incidentSchema = z.object({
  firstSeenAt: z.iso.datetime(),
  id: z.string().uuid(),
  impact: z.string().min(1),
  kind: z.enum(["catalog_backup_failed", "volume_scrub_failed"]),
  lastSeenAt: z.iso.datetime(),
  occurrenceCount: z.number().int().positive(),
  remediation: z.string().min(1),
  resolvedAt: z.iso.datetime().nullable(),
  severity: z.enum(["critical", "warning"]),
  status: z.enum(["active", "resolved"]),
  title: z.string().min(1),
});
const incidentListSchema = z.array(incidentSchema);

describe("protection incident API", () => {
  let fixture: MaintenanceApiFixture;

  beforeEach(async () => {
    fixture = await createMaintenanceApiFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  test("lists authenticated active incidents newest first", async () => {
    const incidents = new ProtectionIncidentStore(
      fixture.database,
      () => new Date("2026-08-23T01:00:00.000Z"),
    );
    incidents.record("catalog_backup_failed", "catalog_backup");
    incidents.record("volume_scrub_failed", "volume_scrub");

    const response = await fixture.app.request("/api/v1/incidents?status=active", {
      headers: fixture.authorized(),
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(
      Array.isArray(body) &&
        body.every(
          (incident) =>
            typeof incident === "object" &&
            incident !== null &&
            !Object.hasOwn(incident, "resourceKey"),
        ),
    ).toBe(true);
    expect(
      incidentListSchema.parse(body).map(({ kind, occurrenceCount, severity, status }) => ({
        kind,
        occurrenceCount,
        severity,
        status,
      })),
    ).toEqual([
      {
        kind: "volume_scrub_failed",
        occurrenceCount: 1,
        severity: "critical",
        status: "active",
      },
      {
        kind: "catalog_backup_failed",
        occurrenceCount: 1,
        severity: "warning",
        status: "active",
      },
    ]);
  });

  test("rejects invalid status filters", async () => {
    const response = await fixture.app.request("/api/v1/incidents?status=unknown", {
      headers: fixture.authorized(),
    });

    expect(response.status).toBe(400);
  });

  test("requires owner authentication", async () => {
    const response = await fixture.app.request("/api/v1/incidents");

    expect(response.status).toBe(401);
  });
});
