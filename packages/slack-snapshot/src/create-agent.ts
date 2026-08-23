import { hostname } from "node:os";
import { join } from "node:path";

import type { SnapshotKeychain } from "../../snapshots/src/keychain";
import { sha256 } from "../../snapshots/src/manifest";
import { createFilesystemStage, HttpSnapshotUploadClient } from "./adapters";
import { collectSlackArchive, withQuiescedWriters } from "./collector";
import { decodeKeychainText, snapshotKeychainAccounts } from "./credentials";
import { SlackWebApiNotifier } from "./notifications";
import { SlackSnapshotProducer } from "./producer";
import { SnapshotRetentionPolicy } from "./retention";
import {
  ensureDockerContextReady,
  mysqlLogicalDump,
  runLaunchctl,
  runTailscale,
  slackLaunchdLoaded,
  verifySlackPlist,
  waitForSlackPort,
  withDirectoryLock,
} from "./runtime";
import { SlackDashboardLifecycle } from "./slack-lifecycle";
import { runSnapshotWorkflow, type SnapshotWorkflowResult } from "./workflow";

export type SlackSnapshotCreateEnvironment = {
  readonly MYNAS_SNAPSHOT_RETENTION_COUNT: number;
  readonly MYNAS_SNAPSHOT_STAGE_ROOT: string;
  readonly MYNAS_SNAPSHOT_VOLUME_ID: string;
  readonly MYNAS_URL: string;
  readonly SLACK_DASHBOARD_ROOT: string;
  readonly SLACK_DASHBOARD_SOURCE_ROOT: string;
  readonly SLACK_DOCKER_CONTEXT: string;
  readonly SLACK_HERMES_QUESTION_ROOT: string;
  readonly SLACK_MYSQL_CONTAINER: string;
  readonly SLACK_NOTIFICATION_THREAD_TS: string;
};

type SlackSnapshotCreateOptions = {
  readonly environment: SlackSnapshotCreateEnvironment;
  readonly home: string;
  readonly keychain: SnapshotKeychain;
};

export const runSlackSnapshotCreate = async (
  options: SlackSnapshotCreateOptions,
): Promise<SnapshotWorkflowResult> => {
  const { environment, home, keychain } = options;
  const [slackTokenBytes, slackChannelBytes] = await Promise.all([
    keychain.get(snapshotKeychainAccounts.slackToken),
    keychain.get(snapshotKeychainAccounts.slackChannel),
  ]);
  const notifier = new SlackWebApiNotifier({
    channel: decodeKeychainText(slackChannelBytes),
    fetch,
    threadTs: environment.SLACK_NOTIFICATION_THREAD_TS,
    token: decodeKeychainText(slackTokenBytes),
  });
  return runSnapshotWorkflow({
    create: async ({ lifecycle, producer }) =>
      withQuiescedWriters(
        async () => lifecycle.stop(),
        async () => lifecycle.start(),
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
                  path: join(
                    environment.SLACK_DASHBOARD_ROOT,
                    "backend",
                    "deploy",
                    "production.env",
                  ),
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
              mysqlDump: mysqlLogicalDump(
                environment.SLACK_MYSQL_CONTAINER,
                environment.SLACK_DOCKER_CONTEXT,
              ),
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
      ),
    notifier,
    prepare: async () => {
      await ensureDockerContextReady(environment.SLACK_DOCKER_CONTEXT);
      const [tokenBytes, encryptionRoot, signingPublicKey, signingPrivateKey] = await Promise.all([
        keychain.get(snapshotKeychainAccounts.snapshotToken),
        keychain.get(snapshotKeychainAccounts.encryptionRoot),
        keychain.get(snapshotKeychainAccounts.signingPublicKey),
        keychain.get(snapshotKeychainAccounts.signingPrivateKey),
      ]);
      const client = new HttpSnapshotUploadClient({
        fetch,
        producerId: hostname(),
        producerKind: "slack-dashboard",
        token: decodeKeychainText(tokenBytes),
        url: environment.MYNAS_URL,
        volumeId: environment.MYNAS_SNAPSHOT_VOLUME_ID,
      });
      const producer = new SlackSnapshotProducer({
        client,
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
      const uid = process.getuid?.();
      if (uid === undefined) {
        throw new Error("Slack launchd lifecycle requires a numeric user id");
      }
      return {
        client,
        lifecycle: new SlackDashboardLifecycle({
          home,
          isLoaded: slackLaunchdLoaded(uid),
          runLaunchctl,
          runTailscale,
          uid,
          verifyPlist: verifySlackPlist,
          waitForPort: waitForSlackPort,
        }),
        producer,
      };
    },
    retain: async ({ client }) =>
      new SnapshotRetentionPolicy({
        client,
        keepCount: environment.MYNAS_SNAPSHOT_RETENTION_COUNT,
        producerKind: "slack-dashboard",
        volumeId: environment.MYNAS_SNAPSHOT_VOLUME_ID,
      }).apply(),
  });
};
