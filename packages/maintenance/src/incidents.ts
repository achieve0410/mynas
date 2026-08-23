import type { Database } from "bun:sqlite";

import type { MaintenanceKind } from "./repository";

export type ProtectionIncidentKind = "catalog_backup_failed" | "volume_scrub_failed";
export type ProtectionIncidentStatus = "active" | "resolved";
export type ProtectionIncidentFilter = ProtectionIncidentStatus | "all";

export type ProtectionIncident = {
  readonly firstSeenAt: string;
  readonly id: string;
  readonly kind: ProtectionIncidentKind;
  readonly lastSeenAt: string;
  readonly occurrenceCount: number;
  readonly resolvedAt: string | null;
  readonly resourceKey: string;
  readonly status: ProtectionIncidentStatus;
};

export const incidentByMaintenanceKind = {
  catalog_backup: {
    kind: "catalog_backup_failed",
    resourceKey: "catalog_backup",
  },
  volume_scrub: {
    kind: "volume_scrub_failed",
    resourceKey: "volume_scrub",
  },
} as const satisfies Record<
  MaintenanceKind,
  { readonly kind: ProtectionIncidentKind; readonly resourceKey: string }
>;

type IncidentRow = {
  readonly first_seen_at: string;
  readonly id: string;
  readonly kind: ProtectionIncidentKind;
  readonly last_seen_at: string;
  readonly occurrence_count: number;
  readonly resolved_at: string | null;
  readonly resource_key: string;
};

const selectIncident = `
  SELECT id, kind, resource_key, first_seen_at, last_seen_at, occurrence_count, resolved_at
  FROM protection_incidents
`;

const toIncident = (row: IncidentRow): ProtectionIncident => ({
  firstSeenAt: row.first_seen_at,
  id: row.id,
  kind: row.kind,
  lastSeenAt: row.last_seen_at,
  occurrenceCount: row.occurrence_count,
  resolvedAt: row.resolved_at,
  resourceKey: row.resource_key,
  status: row.resolved_at === null ? "active" : "resolved",
});

export class ProtectionIncidentStore {
  public constructor(
    private readonly database: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public list(status: ProtectionIncidentFilter, limit: number): readonly ProtectionIncident[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("invalid incident history limit");
    }
    const condition =
      status === "active"
        ? "WHERE resolved_at IS NULL"
        : status === "resolved"
          ? "WHERE resolved_at IS NOT NULL"
          : "";
    return this.database
      .query<IncidentRow, [number]>(
        `${selectIncident}
         ${condition}
         ORDER BY last_seen_at DESC, sequence DESC
         LIMIT ?`,
      )
      .all(limit)
      .map(toIncident);
  }

  public record(kind: ProtectionIncidentKind, resourceKey: string): ProtectionIncident {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const incident = this.recordInCurrentTransaction(kind, resourceKey);
      this.database.exec("COMMIT");
      return incident;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public recordInCurrentTransaction(
    kind: ProtectionIncidentKind,
    resourceKey: string,
  ): ProtectionIncident {
    const observedAt = this.now().toISOString();
    const active = this.findActive(kind, resourceKey);
    const id = active?.id ?? crypto.randomUUID();
    if (active === null) {
      this.database
        .query(
          `INSERT INTO protection_incidents
           (id, kind, resource_key, first_seen_at, last_seen_at, occurrence_count)
           VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .run(id, kind, resourceKey, observedAt, observedAt);
    } else {
      const lastSeenAt = active.last_seen_at > observedAt ? active.last_seen_at : observedAt;
      this.database
        .query(
          `UPDATE protection_incidents
           SET last_seen_at = ?, occurrence_count = occurrence_count + 1
           WHERE id = ?`,
        )
        .run(lastSeenAt, id);
    }
    return this.get(id);
  }

  public resolve(kind: ProtectionIncidentKind, resourceKey: string): ProtectionIncident | null {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const incident = this.resolveInCurrentTransaction(kind, resourceKey);
      this.database.exec("COMMIT");
      return incident;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public resolveInCurrentTransaction(
    kind: ProtectionIncidentKind,
    resourceKey: string,
  ): ProtectionIncident | null {
    const active = this.findActive(kind, resourceKey);
    if (active === null) {
      return null;
    }
    const observedAt = this.now().toISOString();
    const resolvedAt = active.last_seen_at > observedAt ? active.last_seen_at : observedAt;
    this.database
      .query(
        `UPDATE protection_incidents
         SET last_seen_at = ?, resolved_at = ?
         WHERE id = ? AND resolved_at IS NULL`,
      )
      .run(resolvedAt, resolvedAt, active.id);
    return this.get(active.id);
  }

  private findActive(kind: ProtectionIncidentKind, resourceKey: string): IncidentRow | null {
    return this.database
      .query<IncidentRow, [ProtectionIncidentKind, string]>(
        `${selectIncident}
         WHERE kind = ? AND resource_key = ? AND resolved_at IS NULL`,
      )
      .get(kind, resourceKey);
  }

  private get(id: string): ProtectionIncident {
    const row = this.database
      .query<IncidentRow, [string]>(`${selectIncident} WHERE id = ?`)
      .get(id);
    if (row === null) {
      throw new Error("protection incident not found");
    }
    return toIncident(row);
  }
}
