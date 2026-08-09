import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { createApp } from "../../apps/server/src/app";
import { migrate } from "../../packages/database/src/migrations";

const userSchema = z.object({ id: z.string().uuid(), username: z.string() });
const loginSchema = z.object({
  expiresAt: z.string().datetime(),
  token: z.string().min(32),
  user: userSchema,
});
const tokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  token: z.string().min(32),
});

describe("owner authentication API", () => {
  let app: ReturnType<typeof createApp>;
  let database: Database;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-api-auth-"));
    database = new Database(":memory:");
    migrate(database);
    app = createApp({ dataDir, database, environment: {} });
  });

  afterEach(async () => {
    database.close();
    await rm(dataDir, { force: true, recursive: true });
  });

  test("requires authentication for system status", async () => {
    const health = await app.request("/api/v1/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const response = await app.request("/api/v1/system/status");
    expect(response.status).toBe(401);
  });

  test("sets up one loopback owner, logs in, and issues a revocable API token", async () => {
    const setup = await app.request("/api/v1/setup", {
      body: JSON.stringify({
        password: "synthetic owner passphrase",
        username: "owner",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(setup.status).toBe(201);
    expect(userSchema.parse(await setup.json()).username).toBe("owner");

    const duplicate = await app.request("/api/v1/setup", {
      body: JSON.stringify({
        password: "another synthetic passphrase",
        username: "second",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(duplicate.status).toBe(409);

    const login = await app.request("/api/v1/login", {
      body: JSON.stringify({
        password: "synthetic owner passphrase",
        username: "owner",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const session = loginSchema.parse(await login.json());

    const created = await app.request("/api/v1/tokens", {
      body: JSON.stringify({ name: "qa" }),
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const apiToken = tokenSchema.parse(await created.json());

    const status = await app.request("/api/v1/system/status", {
      headers: { authorization: `Bearer ${apiToken.token}` },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ setupComplete: true, version: "0.1.0" });

    const revoked = await app.request(`/api/v1/tokens/${apiToken.id}`, {
      headers: { authorization: `Bearer ${session.token}` },
      method: "DELETE",
    });
    expect(revoked.status).toBe(204);
    expect(
      (
        await app.request("/api/v1/system/status", {
          headers: { authorization: `Bearer ${apiToken.token}` },
        })
      ).status,
    ).toBe(401);

    const persisted = JSON.stringify(database.query("SELECT password_hash FROM users").all());
    expect(persisted).not.toContain("synthetic owner passphrase");
    expect(persisted).not.toContain(apiToken.token);
  });

  test("rejects initial setup from a non-loopback peer", async () => {
    const remote = createApp({
      dataDir,
      database,
      environment: {},
      peerAddress: () => "192.0.2.10",
    });
    const response = await remote.request("/api/v1/setup", {
      body: JSON.stringify({
        password: "synthetic owner passphrase",
        username: "owner",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(403);
  });
});
