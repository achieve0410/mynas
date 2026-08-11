import type { Database } from "bun:sqlite";

export type User = {
  readonly id: string;
  readonly username: string;
};

export type SessionCredential = {
  readonly token: string;
  readonly user: User;
  readonly expiresAt: string;
};

export type ApiTokenCredential = {
  readonly id: string;
  readonly name: string;
  readonly token: string;
};

export type ApiTokenRecord = {
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
};

export type AuthErrorCode =
  | "authentication_failed"
  | "invalid_input"
  | "setup_complete"
  | "setup_forbidden"
  | "token_revoked";

export class AuthError extends Error {
  public constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

type UserRow = {
  readonly id: string;
  readonly username: string;
  readonly password_hash: string;
};

type SessionRow = {
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly user_id: string;
  readonly username: string;
};

type ApiTokenRow = {
  readonly revoked_at: string | null;
  readonly user_id: string;
  readonly username: string;
};

type ApiTokenListRow = {
  readonly created_at: string;
  readonly id: string;
  readonly name: string;
};

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

const isLoopback = (address: string): boolean =>
  address === "127.0.0.1" ||
  address === "::1" ||
  address === "localhost" ||
  address === "::ffff:127.0.0.1";

const sha256 = (value: string): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

const createSecret = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
};

const toUser = (row: Pick<UserRow, "id" | "username">): User => ({
  id: row.id,
  username: row.username,
});

const requirePassword = (password: string): void => {
  if ([...password].length < 12) {
    throw new AuthError("invalid_input", "password must contain at least 12 characters");
  }
};

export class AuthService {
  public constructor(
    private readonly database: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async setupOwner(username: string, password: string, peerAddress: string): Promise<User> {
    if (!isLoopback(peerAddress)) {
      throw new AuthError("setup_forbidden", "owner setup is restricted to a loopback peer");
    }
    if (username.trim().length === 0) {
      throw new AuthError("invalid_input", "username is required");
    }
    requirePassword(password);

    const passwordHash = await Bun.password.hash(password, "argon2id");
    const user: User = {
      id: crypto.randomUUID(),
      username: username.trim(),
    };

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM users")
        .get();
      if (existing === null || existing.count !== 0) {
        throw new AuthError("setup_complete", "owner setup is already complete");
      }
      this.database
        .query("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
        .run(user.id, user.username, passwordHash, this.now().toISOString());
      this.database.exec("COMMIT");
      return user;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public async login(
    username: string,
    password: string,
    _peerAddress: string,
  ): Promise<SessionCredential> {
    const user = await this.verifyPassword(username, password);
    const token = createSecret();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + SESSION_LIFETIME_MS);
    this.database
      .query("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(sha256(token), user.id, createdAt.toISOString(), expiresAt.toISOString());

    return {
      expiresAt: expiresAt.toISOString(),
      token,
      user,
    };
  }

  public async verifyPassword(username: string, password: string): Promise<User> {
    const row = this.database
      .query<UserRow, [string]>("SELECT id, username, password_hash FROM users WHERE username = ?")
      .get(username);
    if (row === null || !(await Bun.password.verify(password, row.password_hash))) {
      throw new AuthError("authentication_failed", "username or password is invalid");
    }
    return toUser(row);
  }

  public authenticateSession(token: string): User {
    const row = this.database
      .query<SessionRow, [string]>(
        `SELECT sessions.user_id, sessions.expires_at, sessions.revoked_at, users.username
         FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.id_hash = ?`,
      )
      .get(sha256(token));
    if (row === null) {
      throw new AuthError("authentication_failed", "session is invalid");
    }
    if (row.revoked_at !== null) {
      throw new AuthError("authentication_failed", "session is revoked");
    }
    if (Date.parse(row.expires_at) <= this.now().getTime()) {
      throw new AuthError("authentication_failed", "session has expired");
    }
    return { id: row.user_id, username: row.username };
  }

  public logout(token: string): void {
    this.database
      .query("UPDATE sessions SET revoked_at = ? WHERE id_hash = ?")
      .run(this.now().toISOString(), sha256(token));
  }

  public createApiToken(userId: string, name: string): ApiTokenCredential {
    if (name.trim().length === 0) {
      throw new AuthError("invalid_input", "token name is required");
    }
    const credential: ApiTokenCredential = {
      id: crypto.randomUUID(),
      name: name.trim(),
      token: createSecret(),
    };
    this.database
      .query(
        "INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        credential.id,
        userId,
        credential.name,
        sha256(credential.token),
        this.now().toISOString(),
      );
    return credential;
  }

  public authenticateApiToken(token: string): User {
    const row = this.database
      .query<ApiTokenRow, [string]>(
        `SELECT api_tokens.user_id, api_tokens.revoked_at, users.username
         FROM api_tokens
         JOIN users ON users.id = api_tokens.user_id
         WHERE api_tokens.token_hash = ?`,
      )
      .get(sha256(token));
    if (row === null) {
      throw new AuthError("authentication_failed", "API token is invalid");
    }
    if (row.revoked_at !== null) {
      throw new AuthError("token_revoked", "API token is revoked");
    }
    return { id: row.user_id, username: row.username };
  }

  public listApiTokens(userId: string): readonly ApiTokenRecord[] {
    return this.database
      .query<ApiTokenListRow, [string]>(
        `SELECT id, name, created_at
         FROM api_tokens
         WHERE user_id = ? AND revoked_at IS NULL
         ORDER BY created_at, id`,
      )
      .all(userId)
      .map((row) => ({ createdAt: row.created_at, id: row.id, name: row.name }));
  }

  public revokeApiToken(userId: string, id: string): void {
    this.database
      .query("UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND id = ?")
      .run(this.now().toISOString(), userId, id);
  }
}
