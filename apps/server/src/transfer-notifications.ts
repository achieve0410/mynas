import { z } from "zod";

import {
  processSnapshotKeychainRunner,
  SnapshotKeychain,
} from "../../../packages/snapshots/src/keychain";

import type { AppInstance, AppServices } from "./types";

const threadTimestampSchema = z.string().regex(/^\d{10}\.\d{6}$/);
const successItemSchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    outcome: z.literal("success"),
    path: z.string().min(1).max(512),
  })
  .strict();
const failureItemSchema = z
  .object({
    outcome: z.literal("failure"),
    path: z.string().min(1).max(512),
    reason: z.string().min(1).max(500),
  })
  .strict();
const notificationSummarySchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .strict()
  .refine(({ failed, succeeded, total }) => failed + succeeded === total, {
    message: "summary total must equal succeeded plus failed",
  });

export const transferNotificationSchema = z
  .object({
    items: z
      .array(z.discriminatedUnion("outcome", [successItemSchema, failureItemSchema]))
      .min(1)
      .max(100),
    operation: z.enum(["download", "upload"]),
    summary: notificationSummarySchema,
  })
  .strict();

export type TransferNotification = z.infer<typeof transferNotificationSchema>;

export type TransferNotificationService = {
  readonly send: (notification: TransferNotification) => Promise<void>;
};

type SlackCredentials = {
  readonly channel: string;
  readonly token: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type SlackTransferNotifierOptions = {
  readonly credentials: () => Promise<SlackCredentials>;
  readonly downloadThreadTs: string;
  readonly fetch: FetchLike;
  readonly uploadThreadTs: string;
};

const slackResponseSchema = z
  .object({
    error: z.string().optional(),
    ok: z.boolean(),
  })
  .passthrough();

const sanitize = (value: string, maxLength: number): string =>
  value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]+\b/g, "[redacted]")
    .replace(/(?:\/(?:Users|home|private|tmp|var)\/)[^\s]+/g, "[local path]")
    .slice(0, maxLength);

const formatNotification = (notification: TransferNotification): string => {
  const heading = notification.operation === "upload" ? "upload" : "download";
  const items = notification.items.map((item) =>
    item.outcome === "success"
      ? `- success: ${sanitize(item.path, 512)} (${item.bytes} bytes)`
      : `- failure: ${sanitize(item.path, 512)} — ${sanitize(item.reason, 500)}`,
  );
  return [
    `MyNAS ${heading} batch completed`,
    `Succeeded: ${notification.summary.succeeded}`,
    `Failed: ${notification.summary.failed}`,
    `Bytes protected: ${notification.summary.bytes}`,
    `Details: ${notification.items.length} of ${notification.summary.total}`,
    ...items,
  ].join("\n");
};

export class SlackTransferNotifier implements TransferNotificationService {
  private readonly downloadThreadTs: string;
  private readonly uploadThreadTs: string;

  public constructor(private readonly options: SlackTransferNotifierOptions) {
    this.downloadThreadTs = threadTimestampSchema.parse(options.downloadThreadTs);
    this.uploadThreadTs = threadTimestampSchema.parse(options.uploadThreadTs);
  }

  public async send(notification: TransferNotification): Promise<void> {
    const input = transferNotificationSchema.parse(notification);
    const credentials = await this.options.credentials();
    const response = await this.options.fetch("https://slack.com/api/chat.postMessage", {
      body: JSON.stringify({
        channel: credentials.channel,
        text: formatNotification(input),
        thread_ts: input.operation === "upload" ? this.uploadThreadTs : this.downloadThreadTs,
      }),
      headers: {
        authorization: `Bearer ${credentials.token}`,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Slack notification request failed with ${response.status}`);
    }
    const result = slackResponseSchema.parse(await response.json());
    if (!result.ok) {
      throw new Error(result.error ?? "Slack notification failed");
    }
  }
}

class NoopTransferNotifier implements TransferNotificationService {
  public async send(_notification: TransferNotification): Promise<void> {}
}

const requiredEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string => {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required when Slack transfer notifications are configured`);
  }
  return value;
};

export const createTransferNotificationService = (
  environment: Readonly<Record<string, string | undefined>>,
  fetchImplementation: FetchLike = fetch,
): TransferNotificationService => {
  const names = [
    "MYNAS_SLACK_KEYCHAIN_HELPER",
    "MYNAS_SLACK_UPLOAD_THREAD_TS",
    "MYNAS_SLACK_DOWNLOAD_THREAD_TS",
  ] as const;
  if (names.every((name) => environment[name] === undefined)) {
    return new NoopTransferNotifier();
  }
  const keychain = new SnapshotKeychain(
    processSnapshotKeychainRunner(requiredEnvironment(environment, names[0])),
    "io.mynas.slack-snapshot",
  );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return new SlackTransferNotifier({
    credentials: async () => {
      const [channel, token] = await Promise.all([
        keychain.get("notify:slack-channel:v1"),
        keychain.get("notify:slack-bot:v1"),
      ]);
      return {
        channel: decoder.decode(channel),
        token: decoder.decode(token),
      };
    },
    downloadThreadTs: requiredEnvironment(environment, names[2]),
    fetch: fetchImplementation,
    uploadThreadTs: requiredEnvironment(environment, names[1]),
  });
};

export const registerTransferNotificationRoutes = (
  app: AppInstance,
  services: AppServices,
): void => {
  app.post("/api/v1/transfer-notifications", async (context) => {
    const notification = transferNotificationSchema.parse(await context.req.json());
    await services.transferNotifications?.send(notification);
    return context.body(null, 204);
  });
};
