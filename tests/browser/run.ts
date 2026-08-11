import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const dataDirectory = "/tmp/mynas-playwright";
const maintenanceDirectory = "/tmp/mynas-playwright-maintenance";

const run = async (
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> =>
  Bun.spawn([...arguments_], {
    cwd: repositoryRoot,
    env: environment,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  }).exited;

const server = Bun.spawn(["bun", "tests/browser/server.ts"], {
  cwd: repositoryRoot,
  env: process.env,
  stderr: "inherit",
  stdout: "pipe",
});
let resolveReady: (() => void) | undefined;
let rejectReady: ((error: Error) => void) | undefined;
const ready = new Promise<void>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
const drainServerOutput = (async () => {
  let output = "";
  for await (const chunk of server.stdout) {
    process.stdout.write(chunk);
    output += new TextDecoder().decode(chunk);
    if (output.includes('"msg":"MyNAS listening"')) {
      resolveReady?.();
      resolveReady = undefined;
      rejectReady = undefined;
    }
  }
  rejectReady?.(new Error("browser QA server exited before listening"));
})();

let exitCode = 1;
try {
  if ((await run(["bun", "run", "build:web"])) !== 0) {
    throw new Error("browser web build failed");
  }
  await Promise.race([
    ready,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("browser QA server did not become ready")), 15_000);
    }),
  ]);
  exitCode = await run(["bunx", "playwright", "test"], {
    ...process.env,
    MYNAS_BROWSER_SERVER: "external",
  });
} finally {
  server.kill();
  await server.exited;
  await drainServerOutput;
  await rm(dataDirectory, { force: true, recursive: true });
  await rm(maintenanceDirectory, { force: true, recursive: true });
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
