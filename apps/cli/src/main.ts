import { readFile, writeFile } from "node:fs/promises";

import { backupCatalog, restoreCatalog } from "../../../packages/database/src/catalog-backup";
import { startServer } from "../../server/src/server";
import { runCli } from "./cli";

const exitCode = await runCli(process.argv.slice(2), {
  backupCatalog,
  environment: process.env,
  fetch,
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
  stderr: (line) => process.stderr.write(line.endsWith("\n") ? line : `${line}\n`),
  stdout: (line) => process.stdout.write(line.endsWith("\n") ? line : `${line}\n`),
  restoreCatalog,
  writeFile: async (path, contents) => writeFile(path, contents),
});

process.exitCode = exitCode;
