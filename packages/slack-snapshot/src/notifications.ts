import { z } from "zod";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SnapshotNotification =
  | {
      readonly bundleId: string;
      readonly deletedCount: number;
      readonly kind: "success";
      readonly retainedCount: number;
      readonly snapshotId: string;
      readonly totalBytes: number;
    }
  | {
      readonly kind: "backup_failure";
      readonly reason: string;
    }
  | {
      readonly bundleId: string;
      readonly kind: "retention_failure";
      readonly reason: string;
    };

export type SnapshotNotifier = {
  send(notification: SnapshotNotification): Promise<void>;
};

type SlackWebApiNotifierOptions = {
  readonly channel: string;
  readonly fetch: FetchLike;
  readonly threadTs?: string;
  readonly token: string;
};

const slackChannelSchema = z.string().regex(/^[CDG][A-Z0-9]{8,}$/);
const slackThreadTimestampSchema = z.string().regex(/^\d+\.\d{6}$/);
const slackTokenSchema = z.string().startsWith("xoxb-").min(10);
const slackResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).passthrough(),
  z.object({ error: z.string().min(1), ok: z.literal(false) }).passthrough(),
]);

type SlackNotificationErrorCode = "api" | "http" | "response";

export class SlackNotificationError extends Error {
  public override readonly name = "SlackNotificationError";

  public constructor(
    public readonly code: SlackNotificationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const redactReason = (reason: string): string =>
  reason
    .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]+\b/gu, "[REDACTED]")
    .slice(0, 500);

const notificationText = (notification: SnapshotNotification): string => {
  switch (notification.kind) {
    case "success":
      return [
        "MyNAS Slack backup succeeded",
        `Bundle: ${notification.bundleId}`,
        `Snapshot: ${notification.snapshotId}`,
        `Encrypted bytes: ${notification.totalBytes}`,
        `Retained: ${notification.retainedCount}`,
        `Deleted by retention: ${notification.deletedCount}`,
      ].join("\n");
    case "backup_failure":
      return ["MyNAS Slack backup failed", `Reason: ${redactReason(notification.reason)}`].join(
        "\n",
      );
    case "retention_failure":
      return [
        "MyNAS Slack backup completed but retention failed",
        `Bundle: ${notification.bundleId}`,
        `Reason: ${redactReason(notification.reason)}`,
      ].join("\n");
  }
};

export class SlackWebApiNotifier implements SnapshotNotifier {
  private readonly channel: string;
  private readonly fetch: FetchLike;
  private readonly threadTs: string | undefined;
  private readonly token: string;

  public constructor(options: SlackWebApiNotifierOptions) {
    this.channel = slackChannelSchema.parse(options.channel);
    this.fetch = options.fetch;
    this.threadTs =
      options.threadTs === undefined
        ? undefined
        : slackThreadTimestampSchema.parse(options.threadTs);
    this.token = slackTokenSchema.parse(options.token);
  }

  public async send(notification: SnapshotNotification): Promise<void> {
    const response = await this.fetch("https://slack.com/api/chat.postMessage", {
      body: JSON.stringify({
        channel: this.channel,
        text: notificationText(notification),
        ...(this.threadTs === undefined ? {} : { thread_ts: this.threadTs }),
      }),
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new SlackNotificationError(
        "http",
        `Slack notification HTTP request failed with ${response.status}`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new SlackNotificationError("response", "Slack returned invalid JSON", {
          cause: error,
        });
      }
      throw error;
    }
    const parsed = slackResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new SlackNotificationError("response", "Slack returned an invalid response");
    }
    if (!parsed.data.ok) {
      throw new SlackNotificationError("api", `Slack rejected notification: ${parsed.data.error}`);
    }
  }
}
