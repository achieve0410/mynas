import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

import { MYNAS_VERSION } from "../packages/version/src/version";

const repositoryRoot = resolve(import.meta.dir, "..");
const bundleRoot = join(repositoryRoot, "dist", "mynas-darwin-arm64");
const archivePath = `${bundleRoot}.tar.gz`;
const packageSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });

const run = async (
  arguments_: readonly string[],
): Promise<{ readonly stderr: string; readonly stdout: string }> => {
  const child = Bun.spawn([...arguments_], { stderr: "pipe", stdout: "pipe" });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr || `${arguments_[0] ?? "command"} exited with ${exitCode}`);
  }
  return { stderr, stdout };
};

const runExpectedFailure = async (
  arguments_: readonly string[],
  input: string,
): Promise<string> => {
  const child = Bun.spawn([...arguments_], { stderr: "pipe", stdin: "pipe", stdout: "pipe" });
  child.stdin.write(input);
  child.stdin.end();
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exitCode === 0) {
    throw new Error(`${arguments_[0] ?? "command"} unexpectedly succeeded`);
  }
  return stderr;
};

const auditTree = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`release bundle contains symbolic link ${path}`);
    }
    const metadata = await lstat(path);
    if ((metadata.mode & 0o002) !== 0) {
      throw new Error(`release bundle contains world-writable path ${path}`);
    }
    if (entry.isDirectory()) {
      await auditTree(path);
    }
  }
};

const { version } = packageSchema.parse(
  JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")),
);
if (version !== MYNAS_VERSION) {
  throw new Error(`package.json version ${version} does not match ${MYNAS_VERSION}`);
}
const requiredPaths = [
  "BUN-LICENSE.md",
  "GPL-3.0.txt",
  "LGPL-3.0.txt",
  "LICENSE",
  "LIBVIPS-NOTICE.md",
  "README.md",
  "VERSION",
  "bin/bun",
  "bin/mynas",
  "bin/mynas-keychain-helper",
  "bin/slack-snapshot-agent",
  "install",
  "lib/mynas/main.js",
  "lib/mynas/slack-snapshot-agent.js",
  "node_modules/@img/sharp-libvips-darwin-arm64/README.md",
  "node_modules/@xmldom/xmldom/LICENSE",
  "node_modules/exifreader/LICENSE",
  "node_modules/exifreader/dist/exif-reader.js",
  "node_modules/pino/package.json",
  "node_modules/sharp/LICENSE",
  "share/mynas/web/index.html",
] as const;
await Promise.all(requiredPaths.map((path) => lstat(join(bundleRoot, path))));
await auditTree(bundleRoot);

const mainBundle = await readFile(join(bundleRoot, "lib", "mynas", "main.js"), "utf8");
const snapshotAgentBundle = await readFile(
  join(bundleRoot, "lib", "mynas", "slack-snapshot-agent.js"),
  "utf8",
);
const requiredSnapshotAgentContracts = [
  "MYNAS_SNAPSHOT_RETENTION_COUNT",
  "SLACK_DOCKER_CONTEXT",
  "SLACK_NOTIFICATION_THREAD_TS",
  "chat.postMessage",
  "notify:slack-bot:v1",
  "notify:slack-channel:v1",
] as const;
for (const contract of requiredSnapshotAgentContracts) {
  if (!snapshotAgentBundle.includes(contract)) {
    throw new Error(`packaged Slack snapshot agent is missing ${contract}`);
  }
}
if (
  mainBundle.includes("/" + "Users/") ||
  mainBundle.includes("/" + "home/") ||
  snapshotAgentBundle.includes("/" + "Users/") ||
  snapshotAgentBundle.includes("/" + "home/")
) {
  throw new Error("application bundle exposes an absolute build-home path");
}

const checksum = (await readFile(`${archivePath}.sha256`, "utf8")).split(/\s+/, 1)[0];
const actualChecksum = new Bun.CryptoHasher("sha256")
  .update(await Bun.file(archivePath).arrayBuffer())
  .digest("hex");
if (checksum !== actualChecksum) {
  throw new Error("macOS archive checksum mismatch");
}

const archive = await run(["tar", "--list", "--gzip", "--file", archivePath]);
for (const path of archive.stdout.trim().split("\n")) {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`unsafe archive path ${path}`);
  }
}

const versionReceipt = await run([join(bundleRoot, "bin", "mynas"), "--version"]);
if (versionReceipt.stdout.trim() !== version || versionReceipt.stderr.length !== 0) {
  throw new Error("packaged CLI version does not match package.json");
}
const snapshotHelp = await run([join(bundleRoot, "bin", "slack-snapshot-agent"), "--help"]);
if (
  !snapshotHelp.stdout.includes("slack-snapshot-agent restore") ||
  snapshotHelp.stderr.length !== 0
) {
  throw new Error("packaged Slack snapshot agent help failed");
}
const restoreAuditRoot = await mkdtemp(join(tmpdir(), "mynas-snapshot-restore-audit-"));
try {
  const fakeHelper = join(restoreAuditRoot, "fake-keychain-helper");
  const helperCalled = join(restoreAuditRoot, "helper-called");
  await writeFile(
    fakeHelper,
    `#!/bin/sh
: > ${JSON.stringify(helperCalled)}
printf '%s\\n' '{"value":"${Buffer.alloc(32, 1).toString("base64")}"}'
`,
    { mode: 0o700 },
  );
  const restoreFailure = await runExpectedFailure(
    [
      "/usr/bin/env",
      `MYNAS_SNAPSHOT_KEYCHAIN_HELPER=${fakeHelper}`,
      "MYNAS_URL=http://127.0.0.1:1",
      join(bundleRoot, "bin", "bun"),
      join(bundleRoot, "lib", "mynas", "slack-snapshot-agent.js"),
      "restore",
      "00000000-0000-4000-8000-000000000001",
      join(restoreAuditRoot, "restore"),
    ],
    "",
  );
  if (!(await Bun.file(helperCalled).exists())) {
    throw new Error(`packaged restore failed before Keychain access: ${restoreFailure}`);
  }
} finally {
  await rm(restoreAuditRoot, { force: true, recursive: true });
}
await run(["codesign", "--verify", "--strict", join(bundleRoot, "bin", "bun")]);
const keychainHelper = join(bundleRoot, "bin", "mynas-keychain-helper");
await run(["codesign", "--verify", "--strict", keychainHelper]);
const keychainProtocol = await runExpectedFailure(
  [keychainHelper],
  JSON.stringify({
    account: "protocol-check",
    operation: "protocol-check",
    service: "io.mynas.slack-snapshot.audit",
  }),
);
if (!keychainProtocol.includes("unsupported operation")) {
  throw new Error("packaged Keychain helper protocol does not match the snapshot client");
}

console.log(
  JSON.stringify({
    archiveSha256: actualChecksum,
    packageVersion: version,
    requiredPaths: requiredPaths.length,
  }),
);
console.log("MACOS_ARTIFACT_AUDIT_PASS=1");
