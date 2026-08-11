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
  serve: async (options) =>
    startServer({
      ...options,
      environment: process.env,
    }),
  stderr: (line) => process.stderr.write(line.endsWith("\n") ? line : `${line}\n`),
  stdout: (line) => process.stdout.write(line.endsWith("\n") ? line : `${line}\n`),
  restoreCatalog,
  writeFile: async (path, contents) => writeFile(path, contents),
});

process.exitCode = exitCode;
