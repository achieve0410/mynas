import { describe, expect, test } from "bun:test";

import { type CliDependencies, runCli } from "../../apps/cli/src/cli";

const dependencies = (
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
      readStdin: async () => "",
      stderr: (line) => stderr.push(line),
      stdout: (line) => stdout.push(line),
      writeFile: async () => undefined,
      ...overrides,
    },
    stderr,
    stdout,
  };
};

describe("service CLI", () => {
  test("installs an idempotent loopback launchd service", async () => {
    const calls: unknown[] = [];
    const fixture = dependencies({
      installService: async (options) => {
        calls.push(options);
        return {
          label: "com.mynas.service",
          plistPath: "/tmp/home/Library/LaunchAgents/com.mynas.service.plist",
          started: false,
        };
      },
    });

    expect(
      await runCli(
        [
          "service",
          "install",
          "--data-dir",
          "/tmp/home/Library/Application Support/MyNAS/data",
          "--no-start",
        ],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(calls).toEqual([
      {
        dataDir: "/tmp/home/Library/Application Support/MyNAS/data",
        environmentVariables: {},
        host: "127.0.0.1",
        port: 7331,
        start: false,
      },
    ]);
    expect(JSON.parse(fixture.stdout.join(""))).toEqual({
      label: "com.mynas.service",
      plistPath: "/tmp/home/Library/LaunchAgents/com.mynas.service.plist",
      started: false,
    });
    expect(fixture.stderr).toEqual([]);
  });

  test("reports service status without treating stopped as an error", async () => {
    const fixture = dependencies({
      serviceStatus: async () => ({
        installed: true,
        label: "com.mynas.service",
        loaded: false,
        running: false,
      }),
    });

    expect(await runCli(["service", "status"], fixture.dependencies)).toBe(0);
    expect(JSON.parse(fixture.stdout.join(""))).toEqual({
      installed: true,
      label: "com.mynas.service",
      loaded: false,
      running: false,
    });
  });

  test("uninstalls the launch agent idempotently", async () => {
    let calls = 0;
    const fixture = dependencies({
      uninstallService: async () => {
        calls += 1;
        return { label: "com.mynas.service", removed: true };
      },
    });

    expect(await runCli(["service", "uninstall"], fixture.dependencies)).toBe(0);
    expect(calls).toBe(1);
    expect(JSON.parse(fixture.stdout.join(""))).toEqual({
      label: "com.mynas.service",
      removed: true,
    });
  });

  test("rejects a relative launchd data directory before installation", async () => {
    let calls = 0;
    const fixture = dependencies({
      installService: async () => {
        calls += 1;
        return {
          label: "com.mynas.service",
          plistPath: "/tmp/unused.plist",
          started: false,
        };
      },
    });

    expect(
      await runCli(
        ["service", "install", "--data-dir", "relative/data", "--no-start"],
        fixture.dependencies,
      ),
    ).toBe(1);
    expect(calls).toBe(0);
    expect(fixture.stderr.join("")).toContain("absolute");
  });

  test("persists only explicitly selected service environment variables", async () => {
    const calls: unknown[] = [];
    const fixture = dependencies({
      environment: {
        MYNAS_ALLOW_REMOTE: "true",
        S3_SECRET: "synthetic service secret",
      },
      installService: async (options) => {
        calls.push(options);
        return {
          label: "com.mynas.service",
          plistPath: "/tmp/service.plist",
          started: false,
        };
      },
    });

    expect(
      await runCli(
        [
          "service",
          "install",
          "--data-dir",
          "/tmp/data",
          "--host",
          "0.0.0.0",
          "--env",
          "S3_SECRET",
          "--no-start",
        ],
        fixture.dependencies,
      ),
    ).toBe(0);
    expect(calls).toEqual([
      {
        dataDir: "/tmp/data",
        environmentVariables: {
          MYNAS_ALLOW_REMOTE: "true",
          S3_SECRET: "synthetic service secret",
        },
        host: "0.0.0.0",
        port: 7331,
        start: false,
      },
    ]);
  });
});
