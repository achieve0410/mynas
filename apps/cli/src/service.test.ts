import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type LaunchctlResult, LaunchdServiceManager } from "./service";

describe("LaunchdServiceManager", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    if (homeDir !== undefined) {
      await rm(homeDir, { force: true, recursive: true });
    }
  });

  test("writes a private plist and replaces a running service exactly", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "mynas-launchd-"));
    const calls: readonly string[][] = [];
    const mutableCalls = calls as string[][];
    const results: LaunchctlResult[] = [
      { exitCode: 0, stderr: "", stdout: "state = running" },
      { exitCode: 0, stderr: "", stdout: "" },
      { exitCode: 0, stderr: "", stdout: "" },
    ];
    const plistPath = join(homeDir, "Library/LaunchAgents/com.mynas.service.plist");
    await mkdir(join(homeDir, "Library/LaunchAgents"), { recursive: true });
    await writeFile(plistPath, "old plist");
    const manager = new LaunchdServiceManager({
      homeDir,
      programArguments: ["/tmp/MyNAS & Tools/bin/mynas"],
      runLaunchctl: async (arguments_) => {
        mutableCalls.push([...arguments_]);
        const result = results.shift();
        if (result === undefined) {
          throw new Error("unexpected launchctl call");
        }
        return result;
      },
      uid: 501,
    });
    const dataDir = join(homeDir, "Library/Application Support/MyNAS/data");

    const receipt = await manager.install({
      dataDir,
      host: "127.0.0.1",
      port: 7331,
      start: true,
    });

    expect(receipt).toEqual({
      label: "com.mynas.service",
      plistPath: join(homeDir, "Library/LaunchAgents/com.mynas.service.plist"),
      started: true,
    });
    expect(calls).toEqual([
      ["print", "gui/501/com.mynas.service"],
      ["bootout", "gui/501/com.mynas.service"],
      ["bootstrap", "gui/501", join(homeDir, "Library/LaunchAgents/com.mynas.service.plist")],
    ]);
    const plist = await readFile(receipt.plistPath, "utf8");
    expect(plist).toContain("<string>/tmp/MyNAS &amp; Tools/bin/mynas</string>");
    expect(plist).toContain(`<string>${dataDir}</string>`);
    expect(plist).toContain("<string>7331</string>");
    expect((await stat(receipt.plistPath)).mode & 0o777).toBe(0o600);
  });

  test("writes selected environment values without shell evaluation", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "mynas-launchd-environment-"));
    const manager = new LaunchdServiceManager({
      homeDir,
      programArguments: ["/tmp/mynas"],
      runLaunchctl: async () => ({
        exitCode: 113,
        stderr: "Could not find service",
        stdout: "",
      }),
      uid: 506,
    });

    const receipt = await manager.install({
      dataDir: join(homeDir, "data"),
      environmentVariables: {
        MYNAS_ALLOW_REMOTE: "true",
        S3_SECRET: "value & <not-shell>",
      },
      host: "0.0.0.0",
      port: 7331,
      start: false,
    });

    const plist = await readFile(receipt.plistPath, "utf8");
    expect(plist).toContain("<key>EnvironmentVariables</key>");
    expect(plist).toContain("<key>S3_SECRET</key>");
    expect(plist).toContain("<string>value &amp; &lt;not-shell&gt;</string>");
  });

  test("reports stopped and uninstalls without treating absence as failure", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "mynas-launchd-status-"));
    const calls: string[][] = [];
    const manager = new LaunchdServiceManager({
      homeDir,
      programArguments: ["/tmp/mynas"],
      runLaunchctl: async (arguments_) => {
        calls.push([...arguments_]);
        return { exitCode: 113, stderr: "Could not find service", stdout: "" };
      },
      uid: 502,
    });
    await manager.install({
      dataDir: join(homeDir, "data"),
      host: "127.0.0.1",
      port: 7331,
      start: false,
    });

    await expect(manager.status()).resolves.toEqual({
      installed: true,
      label: "com.mynas.service",
      loaded: false,
      running: false,
    });
    await expect(manager.uninstall()).resolves.toEqual({
      label: "com.mynas.service",
      removed: true,
    });
    await expect(manager.uninstall()).resolves.toEqual({
      label: "com.mynas.service",
      removed: false,
    });
    expect(calls).toEqual([
      ["print", "gui/502/com.mynas.service"],
      ["print", "gui/502/com.mynas.service"],
      ["print", "gui/502/com.mynas.service"],
      ["print", "gui/502/com.mynas.service"],
    ]);
  });

  test("unloads a running service even when its plist was removed externally", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "mynas-launchd-stale-"));
    const calls: string[][] = [];
    const results: LaunchctlResult[] = [
      { exitCode: 0, stderr: "", stdout: "service = running" },
      { exitCode: 0, stderr: "", stdout: "" },
    ];
    const manager = new LaunchdServiceManager({
      homeDir,
      programArguments: ["/tmp/mynas"],
      runLaunchctl: async (arguments_) => {
        calls.push([...arguments_]);
        const result = results.shift();
        if (result === undefined) {
          throw new Error("unexpected launchctl call");
        }
        return result;
      },
      uid: 503,
    });

    await expect(manager.uninstall()).resolves.toEqual({
      label: "com.mynas.service",
      removed: true,
    });
    expect(calls).toEqual([
      ["print", "gui/503/com.mynas.service"],
      ["bootout", "gui/503/com.mynas.service"],
    ]);
  });

  test("restores the previous plist and loaded job when replacement fails", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "mynas-launchd-rollback-"));
    const plistPath = join(homeDir, "Library/LaunchAgents/com.mynas.service.plist");
    await mkdir(join(homeDir, "Library/LaunchAgents"), { recursive: true });
    await writeFile(plistPath, "previous plist", { mode: 0o600 });
    const calls: string[][] = [];
    const results: LaunchctlResult[] = [
      { exitCode: 0, stderr: "", stdout: "state = running" },
      { exitCode: 0, stderr: "", stdout: "" },
      { exitCode: 5, stderr: "new bootstrap failed", stdout: "" },
      { exitCode: 0, stderr: "", stdout: "" },
    ];
    const manager = new LaunchdServiceManager({
      homeDir,
      programArguments: ["/tmp/mynas"],
      runLaunchctl: async (arguments_) => {
        calls.push([...arguments_]);
        const result = results.shift();
        if (result === undefined) {
          throw new Error("unexpected launchctl call");
        }
        return result;
      },
      uid: 504,
    });

    await expect(
      manager.install({
        dataDir: join(homeDir, "data"),
        host: "127.0.0.1",
        port: 7331,
        start: true,
      }),
    ).rejects.toThrow("new bootstrap failed");
    expect(await readFile(plistPath, "utf8")).toBe("previous plist");
    expect(calls).toEqual([
      ["print", "gui/504/com.mynas.service"],
      ["bootout", "gui/504/com.mynas.service"],
      ["bootstrap", "gui/504", plistPath],
      ["bootstrap", "gui/504", plistPath],
    ]);
  });

  test("refuses no-start replacement while a job is loaded", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "mynas-launchd-loaded-"));
    const plistPath = join(homeDir, "Library/LaunchAgents/com.mynas.service.plist");
    await mkdir(join(homeDir, "Library/LaunchAgents"), { recursive: true });
    await writeFile(plistPath, "loaded plist", { mode: 0o600 });
    const manager = new LaunchdServiceManager({
      homeDir,
      programArguments: ["/tmp/mynas"],
      runLaunchctl: async () => ({ exitCode: 0, stderr: "", stdout: "state = waiting" }),
      uid: 505,
    });

    await expect(
      manager.install({
        dataDir: join(homeDir, "data"),
        host: "127.0.0.1",
        port: 7331,
        start: false,
      }),
    ).rejects.toThrow("loaded");
    expect(await readFile(plistPath, "utf8")).toBe("loaded plist");
  });
});
