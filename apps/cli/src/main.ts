import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

import { backupCatalog, restoreCatalog } from "../../../packages/database/src/catalog-backup";
import { bootstrapLocal } from "../../../packages/onboarding/src/bootstrap";
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
  readFile: async (path) => new Uint8Array(await readFile(path)),
  readStdin: () => Bun.stdin.text(),
  serve: async (options) => {
    const running = await startServer({
      ...options,
      environment: process.env,
    });
    await new Promise<void>((resolve, reject) => {
      let stopping = false;
      const shutdown = (): void => {
        if (stopping) {
          return;
        }
        stopping = true;
        void running.stop().then(
          () => {
            process.off("SIGINT", shutdown);
            process.off("SIGTERM", shutdown);
            resolve();
          },
          (error: unknown) => {
            process.off("SIGINT", shutdown);
            process.off("SIGTERM", shutdown);
            reject(error);
          },
        );
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
  },
  serviceStatus: () => launchdService().status(),
  stderr: (line) => process.stderr.write(line.endsWith("\n") ? line : `${line}\n`),
  stdout: (line) => process.stdout.write(line.endsWith("\n") ? line : `${line}\n`),
  uninstallService: () => launchdService().uninstall(),
  restoreCatalog,
  writeFile: async (path, contents) => writeFile(path, contents),
});

process.exitCode = exitCode;
