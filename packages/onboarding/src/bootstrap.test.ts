import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthService } from "../../auth/src/auth";
import { type BootstrapLocalOptions, bootstrapLocal } from "./bootstrap";

const bootstrap = (options: BootstrapLocalOptions) =>
  bootstrapLocal(options, {
    storageDeviceId: async (path) => (path.includes("secondary") ? 2n : 1n),
  });

describe("bootstrapLocal", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("initializes one owner and a healthy two-target local mirror", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-bootstrap-"));
    const dataDir = join(root, "data");
    const primaryRoot = join(root, "primary");
    const secondaryRoot = join(root, "secondary");
    const password = "synthetic bootstrap passphrase";

    const result = await bootstrap({
      dataDir,
      environment: {},
      password,
      primaryRoot,
      secondaryRoot,
      username: "owner",
      volumeId: "files",
    });

    expect(result).toEqual({
      createdBackends: ["primary", "secondary"],
      createdOwner: true,
      createdVolume: true,
      dataDir,
      volumeId: "files",
    });
    expect(JSON.stringify(result)).not.toContain(password);
    expect((await stat(primaryRoot)).isDirectory()).toBe(true);
    expect((await stat(secondaryRoot)).isDirectory()).toBe(true);

    const database = new Database(join(dataDir, "mynas.sqlite"), { readonly: true });
    try {
      expect(
        database.query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM users").get(),
      ).toEqual({ count: 1 });
      expect(
        database
          .query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM storage_backends")
          .get(),
      ).toEqual({ count: 2 });
      expect(
        database
          .query<{ readonly members_json: string }, []>(
            "SELECT members_json FROM storage_volumes WHERE id = 'files'",
          )
          .get(),
      ).toEqual({ members_json: JSON.stringify(["primary", "secondary"]) });
    } finally {
      database.close();
    }

    const writable = new Database(join(dataDir, "mynas.sqlite"));
    try {
      const auth = new AuthService(writable);
      const login = await auth.login("owner", password, "127.0.0.1");
      auth.logout(login.token);
    } finally {
      writable.close();
    }
  });

  test("is idempotent for the same authenticated topology", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-bootstrap-idempotent-"));
    const options = {
      dataDir: join(root, "data"),
      environment: {},
      password: "synthetic bootstrap passphrase",
      primaryRoot: join(root, "primary"),
      secondaryRoot: join(root, "secondary"),
      username: "owner",
      volumeId: "files",
    } as const;
    await bootstrap(options);

    await expect(bootstrap(options)).resolves.toEqual({
      createdBackends: [],
      createdOwner: false,
      createdVolume: false,
      dataDir: options.dataDir,
      volumeId: "files",
    });
    const database = new Database(join(options.dataDir, "mynas.sqlite"), { readonly: true });
    try {
      expect(
        database
          .query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM sessions")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("rejects an existing owner when the password is wrong", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-bootstrap-password-"));
    const options = {
      dataDir: join(root, "data"),
      environment: {},
      password: "synthetic bootstrap passphrase",
      primaryRoot: join(root, "primary"),
      secondaryRoot: join(root, "secondary"),
      username: "owner",
      volumeId: "files",
    } as const;
    await bootstrap(options);

    await expect(
      bootstrap({ ...options, password: "different invalid passphrase" }),
    ).rejects.toEqual(expect.objectContaining({ code: "authentication_failed" }));
  });

  test("rejects a changed root without creating the conflicting path", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-bootstrap-conflict-"));
    const options = {
      dataDir: join(root, "data"),
      environment: {},
      password: "synthetic bootstrap passphrase",
      primaryRoot: join(root, "primary"),
      secondaryRoot: join(root, "secondary"),
      username: "owner",
      volumeId: "files",
    } as const;
    await bootstrap(options);
    const conflictingRoot = join(root, "different-primary");

    await expect(bootstrap({ ...options, primaryRoot: conflictingRoot })).rejects.toEqual(
      expect.objectContaining({ code: "configuration_conflict" }),
    );
    await expect(stat(conflictingRoot)).rejects.toBeInstanceOf(Error);
  });

  test("rejects different directories hosted by one filesystem device", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-bootstrap-device-"));
    const options = {
      dataDir: join(root, "data"),
      environment: {},
      password: "synthetic bootstrap passphrase",
      primaryRoot: join(root, "primary"),
      secondaryRoot: join(root, "secondary"),
      username: "owner",
      volumeId: "photos",
    } as const;

    await expect(
      bootstrapLocal(options, {
        storageDeviceId: async () => 1n,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "configuration_conflict" }));
    const database = new Database(join(options.dataDir, "mynas.sqlite"), { readonly: true });
    try {
      expect(
        database.query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM users").get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("rejects a catalog directory that overlaps a backend root", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-bootstrap-overlap-"));
    const options = {
      dataDir: join(root, "primary"),
      environment: {},
      password: "synthetic bootstrap passphrase",
      primaryRoot: join(root, "primary"),
      secondaryRoot: join(root, "secondary"),
      username: "owner",
      volumeId: "photos",
    } as const;

    await expect(
      bootstrapLocal(options, {
        storageDeviceId: async (path) => (path.includes("secondary") ? 2n : 1n),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "configuration_conflict" }));
    const database = new Database(join(options.dataDir, "mynas.sqlite"), { readonly: true });
    try {
      expect(
        database.query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM users").get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});
