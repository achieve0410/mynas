import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

import {
  createFilesystemStage,
  HttpSnapshotDownloadClient,
  HttpSnapshotUploadClient,
} from "../packages/slack-snapshot/src/adapters";
import { collectSlackArchive, withQuiescedWriters } from "../packages/slack-snapshot/src/collector";
import {
  installSlackSnapshotLaunchd,
  slackSnapshotLaunchdStatus,
  uninstallSlackSnapshotLaunchd,
} from "../packages/slack-snapshot/src/launchd";
import { SlackSnapshotProducer } from "../packages/slack-snapshot/src/producer";
import { restoreSnapshot } from "../packages/slack-snapshot/src/restore";
import {
  mysqlLogicalDump,
  runLaunchctl,
  runSlackServiceCommand,
  withDirectoryLock,
} from "../packages/slack-snapshot/src/runtime";
import {
  processSnapshotKeychainRunner,
  SnapshotKeychain,
} from "../packages/snapshots/src/keychain";
import { sha256 } from "../packages/snapshots/src/manifest";

const environmentSchema = z.object({
  MYNAS_SNAPSHOT_KEYCHAIN_HELPER: z.string().min(1),
  MYNAS_SNAPSHOT_STAGE_ROOT: z.string().min(1),
  MYNAS_SNAPSHOT_VOLUME_ID: z.string().min(1),
  MYNAS_URL: z.url(),
  SLACK_DASHBOARD_ROOT: z.string().min(1),
  SLACK_DASHBOARD_SOURCE_ROOT: z.string().min(1),
  SLACK_HERMES_QUESTION_ROOT: z.string().min(1),
  SLACK_MYSQL_CONTAINER: z.string().min(1),
});

const home = homedir();
const loadEnvironment = (): z.infer<typeof environmentSchema> =>
  environmentSchema.parse({
    MYNAS_SNAPSHOT_KEYCHAIN_HELPER: process.env.MYNAS_SNAPSHOT_KEYCHAIN_HELPER,
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
    SLACK_HERMES_QUESTION_ROOT:
      process.env.SLACK_HERMES_QUESTION_ROOT ??
      join(home, "Documents", "workspace", "hermes-team-shared", "questions"),
    SLACK_MYSQL_CONTAINER: process.env.SLACK_MYSQL_CONTAINER ?? "slack_dashboard_db",
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
  const [tokenBytes, encryptionRoot, signingPublicKey] = await Promise.all([
    keychain.get("mynas:slack-dashboard"),
    keychain.get("enc:v1"),
    keychain.get("sig-public:v1"),
  ]);
  const token = new TextDecoder("utf-8", { fatal: true }).decode(tokenBytes);
  if (command === "restore") {
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
        token,
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
  const signingPrivateKey = await keychain.get("sig:v1");
  const producer = new SlackSnapshotProducer({
    client: new HttpSnapshotUploadClient({
      fetch,
      producerId: hostname(),
      producerKind: "slack-dashboard",
      token,
      url: environment.MYNAS_URL,
      volumeId: environment.MYNAS_SNAPSHOT_VOLUME_ID,
    }),
    createSnapshotId: () => crypto.getRandomValues(new Uint8Array(16)).toHex(),
    createStage: async () => createFilesystemStage(environment.MYNAS_SNAPSHOT_STAGE_ROOT),
    encryptionKeyId: "enc-v1",
    encryptionRoot,
    plaintextChunkBytes: 8 * 1_024 * 1_024,
    signingKeyId: sha256(signingPublicKey),
    signingPrivateKey,
    withLock: async (operation) =>
      withDirectoryLock(join(environment.MYNAS_SNAPSHOT_STAGE_ROOT, "active.lock"), operation),
  });
  const serviceScript = join(environment.SLACK_DASHBOARD_ROOT, "backend", "deploy", "service.sh");
  const result = await withQuiescedWriters(
    async () => runSlackServiceCommand(serviceScript, "stop"),
    async () => runSlackServiceCommand(serviceScript, "start"),
    async () =>
      producer.create(
        collectSlackArchive({
          files: [
            {
              archivePath: "secrets/mysql.env",
              path: join(
                environment.SLACK_DASHBOARD_SOURCE_ROOT,
                "db",
                "slack_dashboard_db",
                ".env",
              ),
            },
            {
              archivePath: "secrets/production.env",
              path: join(environment.SLACK_DASHBOARD_ROOT, "backend", "deploy", "production.env"),
            },
            {
              archivePath: "secrets/hermes.env",
              path: join(home, ".hermes", ".env"),
            },
            {
              archivePath: "legacy/dashboard.sqlite3",
              path: join(environment.SLACK_DASHBOARD_SOURCE_ROOT, "db", "dashboard.sqlite3"),
            },
          ],
          mysqlDump: mysqlLogicalDump(environment.SLACK_MYSQL_CONTAINER),
          roots: [
            {
              archivePrefix: "platform-artifacts",
              root: join(environment.SLACK_DASHBOARD_ROOT, "db", "platform-artifacts"),
            },
            {
              archivePrefix: "hermes-questions",
              root: environment.SLACK_HERMES_QUESTION_ROOT,
            },
            {
              archivePrefix: "secrets/platform-tokens",
              root: join(home, ".hermes", "dashboard-platform-tokens"),
            },
            {
              archivePrefix: "secrets/service",
              root: join(environment.SLACK_DASHBOARD_ROOT, "secrets"),
            },
            {
              archivePrefix: "secrets/tls",
              root: join(environment.SLACK_DASHBOARD_ROOT, "pem"),
            },
          ],
        }),
      ),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "snapshot agent failed"}\n`);
  process.exitCode = 1;
}
