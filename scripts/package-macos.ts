import { readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

import { assembleMacosBundle } from "../packages/packaging/src/macos";
import { MYNAS_VERSION } from "../packages/version/src/version";

const packageSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });
const repositoryRoot = resolve(import.meta.dir, "..");
const distributionRoot = join(repositoryRoot, "dist");
const appBundlePath = join(distributionRoot, "mynas-main.js");
const snapshotAgentBundlePath = join(distributionRoot, "slack-snapshot-agent.js");
const keychainHelperPath = join(distributionRoot, "mynas-keychain-helper");
const archivePath = join(distributionRoot, "mynas-darwin-arm64.tar.gz");
const archiveInputPath = join(distributionRoot, ".mynas-archive-inputs");
const uncompressedArchivePath = join(distributionRoot, "mynas-darwin-arm64.tar");

const run = async (arguments_: readonly string[]): Promise<void> => {
  const child = Bun.spawn([...arguments_], {
    cwd: repositoryRoot,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${arguments_[0] ?? "command"} exited with ${exitCode}`);
  }
};

const prepareArchiveEntries = async (bundleRoot: string): Promise<readonly string[]> => {
  const entries: string[] = [];
  const visit = async (path: string, relativePath: string): Promise<void> => {
    entries.push(relativePath);
    const children = await readdir(path, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      if (child.isSymbolicLink()) {
        throw new Error(`macOS bundle archive refuses symlink ${join(relativePath, child.name)}`);
      }
      const childPath = join(path, child.name);
      const childRelativePath = join(relativePath, child.name);
      if (child.isDirectory()) {
        await visit(childPath, childRelativePath);
      } else {
        entries.push(childRelativePath);
      }
    }
  };
  await visit(bundleRoot, "mynas-darwin-arm64");
  const timestamp = new Date(0);
  for (const entry of entries.toReversed()) {
    await utimes(join(distributionRoot, entry), timestamp, timestamp);
  }
  return entries;
};

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("macOS packaging requires a darwin-arm64 host");
}

const { version } = packageSchema.parse(
  JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")),
);
if (version !== MYNAS_VERSION) {
  throw new Error(`package.json version ${version} does not match ${MYNAS_VERSION}`);
}
await run(["bun", "run", "build:web"]);
await run([
  "bun",
  "build",
  "--target=bun",
  "--minify",
  "--external",
  "sharp",
  "--external",
  "heic-decode",
  "--external",
  "pino",
  "apps/cli/src/main.ts",
  "--outfile",
  appBundlePath,
]);
await run([
  "bun",
  "build",
  "--target=bun",
  "--minify",
  "scripts/slack-snapshot-agent.ts",
  "--outfile",
  snapshotAgentBundlePath,
]);
await run(["swiftc", "packaging/macos/mynas-keychain-helper.swift", "-o", keychainHelperPath]);
const bundleRoot = await assembleMacosBundle({
  appBundlePath,
  bunExecutablePath: process.execPath,
  bunLicensePath: join(repositoryRoot, "packaging", "macos", "BUN-LICENSE.md"),
  dependencyRoot: join(repositoryRoot, "node_modules"),
  destinationRoot: distributionRoot,
  gplLicensePath: join(repositoryRoot, "packaging", "macos", "GPL-3.0.txt"),
  installerPath: join(repositoryRoot, "packaging", "macos", "install"),
  keychainHelperPath,
  lgplLicensePath: join(repositoryRoot, "packaging", "macos", "LGPL-3.0.txt"),
  licensePath: join(repositoryRoot, "LICENSE"),
  libvipsNoticePath: join(repositoryRoot, "packaging", "macos", "LIBVIPS-NOTICE.md"),
  readmePath: join(repositoryRoot, "README.md"),
  snapshotAgentBundlePath,
  snapshotAgentWrapperPath: join(
    repositoryRoot,
    "packaging",
    "macos",
    "bin",
    "slack-snapshot-agent",
  ),
  version,
  webRoot: join(repositoryRoot, "apps", "web", "dist"),
  wrapperPath: join(repositoryRoot, "packaging", "macos", "bin", "mynas"),
});
await rm(archivePath, { force: true });
await rm(uncompressedArchivePath, { force: true });
const archiveEntries = await prepareArchiveEntries(bundleRoot);
await writeFile(archiveInputPath, `${archiveEntries.join("\n")}\n`);
await run([
  "tar",
  "--create",
  "--file",
  uncompressedArchivePath,
  "--format",
  "ustar",
  "--uid",
  "0",
  "--gid",
  "0",
  "--uname",
  "root",
  "--gname",
  "wheel",
  "--no-recursion",
  "--directory",
  distributionRoot,
  "--files-from",
  archiveInputPath,
]);
await run(["gzip", "--no-name", "--force", uncompressedArchivePath]);
const digest = new Bun.CryptoHasher("sha256")
  .update(await Bun.file(archivePath).arrayBuffer())
  .digest("hex");
const checksumPath = `${archivePath}.sha256`;
await writeFile(checksumPath, `${digest}  ${archivePath.split("/").at(-1)}\n`);
await Promise.all([
  rm(appBundlePath, { force: true }),
  rm(snapshotAgentBundlePath, { force: true }),
  rm(keychainHelperPath, { force: true }),
  rm(archiveInputPath, { force: true }),
]);

console.log(JSON.stringify({ archivePath, bundleRoot, checksumPath, sha256: digest, version }));
