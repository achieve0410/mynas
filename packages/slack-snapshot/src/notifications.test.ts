import { describe, expect, test } from "bun:test";

import { SlackWebApiNotifier } from "./notifications";

describe("SlackWebApiNotifier", () => {
  test("posts successful backup and retention facts to the configured channel", async () => {
    const requests: Request[] = [];
    const notifier = new SlackWebApiNotifier({
      channel: "C0123456789",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ ok: true });
      },
      token: "xoxb-test-notification-token",
    });

    await notifier.send({
      bundleId: "00000000-0000-4000-8000-000000000001",
      deletedCount: 2,
      kind: "success",
      retainedCount: 14,
      snapshotId: "00112233445566778899aabbccddeeff",
      totalBytes: 26_047_286,
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe("https://slack.com/api/chat.postMessage");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBe("Bearer xoxb-test-notification-token");
    const body = await request?.json();
    expect(body).toMatchObject({ channel: "C0123456789" });
    expect(JSON.stringify(body)).toContain("00000000-0000-4000-8000-000000000001");
    expect(JSON.stringify(body)).toContain("26047286");
    expect(JSON.stringify(body)).toContain("14");
    expect(JSON.stringify(body)).not.toContain("xoxb-test-notification-token");
  });

  test("redacts credentials from failure details before posting", async () => {
    let request: Request | undefined;
    const notifier = new SlackWebApiNotifier({
      channel: "C0123456789",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ ok: true });
      },
      token: "xoxb-test-notification-token",
    });

    await notifier.send({
      kind: "backup_failure",
      reason: "request failed with Bearer secret-value and xoxb-leaked-token",
    });

    const body = await request?.text();
    expect(body).toContain("request failed");
    expect(body).not.toContain("secret-value");
    expect(body).not.toContain("xoxb-leaked-token");
  });

  test("posts notifications as replies to the configured Slack thread", async () => {
    let request: Request | undefined;
    const notifier = new SlackWebApiNotifier({
      channel: "C0123456789",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ ok: true });
      },
      threadTs: "1700000000.000001",
      token: "xoxb-test-notification-token",
    });

    await notifier.send({
      kind: "backup_failure",
      reason: "controlled failure",
    });

    expect(await request?.json()).toMatchObject({
      channel: "C0123456789",
      thread_ts: "1700000000.000001",
    });
  });

  test("rejects Slack API failures even when HTTP succeeds", async () => {
    const notifier = new SlackWebApiNotifier({
      channel: "C0123456789",
      fetch: async () => Response.json({ error: "channel_not_found", ok: false }),
      token: "xoxb-test-notification-token",
    });

    await expect(
      notifier.send({
        bundleId: "00000000-0000-4000-8000-000000000001",
        kind: "retention_failure",
        reason: "delete failed",
      }),
    ).rejects.toThrow("channel_not_found");
  });
});
