import { describe, expect, test } from "bun:test";

import { SlackTransferNotifier } from "./transfer-notifications";

const credentials = async () => ({
  channel: "C0123456789",
  token: "xoxb-test-notification-token",
});

describe("SlackTransferNotifier", () => {
  test("routes upload and download batches to their configured threads", async () => {
    const requests: Request[] = [];
    const notifier = new SlackTransferNotifier({
      credentials,
      downloadThreadTs: "1700000002.000001",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ ok: true });
      },
      uploadThreadTs: "1700000001.000001",
    });

    await notifier.send({
      items: [
        { bytes: 4, outcome: "success", path: "camera/photo.jpg" },
        {
          outcome: "failure",
          path: "camera/notes.exe",
          reason: "unsupported photo format",
        },
      ],
      operation: "upload",
      summary: { bytes: 4, failed: 1, succeeded: 1, total: 2 },
    });
    await notifier.send({
      items: [{ bytes: 8, outcome: "success", path: "reports/archive.zip" }],
      operation: "download",
      summary: { bytes: 8, failed: 0, succeeded: 1, total: 1 },
    });

    expect(requests).toHaveLength(2);
    const uploadBody = await requests[0]?.json();
    const downloadBody = await requests[1]?.json();
    expect(uploadBody).toMatchObject({
      channel: "C0123456789",
      thread_ts: "1700000001.000001",
    });
    expect(downloadBody).toMatchObject({
      channel: "C0123456789",
      thread_ts: "1700000002.000001",
    });
    expect(JSON.stringify(uploadBody)).toContain("unsupported photo format");
  });

  test("redacts credentials and local paths while preserving a network reason", async () => {
    let request: Request | undefined;
    const notifier = new SlackTransferNotifier({
      credentials,
      downloadThreadTs: "1700000002.000001",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ ok: true });
      },
      uploadThreadTs: "1700000001.000001",
    });

    await notifier.send({
      items: [
        {
          outcome: "failure",
          path: "/home/example/private.txt",
          reason:
            "network request failed with Bearer secret-value and xoxb-leaked-token at /tmp/file",
        },
      ],
      operation: "download",
      summary: { bytes: 0, failed: 1, succeeded: 0, total: 1 },
    });

    const body = await request?.text();
    expect(body).toContain("network request failed");
    expect(body).toContain("[local path]");
    expect(body).not.toContain("secret-value");
    expect(body).not.toContain("xoxb-leaked-token");
    expect(body).not.toContain("/tmp/file");
  });

  test("rejects Slack API failures returned with HTTP 200", async () => {
    const notifier = new SlackTransferNotifier({
      credentials,
      downloadThreadTs: "1700000002.000001",
      fetch: async () => Response.json({ error: "channel_not_found", ok: false }),
      uploadThreadTs: "1700000001.000001",
    });

    await expect(
      notifier.send({
        items: [{ bytes: 1, outcome: "success", path: "report.txt" }],
        operation: "upload",
        summary: { bytes: 1, failed: 0, succeeded: 1, total: 1 },
      }),
    ).rejects.toThrow("channel_not_found");
  });

  test("reports aggregate totals while bounding representative item details", async () => {
    let request: Request | undefined;
    const notifier = new SlackTransferNotifier({
      credentials,
      downloadThreadTs: "1700000002.000001",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ ok: true });
      },
      uploadThreadTs: "1700000001.000001",
    });

    await notifier.send({
      items: Array.from({ length: 100 }, (_, index) =>
        index < 2
          ? {
              outcome: "failure" as const,
              path: `failed-${index}.jpg`,
              reason: "network request failed",
            }
          : {
              bytes: 1,
              outcome: "success" as const,
              path: `sample-${index}.jpg`,
            },
      ),
      operation: "upload",
      summary: {
        bytes: 9_998,
        failed: 2,
        succeeded: 9_998,
        total: 10_000,
      },
    });

    const body = await request?.json();
    expect(body?.text).toContain("Succeeded: 9998");
    expect(body?.text).toContain("Failed: 2");
    expect(body?.text).toContain("failed-0.jpg");
  });
});
