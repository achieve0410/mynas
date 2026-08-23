import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

import { backupCatalog } from "../../../packages/database/src/catalog-backup";
import { bootstrapLocal } from "../../../packages/onboarding/src/bootstrap";
import { restoreCatalogWithOwner } from "../../../packages/onboarding/src/catalog-restore";
import { startServer } from "../../server/src/server";
import { runCli } from "./cli";
import { LaunchdServiceManager } from "./service";

let launchd: LaunchdServiceManager | undefined;
const launchdService = (): LaunchdServiceManager => {
  if (process.platform !== "darwin") {
    throw new Error("service management is available only on macOS");
  }
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error("could not determine the macOS user ID");
  }
  launchd ??= new LaunchdServiceManager({
    homeDir: process.env.HOME ?? homedir(),
    programArguments:
      process.env.MYNAS_EXECUTABLE === undefined
        ? [process.execPath, Bun.main]
        : [process.env.MYNAS_EXECUTABLE],
    runLaunchctl: async (arguments_) => {
      const child = Bun.spawn(["/bin/launchctl", ...arguments_], {
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr, stdout] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);
      return { exitCode, stderr, stdout };
    },
    uid,
  });
  return launchd;
};

const exitCode = await runCli(process.argv.slice(2), {
  backupCatalog,
  bootstrapLocal: (options) => bootstrapLocal({ ...options, environment: process.env }),
  environment: process.env,
  fetch,
  installService: (options) => launchdService().install(options),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readFile: async (path) => new Uint8Array(await readFile(path)),
  readStdin: () => Bun.stdin.text(),
  remove: async (path) => rm(path, { force: true, recursive: true }),
  rename,
  serve: async (options) => {
    let running: Awaited<ReturnType<typeof startServer>> | undefined;
    let stopping = false;
    let resolveStopped: (() => void) | undefined;
    let rejectStopped: ((error: unknown) => void) | undefined;
    const stopped = new Promise<void>((resolve, reject) => {
      resolveStopped = resolve;
      rejectStopped = reject;
    });
    const stopRunningServer = (): void => {
      if (running === undefined) {
        return;
      }
      void running.stop().then(resolveStopped, rejectStopped);
    };
    const shutdown = (): void => {
      if (stopping) {
        return;
      }
      stopping = true;
      stopRunningServer();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    try {
      running = await startServer({
        ...options,
        environment: process.env,
      });
      if (stopping) {
        stopRunningServer();
      }
      await stopped;
    } finally {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    }
  },
  serviceStatus: () => launchdService().status(),
  stderr: (line) => process.stderr.write(line.endsWith("\n") ? line : `${line}\n`),
  stdout: (line) => process.stdout.write(line.endsWith("\n") ? line : `${line}\n`),
  uninstallService: () => launchdService().uninstall(),
  restoreCatalog: restoreCatalogWithOwner,
  writeFile: async (path, contents) => writeFile(path, contents),
});

process.exitCode = exitCode;
