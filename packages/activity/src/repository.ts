import type { Database } from "bun:sqlite";

export type ActivityOutcome = "failure" | "success";

export type ActivityResource = {
  readonly kind: string;
  readonly path: string;
};

export type ActivityError = {
  readonly code: string;
  readonly message: string;
};

export type ActivityEvent = {
  readonly action: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly occurredAt: string;
  readonly outcome: ActivityOutcome;
  readonly resource: ActivityResource | null;
};

export type RecordActivityInput =
  | {
      readonly action: string;
      readonly outcome: "success";
      readonly resource: ActivityResource | null;
    }
  | {
      readonly action: string;
      readonly error: ActivityError;
      readonly outcome: "failure";
      readonly resource: ActivityResource | null;
    };

type ActivityRow = {
  readonly action: string;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly id: string;
  readonly occurred_at: string;
  readonly outcome: ActivityOutcome;
  readonly resource_kind: string | null;
  readonly resource_path: string | null;
};

const toActivityEvent = (row: ActivityRow): ActivityEvent => ({
  action: row.action,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  id: row.id,
  occurredAt: row.occurred_at,
  outcome: row.outcome,
  resource:
    row.resource_kind === null || row.resource_path === null
      ? null
      : { kind: row.resource_kind, path: row.resource_path },
});

export class ActivityRepository {
  public constructor(
    private readonly database: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public list(limit = 1_000): readonly ActivityEvent[] {
    return this.database
      .query<ActivityRow, [number]>(
        `SELECT id, occurred_at, action, outcome, resource_kind, resource_path,
                error_code, error_message
         FROM activity_events
         ORDER BY occurred_at DESC, sequence DESC
         LIMIT ?`,
      )
      .all(limit)
      .map(toActivityEvent);
  }

  public record(input: RecordActivityInput): ActivityEvent {
    const event: ActivityEvent = {
      action: input.action,
      errorCode: input.outcome === "failure" ? input.error.code : null,
      errorMessage: input.outcome === "failure" ? input.error.message : null,
      id: crypto.randomUUID(),
      occurredAt: this.now().toISOString(),
      outcome: input.outcome,
      resource: input.resource,
    };
    this.database
      .query(
        `INSERT INTO activity_events (
          id, occurred_at, action, outcome, resource_kind, resource_path,
          error_code, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.occurredAt,
        event.action,
        event.outcome,
        event.resource?.kind ?? null,
        event.resource?.path ?? null,
        event.errorCode,
        event.errorMessage,
      );
    this.database.exec(`
      DELETE FROM activity_events
      WHERE sequence <= (
        SELECT sequence
        FROM activity_events
        ORDER BY sequence DESC
        LIMIT 1 OFFSET 1000
      )
    `);
    return event;
  }
}
