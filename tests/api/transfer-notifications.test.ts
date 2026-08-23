import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";

const loginSchema = z.object({ token: z.string().min(32) });

describe("transfer notification API", () => {
  let app: ReturnType<typeof createApp>;
  let database: Database;
  let dataDir: string;
  let token: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-transfer-notifications-"));
    database = new Database(":memory:");
    migrate(database);
    app = createApp({ dataDir, database, environment: {} });

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
    token = loginSchema.parse(await login.json()).token;
  });

  afterEach(async () => {
    database.close();
    await rm(dataDir, { force: true, recursive: true });
  });

  test("accepts one authenticated upload batch with per-item failure reasons", async () => {
    const response = await app.request("/api/v1/transfer-notifications", {
      body: JSON.stringify({
        items: [
          {
            bytes: 1_024,
            outcome: "success",
            path: "camera/IMG_0001.jpg",
          },
          {
            outcome: "failure",
            path: "camera/notes.exe",
            reason: "unsupported photo format",
          },
        ],
        operation: "upload",
        summary: { bytes: 1_024, failed: 1, succeeded: 1, total: 2 },
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  test("rejects a failed item without a reason", async () => {
    const response = await app.request("/api/v1/transfer-notifications", {
      body: JSON.stringify({
        items: [{ outcome: "failure", path: "missing.txt" }],
        operation: "download",
        summary: { bytes: 0, failed: 1, succeeded: 0, total: 1 },
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
  });

  test("requires owner authentication", async () => {
    const response = await app.request("/api/v1/transfer-notifications", {
      body: JSON.stringify({
        items: [{ bytes: 1, outcome: "success", path: "archive.txt" }],
        operation: "download",
        summary: { bytes: 1, failed: 0, succeeded: 1, total: 1 },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(401);
  });
});
