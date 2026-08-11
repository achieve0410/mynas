import { lstat, readdir, readFile } from "node:fs/promises";
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
  "install",
  "lib/mynas/main.js",
  "node_modules/@img/sharp-libvips-darwin-arm64/README.md",
  "node_modules/pino/package.json",
  "node_modules/sharp/LICENSE",
  "share/mynas/web/index.html",
] as const;
await Promise.all(requiredPaths.map((path) => lstat(join(bundleRoot, path))));
await auditTree(bundleRoot);

const mainBundle = await readFile(join(bundleRoot, "lib", "mynas", "main.js"), "utf8");
if (mainBundle.includes("/" + "Users/") || mainBundle.includes("/" + "home/")) {
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
await run(["codesign", "--verify", "--strict", join(bundleRoot, "bin", "bun")]);

console.log(
  JSON.stringify({
    archiveSha256: actualChecksum,
    packageVersion: version,
    requiredPaths: requiredPaths.length,
  }),
);
console.log("MACOS_ARTIFACT_AUDIT_PASS=1");
