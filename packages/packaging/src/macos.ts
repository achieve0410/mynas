import { chmod, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const macosRuntimePackages = [
  "sharp",
  "detect-libc",
  "semver",
  "@img/colour",
  "@img/sharp-darwin-arm64",
  "@img/sharp-libvips-darwin-arm64",
  "pino",
  "atomic-sleep",
  "on-exit-leak-free",
  "pino-abstract-transport",
  "pino-std-serializers",
  "process-warning",
  "quick-format-unescaped",
  "real-require",
  "safe-stable-stringify",
  "@pinojs/redact",
  "sonic-boom",
  "thread-stream",
  "split2",
] as const;

export type AssembleMacosBundleOptions = {
  readonly appBundlePath: string;
  readonly bunExecutablePath: string;
  readonly bunLicensePath: string;
  readonly dependencyRoot: string;
  readonly destinationRoot: string;
  readonly gplLicensePath: string;
  readonly installerPath: string;
  readonly lgplLicensePath: string;
  readonly licensePath: string;
  readonly libvipsNoticePath: string;
  readonly readmePath: string;
  readonly version: string;
  readonly webRoot: string;
  readonly wrapperPath: string;
};

const normalizeModes = async (directory: string): Promise<void> => {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`runtime bundle cannot contain symbolic link ${path}`);
      }
      if (entry.isDirectory()) {
        await chmod(path, 0o755);
        await normalizeModes(path);
        return;
      }
      await chmod(path, 0o644);
    }),
  );
};

export const assembleMacosBundle = async (options: AssembleMacosBundleOptions): Promise<string> => {
  const bundleRoot = join(options.destinationRoot, "mynas-darwin-arm64");
  await rm(bundleRoot, { force: true, recursive: true });
  await Promise.all([
    mkdir(join(bundleRoot, "bin"), { recursive: true }),
    mkdir(join(bundleRoot, "lib", "mynas"), { recursive: true }),
    mkdir(join(bundleRoot, "node_modules", "@img"), { recursive: true }),
    mkdir(join(bundleRoot, "share", "mynas"), { recursive: true }),
  ]);
  await Promise.all([
    cp(options.appBundlePath, join(bundleRoot, "lib", "mynas", "main.js")),
    cp(options.bunExecutablePath, join(bundleRoot, "bin", "bun")),
    cp(options.bunLicensePath, join(bundleRoot, "BUN-LICENSE.md")),
    cp(options.gplLicensePath, join(bundleRoot, "GPL-3.0.txt")),
    cp(options.installerPath, join(bundleRoot, "install")),
    cp(options.lgplLicensePath, join(bundleRoot, "LGPL-3.0.txt")),
    cp(options.licensePath, join(bundleRoot, "LICENSE")),
    cp(options.libvipsNoticePath, join(bundleRoot, "LIBVIPS-NOTICE.md")),
    cp(options.readmePath, join(bundleRoot, "README.md")),
    cp(options.wrapperPath, join(bundleRoot, "bin", "mynas")),
    cp(options.webRoot, join(bundleRoot, "share", "mynas", "web"), { recursive: true }),
    ...macosRuntimePackages.map((packagePath) =>
      cp(join(options.dependencyRoot, packagePath), join(bundleRoot, "node_modules", packagePath), {
        recursive: true,
      }),
    ),
  ]);
  await writeFile(join(bundleRoot, "VERSION"), `${options.version}\n`);
  await normalizeModes(bundleRoot);
  await Promise.all(
    ["bin/bun", "bin/mynas", "install"].map((path) => chmod(join(bundleRoot, path), 0o755)),
  );
  return bundleRoot;
};
