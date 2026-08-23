import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installSlackSnapshotLaunchd,
  type LaunchctlRunner,
  slackSnapshotLaunchdStatus,
  uninstallSlackSnapshotLaunchd,
} from "./launchd";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Slack snapshot launchd integration", () => {
  test("installs a private daily schedule without embedded credentials", async () => {
    const home = await mkdtemp(join(tmpdir(), "slack-snapshot-launchd-"));
    temporaryPaths.push(home);
    const calls: string[][] = [];
    const runLaunchctl: LaunchctlRunner = async (arguments_) => {
      calls.push([...arguments_]);
      return { exitCode: arguments_[0] === "bootout" ? 3 : 0, stderr: "", stdout: "" };
    };

    const result = await installSlackSnapshotLaunchd({
      agentExecutable: "/Applications/MyNAS Runtime/bin/slack-snapshot-agent",
      home,
      keychainHelper: "/Applications/MyNAS Runtime/bin/mynas-keychain-helper",
      notificationThreadTs: "1700000000.000001",
      runLaunchctl,
      uid: 501,
    });
    const plist = await readFile(result.plistPath, "utf8");

    expect(result).toEqual({
      label: "io.mynas.slack-snapshot",
      plistPath: join(home, "Library/LaunchAgents/io.mynas.slack-snapshot.plist"),
    });
    expect((await stat(result.plistPath)).mode & 0o777).toBe(0o600);
    expect(plist).toContain("<integer>3</integer>");
    expect(plist).toContain("<integer>15</integer>");
    expect(plist).toContain("<string>create</string>");
    expect(plist).toContain("mynas-keychain-helper");
    expect(plist).toContain("<key>SLACK_NOTIFICATION_THREAD_TS</key>");
    expect(plist).toContain("<string>1700000000.000001</string>");
    expect(plist).not.toContain("mynas:slack-dashboard");
    expect(plist).not.toContain("enc:v1");
    expect(plist).not.toContain("sig:v1");
    expect(plist).not.toContain("notify:slack-bot:v1");
    expect(plist).not.toContain("notify:slack-channel:v1");
    expect(plist).not.toContain("xoxb-");
    expect(calls).toEqual([
      ["bootout", "gui/501/io.mynas.slack-snapshot"],
      ["bootstrap", "gui/501", result.plistPath],
    ]);
  });

  test("reports installed and loaded state from exact launchctl domain", async () => {
    const home = await mkdtemp(join(tmpdir(), "slack-snapshot-status-"));
    temporaryPaths.push(home);
    await installSlackSnapshotLaunchd({
      agentExecutable: "/tmp/slack-snapshot-agent",
      home,
      keychainHelper: "/tmp/mynas-keychain-helper",
      notificationThreadTs: "1700000000.000001",
      runLaunchctl: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      uid: 502,
    });
    const calls: string[][] = [];
    const status = await slackSnapshotLaunchdStatus({
      home,
      runLaunchctl: async (arguments_) => {
        calls.push([...arguments_]);
        return { exitCode: 0, stderr: "", stdout: "state = waiting\n" };
      },
      uid: 502,
    });

    expect(status).toEqual({
      installed: true,
      label: "io.mynas.slack-snapshot",
      loaded: true,
      running: false,
    });
    expect(calls).toEqual([["print", "gui/502/io.mynas.slack-snapshot"]]);
  });

  test("uninstalls idempotently and removes the private plist", async () => {
    const home = await mkdtemp(join(tmpdir(), "slack-snapshot-uninstall-"));
    temporaryPaths.push(home);
    await installSlackSnapshotLaunchd({
      agentExecutable: "/tmp/slack-snapshot-agent",
      home,
      keychainHelper: "/tmp/mynas-keychain-helper",
      notificationThreadTs: "1700000000.000001",
      runLaunchctl: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      uid: 503,
    });
    const calls: string[][] = [];
    const result = await uninstallSlackSnapshotLaunchd({
      home,
      runLaunchctl: async (arguments_) => {
        calls.push([...arguments_]);
        return { exitCode: 3, stderr: "not loaded", stdout: "" };
      },
      uid: 503,
    });

    expect(result).toEqual({ label: "io.mynas.slack-snapshot", removed: true });
    expect(calls).toEqual([["bootout", "gui/503/io.mynas.slack-snapshot"]]);
    await expect(
      stat(join(home, "Library/LaunchAgents/io.mynas.slack-snapshot.plist")),
    ).rejects.toThrow();
  });
});
