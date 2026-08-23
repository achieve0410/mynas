import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

const readStderr = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  new Response(stream).text();

export const mysqlLogicalDump = async function* (container: string): AsyncIterable<Uint8Array> {
  const process = Bun.spawn(
    [
      "docker",
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
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
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

export const runSlackServiceCommand = async (
  script: string,
  command: "start" | "stop",
): Promise<void> => {
  const process = Bun.spawn([script, command], {
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`Slack service ${command} failed with exit code ${exitCode}`);
  }
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
