import { describe, expect, test } from "bun:test";

import { type CliDependencies, runCli } from "../../apps/cli/src/cli";

const fixture = (
  overrides: Partial<CliDependencies>,
): {
  readonly dependencies: CliDependencies;
  readonly stderr: string[];
  readonly stdout: string[];
} => {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    dependencies: {
      environment: {},
      fetch,
      readFile: async () => new Uint8Array(),
      readStdin: async () => "synthetic bootstrap passphrase\n",
      stderr: (line) => stderr.push(line),
      stdout: (line) => stdout.push(line),
      writeFile: async () => undefined,
      ...overrides,
    },
    stderr,
    stdout,
  };
};

describe("bootstrap CLI", () => {
  test("reads one password line and emits a secret-free receipt", async () => {
    const calls: unknown[] = [];
    const command = fixture({
      bootstrapLocal: async (options) => {
        calls.push(options);
        return {
          createdBackends: ["primary", "secondary"],
          createdOwner: true,
          createdVolume: true,
          dataDir: "/tmp/mynas/data",
          volumeId: "photos",
        };
      },
    });

    expect(
      await runCli(
        [
          "bootstrap",
          "--data-dir",
          "/tmp/mynas/data",
          "--primary-root",
          "/tmp/mynas/primary",
          "--secondary-root",
          "/tmp/mynas/secondary",
          "--password-stdin",
        ],
        command.dependencies,
      ),
    ).toBe(0);
    expect(calls).toEqual([
      {
        dataDir: "/tmp/mynas/data",
        password: "synthetic bootstrap passphrase",
        primaryRoot: "/tmp/mynas/primary",
        secondaryRoot: "/tmp/mynas/secondary",
        username: "owner",
        volumeId: "photos",
      },
    ]);
    expect(command.stdout.join("")).not.toContain("synthetic bootstrap passphrase");
    expect(JSON.parse(command.stdout.join(""))).toMatchObject({
      createdOwner: true,
      volumeId: "photos",
    });
    expect(command.stderr).toEqual([]);
  });

  test("rejects multiline password input before touching storage", async () => {
    let calls = 0;
    const command = fixture({
      bootstrapLocal: async () => {
        calls += 1;
        return {
          createdBackends: [],
          createdOwner: false,
          createdVolume: false,
          dataDir: "/tmp/mynas/data",
          volumeId: "photos",
        };
      },
      readStdin: async () => "first line\nsecond line\n",
    });

    expect(
      await runCli(
        [
          "bootstrap",
          "--data-dir",
          "/tmp/mynas/data",
          "--primary-root",
          "/tmp/mynas/primary",
          "--secondary-root",
          "/tmp/mynas/secondary",
          "--password-stdin",
        ],
        command.dependencies,
      ),
    ).toBe(1);
    expect(calls).toBe(0);
    expect(command.stderr.join("")).toContain("exactly one non-empty line");
  });
});
