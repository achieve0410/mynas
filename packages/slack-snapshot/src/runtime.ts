import { access, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { LaunchctlRunner } from "./launchd";
import type { SlackLifecycleCommandRunner, SlackPortWaiter } from "./slack-lifecycle";

const readStderr = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  new Response(stream).text();
const commandTimeoutMilliseconds = 120_000;

export const mysqlLogicalDumpArguments = (
  container: string,
  dockerContext: string,
): readonly string[] => [
  "docker",
  "--context",
  dockerContext,
  "exec",
  container,
  "sh",
  "-lc",
  `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump \
--user=root \
--single-transaction \
--quick \
--routines \
--events \
--triggers \
--hex-blob \
--no-tablespaces \
--default-character-set=utf8mb4 \
"$MYSQL_DATABASE"`,
];

export const mysqlLogicalDump = async function* (
  container: string,
  dockerContext: string,
): AsyncIterable<Uint8Array> {
  const process = Bun.spawn([...mysqlLogicalDumpArguments(container, dockerContext)], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const stderr = readStderr(process.stderr);
  for await (const contents of process.stdout) {
    yield new Uint8Array(contents);
  }
  const exitCode = await process.exited;
  const error = (await stderr).trim();
  if (exitCode !== 0) {
    throw new Error(error || `mysqldump failed with exit code ${exitCode}`);
  }
};

const runCommand = async (arguments_: readonly string[]) => {
  const process = Bun.spawn([...arguments_], {
    stderr: "pipe",
    stdout: "pipe",
    timeout: commandTimeoutMilliseconds,
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

export class DockerContextUnavailableError extends Error {
  public override readonly name = "DockerContextUnavailableError";

  public constructor(context: string, detail: string) {
    super(`Docker context ${context} is unavailable: ${detail}`);
  }
}

export const ensureDockerContextReady = async (
  dockerContext: string,
  run: SlackLifecycleCommandRunner = runCommand,
): Promise<void> => {
  const checkArguments = ["docker", "--context", dockerContext, "info"] as const;
  const initial = await run(checkArguments);
  if (initial.exitCode === 0) {
    return;
  }
  if (dockerContext !== "colima") {
    throw new DockerContextUnavailableError(
      dockerContext,
      initial.stderr.trim() || "Docker daemon check failed",
    );
  }
  const started = await run(["colima", "start", "--activate=false"]);
  if (started.exitCode !== 0) {
    throw new DockerContextUnavailableError(
      dockerContext,
      started.stderr.trim() || `Colima start failed with ${started.exitCode}`,
    );
  }
  const ready = await run(checkArguments);
  if (ready.exitCode !== 0) {
    throw new DockerContextUnavailableError(
      dockerContext,
      ready.stderr.trim() || "Docker daemon did not become ready",
    );
  }
};

export const runLaunchctl: LaunchctlRunner = (arguments_) =>
  runCommand(["/bin/launchctl", ...arguments_]);

export const runTailscale: SlackLifecycleCommandRunner = (arguments_) =>
  runCommand(["tailscale", ...arguments_]);

export const slackLaunchdLoaded =
  (uid: number) =>
  async (label: string): Promise<boolean> =>
    (await runLaunchctl(["print", `gui/${uid}/${label}`])).exitCode === 0;

export const verifySlackPlist = (path: string): Promise<void> => access(path);

export const waitForSlackPort: SlackPortWaiter = async (port, state) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await runCommand(["/usr/bin/nc", "-z", "-w", "1", "127.0.0.1", String(port)]);
    if ((result.exitCode === 0) === (state === "open")) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Slack port ${port} did not become ${state}`);
};

export const withDirectoryLock = async <Result>(
  path: string,
  operation: () => Promise<Result>,
): Promise<Result> => {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Slack snapshot run already active");
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await rm(path, { force: true, recursive: true });
  }
};
