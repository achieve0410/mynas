import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const SLACK_SNAPSHOT_LAUNCHD_LABEL = "io.mynas.slack-snapshot";

export type LaunchctlResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export type LaunchctlRunner = (arguments_: readonly string[]) => Promise<LaunchctlResult>;

type BaseOptions = {
  readonly home: string;
  readonly runLaunchctl: LaunchctlRunner;
  readonly uid: number;
};

type InstallOptions = BaseOptions & {
  readonly agentExecutable: string;
  readonly keychainHelper: string;
};

const escaped = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const plistPath = (home: string): string =>
  join(home, "Library", "LaunchAgents", `${SLACK_SNAPSHOT_LAUNCHD_LABEL}.plist`);

const domain = (uid: number): string => {
  if (!Number.isSafeInteger(uid) || uid < 0) {
    throw new Error("launchd uid is invalid");
  }
  return `gui/${uid}`;
};

const assertAbsolute = (value: string, name: string): void => {
  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
};

const renderPlist = (options: InstallOptions): string => {
  const logRoot = join(options.home, "Library", "Logs", "MyNAS");
  const values = {
    agent: escaped(options.agentExecutable),
    helper: escaped(options.keychainHelper),
    home: escaped(options.home),
    stderr: escaped(join(logRoot, "slack-snapshot.err.log")),
    stdout: escaped(join(logRoot, "slack-snapshot.log")),
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SLACK_SNAPSHOT_LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${values.agent}</string><string>create</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${values.home}</string>
    <key>MYNAS_SNAPSHOT_KEYCHAIN_HELPER</key><string>${values.helper}</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>15</integer></dict>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>WorkingDirectory</key><string>${values.home}</string>
  <key>StandardOutPath</key><string>${values.stdout}</string>
  <key>StandardErrorPath</key><string>${values.stderr}</string>
</dict>
</plist>
`;
};

const installed = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const installSlackSnapshotLaunchd = async (
  options: InstallOptions,
): Promise<{ readonly label: string; readonly plistPath: string }> => {
  assertAbsolute(options.home, "home");
  assertAbsolute(options.agentExecutable, "snapshot agent executable");
  assertAbsolute(options.keychainHelper, "Keychain helper");
  const target = plistPath(options.home);
  const temporary = `${target}.new-${randomUUID()}`;
  await Promise.all([
    mkdir(join(options.home, "Library", "LaunchAgents"), { recursive: true }),
    mkdir(join(options.home, "Library", "Logs", "MyNAS"), { mode: 0o700, recursive: true }),
  ]);
  await writeFile(temporary, renderPlist(options), { flag: "wx", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await options.runLaunchctl(["bootout", `${domain(options.uid)}/${SLACK_SNAPSHOT_LAUNCHD_LABEL}`]);
  const result = await options.runLaunchctl(["bootstrap", domain(options.uid), target]);
  if (result.exitCode !== 0) {
    await rm(target, { force: true });
    throw new Error(result.stderr || `launchctl bootstrap failed with ${result.exitCode}`);
  }
  return { label: SLACK_SNAPSHOT_LAUNCHD_LABEL, plistPath: target };
};

export const slackSnapshotLaunchdStatus = async (
  options: BaseOptions,
): Promise<{
  readonly installed: boolean;
  readonly label: string;
  readonly loaded: boolean;
  readonly running: boolean;
}> => {
  const result = await options.runLaunchctl([
    "print",
    `${domain(options.uid)}/${SLACK_SNAPSHOT_LAUNCHD_LABEL}`,
  ]);
  return {
    installed: await installed(plistPath(options.home)),
    label: SLACK_SNAPSHOT_LAUNCHD_LABEL,
    loaded: result.exitCode === 0,
    running: result.exitCode === 0 && /state = running(?:\s|$)/.test(result.stdout),
  };
};

export const uninstallSlackSnapshotLaunchd = async (
  options: BaseOptions,
): Promise<{ readonly label: string; readonly removed: boolean }> => {
  const target = plistPath(options.home);
  const exists = await installed(target);
  await options.runLaunchctl(["bootout", `${domain(options.uid)}/${SLACK_SNAPSHOT_LAUNCHD_LABEL}`]);
  await rm(target, { force: true });
  return { label: SLACK_SNAPSHOT_LAUNCHD_LABEL, removed: exists };
};
