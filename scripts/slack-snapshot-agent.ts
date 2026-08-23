import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

import { HttpSnapshotDownloadClient } from "../packages/slack-snapshot/src/adapters";
import { runSlackSnapshotCreate } from "../packages/slack-snapshot/src/create-agent";
import {
  decodeKeychainText,
  snapshotKeychainAccounts,
} from "../packages/slack-snapshot/src/credentials";
import {
  installSlackSnapshotLaunchd,
  slackSnapshotLaunchdStatus,
  uninstallSlackSnapshotLaunchd,
} from "../packages/slack-snapshot/src/launchd";
import { restoreSnapshot } from "../packages/slack-snapshot/src/restore";
import { runLaunchctl } from "../packages/slack-snapshot/src/runtime";
import {
  processSnapshotKeychainRunner,
  SnapshotKeychain,
} from "../packages/snapshots/src/keychain";

const slackThreadTimestampSchema = z.string().regex(/^\d+\.\d{6}$/);
const environmentSchema = z.object({
  MYNAS_SNAPSHOT_KEYCHAIN_HELPER: z.string().min(1),
  MYNAS_SNAPSHOT_RETENTION_COUNT: z.coerce.number().int().min(1).max(365),
  MYNAS_SNAPSHOT_STAGE_ROOT: z.string().min(1),
  MYNAS_SNAPSHOT_VOLUME_ID: z.string().min(1),
  MYNAS_URL: z.url(),
  SLACK_DASHBOARD_ROOT: z.string().min(1),
  SLACK_DASHBOARD_SOURCE_ROOT: z.string().min(1),
  SLACK_DOCKER_CONTEXT: z.string().min(1),
  SLACK_HERMES_QUESTION_ROOT: z.string().min(1),
  SLACK_MYSQL_CONTAINER: z.string().min(1),
  SLACK_NOTIFICATION_THREAD_TS: slackThreadTimestampSchema.optional(),
});

const home = homedir();
const loadEnvironment = (): z.infer<typeof environmentSchema> =>
  environmentSchema.parse({
    MYNAS_SNAPSHOT_KEYCHAIN_HELPER: process.env.MYNAS_SNAPSHOT_KEYCHAIN_HELPER,
    MYNAS_SNAPSHOT_RETENTION_COUNT: process.env.MYNAS_SNAPSHOT_RETENTION_COUNT ?? "14",
    MYNAS_SNAPSHOT_STAGE_ROOT:
      process.env.MYNAS_SNAPSHOT_STAGE_ROOT ??
      join(home, "Library", "Caches", "MyNAS", "slack-snapshot"),
    MYNAS_SNAPSHOT_VOLUME_ID: process.env.MYNAS_SNAPSHOT_VOLUME_ID ?? "slack-backups",
    MYNAS_URL: process.env.MYNAS_URL ?? "http://127.0.0.1:7331",
    SLACK_DASHBOARD_ROOT:
      process.env.SLACK_DASHBOARD_ROOT ??
      join(home, "Library", "Application Support", "slack-dashboard"),
    SLACK_DASHBOARD_SOURCE_ROOT:
      process.env.SLACK_DASHBOARD_SOURCE_ROOT ??
      join(home, "Documents", "workspace", "slack-dashboard"),
    SLACK_DOCKER_CONTEXT: process.env.SLACK_DOCKER_CONTEXT ?? "colima",
    SLACK_HERMES_QUESTION_ROOT:
      process.env.SLACK_HERMES_QUESTION_ROOT ??
      join(home, "Documents", "workspace", "hermes-team-shared", "questions"),
    SLACK_MYSQL_CONTAINER: process.env.SLACK_MYSQL_CONTAINER ?? "slack_dashboard_db",
    SLACK_NOTIFICATION_THREAD_TS: process.env.SLACK_NOTIFICATION_THREAD_TS,
  });

const usage = (): void => {
  process.stdout.write(
    "Usage: slack-snapshot-agent create\n" +
      "       slack-snapshot-agent restore <bundle-id> <destination>\n" +
      "       slack-snapshot-agent install|status|uninstall\n",
  );
};

const main = async (): Promise<void> => {
  const command = process.argv[2];
  if (command === "--help" || command === "-h") {
    usage();
    return;
  }
  const noArgumentCommands = ["create", "install", "status", "uninstall"];
  if (
    !(
      (command !== undefined &&
        noArgumentCommands.includes(command) &&
        process.argv.length === 3) ||
      (command === "restore" && process.argv.length === 5)
    )
  ) {
    usage();
    throw new Error("expected create or restore with exact arguments");
  }
  if (command === "install" || command === "status" || command === "uninstall") {
    const uid = process.getuid?.();
    if (uid === undefined) {
      throw new Error("launchd integration requires a numeric user id");
    }
    const base = { home, runLaunchctl, uid };
    const result =
      command === "install"
        ? await installSlackSnapshotLaunchd({
            ...base,
            agentExecutable: z.string().min(1).parse(process.env.MYNAS_SNAPSHOT_AGENT_EXECUTABLE),
            keychainHelper: z.string().min(1).parse(process.env.MYNAS_SNAPSHOT_KEYCHAIN_HELPER),
            notificationThreadTs: slackThreadTimestampSchema.parse(
              process.env.SLACK_NOTIFICATION_THREAD_TS,
            ),
          })
        : command === "status"
          ? await slackSnapshotLaunchdStatus(base)
          : await uninstallSlackSnapshotLaunchd(base);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const environment = loadEnvironment();

  const keychain = new SnapshotKeychain(
    processSnapshotKeychainRunner(environment.MYNAS_SNAPSHOT_KEYCHAIN_HELPER),
    "io.mynas.slack-snapshot",
  );
  if (command === "restore") {
    const [tokenBytes, encryptionRoot, signingPublicKey] = await Promise.all([
      keychain.get(snapshotKeychainAccounts.snapshotToken),
      keychain.get(snapshotKeychainAccounts.encryptionRoot),
      keychain.get(snapshotKeychainAccounts.signingPublicKey),
    ]);
    const destination = process.argv[4];
    if (destination === undefined) {
      throw new Error("restore destination is required");
    }
    await restoreSnapshot({
      bundleId: process.argv[3] ?? "",
      client: new HttpSnapshotDownloadClient({
        fetch,
        producerId: hostname(),
        producerKind: "slack-dashboard",
        token: decodeKeychainText(tokenBytes),
        url: environment.MYNAS_URL,
        volumeId: environment.MYNAS_SNAPSHOT_VOLUME_ID,
      }),
      destination: resolve(destination),
      encryptionRoot,
      signingPublicKey,
    });
    process.stdout.write(`${JSON.stringify({ destination: resolve(destination) })}\n`);
    return;
  }
  const result = await runSlackSnapshotCreate({
    environment: {
      ...environment,
      SLACK_NOTIFICATION_THREAD_TS: slackThreadTimestampSchema.parse(
        environment.SLACK_NOTIFICATION_THREAD_TS,
      ),
    },
    home,
    keychain,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "snapshot agent failed"}\n`);
  process.exitCode = 1;
}
