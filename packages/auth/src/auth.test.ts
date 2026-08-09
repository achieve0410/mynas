import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { AuthService } from "./auth";

describe("AuthService", () => {
  let database: Database;
  let now: Date;

  beforeEach(() => {
    database = new Database(":memory:");
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE api_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
    `);
    now = new Date("2026-01-01T00:00:00.000Z");
  });

  afterEach(() => {
    database.close();
  });

  test("permits first-owner setup only from loopback", async () => {
    const service = new AuthService(database, () => now);

    await expect(
      service.setupOwner("owner", "correct horse battery staple", "192.0.2.10"),
    ).rejects.toThrow("loopback");

    const user = await service.setupOwner("owner", "correct horse battery staple", "127.0.0.1");
    expect(user.username).toBe("owner");

    await expect(
      service.setupOwner("second", "another correct horse phrase", "::1"),
    ).rejects.toThrow("already complete");

    const stored = database
      .query<{ readonly password_hash: string }, []>("SELECT password_hash FROM users LIMIT 1")
      .get();
    expect(stored?.password_hash).not.toContain("correct horse");
  });

  test("creates an expiring session without storing its plaintext token", async () => {
    const service = new AuthService(database, () => now);
    const user = await service.setupOwner("owner", "correct horse battery staple", "127.0.0.1");
    const session = await service.login("owner", "correct horse battery staple", "127.0.0.1");

    expect(service.authenticateSession(session.token)).toEqual(user);
    const stored = database
      .query<{ readonly id_hash: string }, []>("SELECT id_hash FROM sessions LIMIT 1")
      .get();
    expect(stored?.id_hash).not.toBe(session.token);

    now = new Date("2026-01-08T00:00:01.000Z");
    expect(() => service.authenticateSession(session.token)).toThrow("expired");
  });

  test("creates, authenticates, and revokes a hashed API token", async () => {
    const service = new AuthService(database, () => now);
    const user = await service.setupOwner("owner", "correct horse battery staple", "127.0.0.1");
    const credential = service.createApiToken(user.id, "qa");

    expect(service.authenticateApiToken(credential.token)).toEqual(user);
    const stored = database
      .query<{ readonly token_hash: string }, []>("SELECT token_hash FROM api_tokens LIMIT 1")
      .get();
    expect(stored?.token_hash).not.toBe(credential.token);

    service.revokeApiToken(user.id, credential.id);
    expect(() => service.authenticateApiToken(credential.token)).toThrow("revoked");
  });
});
