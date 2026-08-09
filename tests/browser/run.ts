import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const dataDirectory = "/tmp/mynas-playwright";

const run = async (arguments_: readonly string[]): Promise<number> =>
  Bun.spawn([...arguments_], {
    cwd: repositoryRoot,
    env: process.env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  }).exited;

let exitCode = 1;
try {
  if ((await run(["bun", "run", "build:web"])) !== 0) {
    throw new Error("browser web build failed");
  }
  exitCode = await run(["bunx", "playwright", "test"]);
} finally {
  await rm(dataDirectory, { force: true, recursive: true });
}

let listening = true;
try {
  await fetch("http://127.0.0.1:7331/api/v1/health");
} catch {
  listening = false;
}
if (listening) {
  throw new Error("browser QA server remains on port 7331");
}
if (exitCode !== 0) {
  process.exit(exitCode);
}
