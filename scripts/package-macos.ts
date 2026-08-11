import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

import { assembleMacosBundle } from "../packages/packaging/src/macos";
import { MYNAS_VERSION } from "../packages/version/src/version";

const packageSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });
const repositoryRoot = resolve(import.meta.dir, "..");
const distributionRoot = join(repositoryRoot, "dist");
const appBundlePath = join(distributionRoot, "mynas-main.js");
const archivePath = join(distributionRoot, "mynas-darwin-arm64.tar.gz");

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
  "pino",
  "apps/cli/src/main.ts",
  "--outfile",
  appBundlePath,
]);
const bundleRoot = await assembleMacosBundle({
  appBundlePath,
  bunExecutablePath: process.execPath,
  bunLicensePath: join(repositoryRoot, "packaging", "macos", "BUN-LICENSE.md"),
  dependencyRoot: join(repositoryRoot, "node_modules"),
  destinationRoot: distributionRoot,
  gplLicensePath: join(repositoryRoot, "packaging", "macos", "GPL-3.0.txt"),
  installerPath: join(repositoryRoot, "packaging", "macos", "install"),
  lgplLicensePath: join(repositoryRoot, "packaging", "macos", "LGPL-3.0.txt"),
  licensePath: join(repositoryRoot, "LICENSE"),
  libvipsNoticePath: join(repositoryRoot, "packaging", "macos", "LIBVIPS-NOTICE.md"),
  readmePath: join(repositoryRoot, "README.md"),
  version,
  webRoot: join(repositoryRoot, "apps", "web", "dist"),
  wrapperPath: join(repositoryRoot, "packaging", "macos", "bin", "mynas"),
});
await rm(archivePath, { force: true });
await run([
  "tar",
  "--create",
  "--gzip",
  "--file",
  archivePath,
  "--directory",
  distributionRoot,
  "mynas-darwin-arm64",
]);
const digest = new Bun.CryptoHasher("sha256")
  .update(await Bun.file(archivePath).arrayBuffer())
  .digest("hex");
const checksumPath = `${archivePath}.sha256`;
await writeFile(checksumPath, `${digest}  ${archivePath.split("/").at(-1)}\n`);
await rm(appBundlePath, { force: true });

console.log(JSON.stringify({ archivePath, bundleRoot, checksumPath, sha256: digest, version }));
