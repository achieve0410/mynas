import { readFile, writeFile } from "node:fs/promises";

import { startServer } from "../../server/src/server";
import { runCli } from "./cli";

const exitCode = await runCli(process.argv.slice(2), {
  environment: process.env,
  fetch,
  readFile: async (path) => new Uint8Array(await readFile(path)),
  serve: async (options) =>
    startServer({
      ...options,
      environment: process.env,
    }),
  stderr: (line) => process.stderr.write(line.endsWith("\n") ? line : `${line}\n`),
  stdout: (line) => process.stdout.write(line.endsWith("\n") ? line : `${line}\n`),
  writeFile: async (path, contents) => writeFile(path, contents),
});

process.exitCode = exitCode;
