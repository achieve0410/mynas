import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const qaRoot = await mkdtemp(join(tmpdir(), "mynas-playwright-"));
const dataDirectory = join(qaRoot, "data");
const maintenanceDirectory = join(qaRoot, "maintenance", "백업-保管");
const webDirectory = join(qaRoot, "web");
const serverEnvironment = {
  ...process.env,
  MYNAS_BROWSER_DATA_DIR: dataDirectory,
  MYNAS_BROWSER_PORT: "0",
  MYNAS_WEB_ROOT: webDirectory,
};

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

if ((await run(["bunx", "vite", "build", "--outDir", webDirectory])) !== 0) {
  await rm(qaRoot, { force: true, recursive: true });
  throw new Error("browser web build failed");
}

const server = Bun.spawn(["bun", "tests/browser/server.ts"], {
  cwd: repositoryRoot,
  env: serverEnvironment,
  stderr: "inherit",
  stdout: "pipe",
});
let serverPort: number | undefined;
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
      const match = output.match(/"port":(\d+)/);
      if (match?.[1] === undefined) {
        rejectReady?.(new Error("browser QA readiness did not include a port"));
        return;
      }
      serverPort = Number(match[1]);
      resolveReady?.();
      resolveReady = undefined;
      rejectReady = undefined;
    }
  }
  rejectReady?.(new Error("browser QA server exited before listening"));
})();

let exitCode = 1;
try {
  await Promise.race([
    ready,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("browser QA server did not become ready")), 15_000);
    }),
  ]);
  if (serverPort === undefined) {
    throw new Error("browser QA server did not report its bound port");
  }
  exitCode = await run(["bunx", "playwright", "test"], {
    ...process.env,
    MYNAS_BROWSER_BASE_URL: `http://127.0.0.1:${serverPort}`,
    MYNAS_BROWSER_DATA_DIR: dataDirectory,
    MYNAS_BROWSER_FILES_ARTIFACT_DIR: join(qaRoot, "artifacts", "files"),
    MYNAS_BROWSER_MAINTENANCE_ARTIFACT_DIR: join(qaRoot, "artifacts", "maintenance"),
    MYNAS_BROWSER_MAINTENANCE_DIR: maintenanceDirectory,
    MYNAS_BROWSER_PHOTOS_ARTIFACT_DIR: join(qaRoot, "artifacts", "photos"),
    MYNAS_BROWSER_PLAYWRIGHT_OUTPUT: join(qaRoot, "playwright-results"),
    MYNAS_BROWSER_SERVER: "external",
  });
} finally {
  server.kill();
  await server.exited;
  await drainServerOutput;
  await rm(qaRoot, { force: true, recursive: true });
}

let listening = true;
try {
  if (serverPort !== undefined) {
    await fetch(`http://127.0.0.1:${serverPort}/api/v1/health`);
  }
} catch {
  listening = false;
}
if (listening) {
  throw new Error("browser QA server remains on port 7331");
}
if (exitCode !== 0) {
  process.exit(exitCode);
}
