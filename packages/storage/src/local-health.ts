import type { BackendHealth } from "./adapter";

type ProbeProcess = {
  readonly exited: Promise<number>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  kill(): void;
};

type ProbeOptions = {
  readonly signal?: AbortSignal;
  readonly spawn?: (arguments_: readonly string[]) => ProbeProcess;
};

type CommandResult =
  | { readonly status: "aborted" }
  | { readonly exitCode: number; readonly stderr: string; readonly stdout: string };

export type LocalRootInspection =
  | {
      readonly availableBytes: number;
      readonly canonicalRoot: string;
      readonly capacityBytes: number;
      readonly filesystemIdentity: string;
      readonly status: "healthy";
    }
  | {
      readonly reason: string;
      readonly status: "unavailable";
    };

const defaultSpawn = (arguments_: readonly string[]): ProbeProcess =>
  Bun.spawn([...arguments_], { stderr: "pipe", stdout: "pipe" });

const runCommand = async (
  arguments_: readonly string[],
  signal: AbortSignal,
  spawn: (arguments_: readonly string[]) => ProbeProcess,
): Promise<CommandResult> => {
  const child = spawn(arguments_);
  if (signal.aborted) {
    child.kill();
    return { status: "aborted" };
  }

  const outcome = await new Promise<number | "aborted">((resolve) => {
    const abort = () => {
      child.kill();
      resolve("aborted");
    };
    signal.addEventListener("abort", abort, { once: true });
    void child.exited.then((exitCode) => {
      signal.removeEventListener("abort", abort);
      resolve(exitCode);
    });
  });
  if (outcome === "aborted") {
    return { status: "aborted" };
  }
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode: outcome, stderr: stderr.trim(), stdout: stdout.trim() };
};

const commandAborted = (
  result: CommandResult,
): result is Extract<CommandResult, { status: "aborted" }> => "status" in result;

export const inspectLocalRoot = async (
  root: string,
  options: ProbeOptions = {},
): Promise<LocalRootInspection> => {
  const signal = options.signal ?? AbortSignal.timeout(4_000);
  const spawn = options.spawn ?? defaultSpawn;
  const metadataArguments =
    process.platform === "darwin"
      ? ["/usr/bin/stat", "-f", "%d|%i|%HT", root]
      : ["/usr/bin/stat", "-c", "%d|%i|%F", root];
  const [canonical, metadata, capacity, readable] = await Promise.all([
    runCommand(["/bin/realpath", root], signal, spawn),
    runCommand(metadataArguments, signal, spawn),
    runCommand(["/bin/df", "-Pk", root], signal, spawn),
    runCommand(["/bin/ls", "-A", root], signal, spawn),
  ]);

  if (
    commandAborted(canonical) ||
    commandAborted(metadata) ||
    commandAborted(capacity) ||
    commandAborted(readable)
  ) {
    return {
      reason: "backend probe timed out; check macOS removable-volume access",
      status: "unavailable",
    };
  }
  const results = [canonical, metadata, capacity, readable];
  if (results.some((result) => result.exitCode !== 0)) {
    const detail = results
      .filter((result) => result.exitCode !== 0)
      .map((result) => result.stderr)
      .find((message) => message.length > 0);
    return {
      reason: detail ?? "backend root is unavailable",
      status: "unavailable",
    };
  }

  const [device, inode, type] = metadata.stdout.split("|");
  if (type === "Symbolic Link" || type === "symbolic link") {
    return { reason: "backend root cannot be a symlink", status: "unavailable" };
  }
  if (
    (type !== "Directory" && type !== "directory") ||
    device === undefined ||
    inode === undefined
  ) {
    return { reason: "backend root is not a directory", status: "unavailable" };
  }
  const fields = capacity.stdout.trim().split(/\s+/);
  const blocks = Number(fields.at(-5));
  const available = Number(fields.at(-3));
  if (!Number.isSafeInteger(blocks) || !Number.isSafeInteger(available)) {
    return { reason: "backend capacity probe returned invalid data", status: "unavailable" };
  }
  const markerPath = `${canonical.stdout}/.mynas-storage-id`;
  const markerMetadata = await runCommand(
    process.platform === "darwin"
      ? ["/usr/bin/stat", "-f", "%HT", markerPath]
      : ["/usr/bin/stat", "-Lc", "%F", markerPath],
    signal,
    spawn,
  );
  if (commandAborted(markerMetadata)) {
    return {
      reason: "backend probe timed out; check macOS removable-volume access",
      status: "unavailable",
    };
  }
  const marker =
    markerMetadata.exitCode === 0
      ? await runCommand(["/bin/cat", markerPath], signal, spawn)
      : null;
  if (marker !== null && commandAborted(marker)) {
    return {
      reason: "backend probe timed out; check macOS removable-volume access",
      status: "unavailable",
    };
  }
  const markerId = marker?.stdout.match(/^[0-9a-f-]{36}$/i)?.[0];
  return {
    availableBytes: available * 1_024,
    canonicalRoot: canonical.stdout,
    capacityBytes: blocks * 1_024,
    filesystemIdentity:
      markerId === undefined ? `${device}:${inode}` : `marker:${markerId.toLowerCase()}`,
    status: "healthy",
  };
};

export const localBackendHealth = (
  inspection: Extract<LocalRootInspection, { status: "healthy" }>,
): BackendHealth => ({
  availableBytes: inspection.availableBytes,
  capacityBytes: inspection.capacityBytes,
  filesystemIdentity: inspection.filesystemIdentity,
  status: "healthy",
});
