import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { assembleMacosBundle, macosRuntimePackages } from "../../packages/packaging/src/macos";

describe("assembleMacosBundle", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("creates the complete darwin-arm64 runtime layout", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-macos-bundle-"));
    const sources = join(root, "sources");
    const nodeModules = join(sources, "node_modules");
    const packages = macosRuntimePackages.map((packagePath) => join(nodeModules, packagePath));
    await Promise.all(packages.map((path) => mkdir(path, { recursive: true })));
    await Promise.all(
      packages.map((path) => writeFile(join(path, "package.json"), JSON.stringify({ name: path }))),
    );
    const webRoot = join(sources, "web");
    await mkdir(webRoot);
    await writeFile(join(webRoot, "index.html"), "<main>MyNAS package</main>");
    const appBundlePath = join(sources, "main.js");
    const bunExecutablePath = join(sources, "bun");
    const bunLicensePath = join(sources, "BUN-LICENSE.md");
    const installerPath = join(sources, "install");
    const gplLicensePath = join(sources, "GPL-3.0.txt");
    const lgplLicensePath = join(sources, "LGPL-3.0.txt");
    const licensePath = join(sources, "LICENSE");
    const libvipsNoticePath = join(sources, "LIBVIPS-NOTICE.md");
    const readmePath = join(sources, "README.md");
    const wrapperPath = join(sources, "mynas");
    await Promise.all([
      writeFile(appBundlePath, "console.log('mynas')"),
      writeFile(bunExecutablePath, "synthetic bun runtime"),
      writeFile(bunLicensePath, "Bun runtime notices\n"),
      writeFile(installerPath, "#!/bin/sh\n"),
      writeFile(gplLicensePath, "GPLv3\n"),
      writeFile(lgplLicensePath, "LGPLv3\n"),
      writeFile(licensePath, "Apache License\n"),
      writeFile(libvipsNoticePath, "libvips source notice\n"),
      writeFile(readmePath, "# MyNAS\n"),
      writeFile(wrapperPath, "#!/bin/sh\n"),
    ]);

    const bundleRoot = await assembleMacosBundle({
      appBundlePath,
      bunExecutablePath,
      bunLicensePath,
      dependencyRoot: nodeModules,
      destinationRoot: join(root, "dist"),
      gplLicensePath,
      installerPath,
      lgplLicensePath,
      licensePath,
      libvipsNoticePath,
      readmePath,
      version: "0.1.0",
      webRoot,
      wrapperPath,
    });

    const entries = (await readdir(bundleRoot, { recursive: true }))
      .map((path) => relative(bundleRoot, join(bundleRoot, path)))
      .sort();
    expect(entries).toContain("bin/bun");
    expect(entries).toContain("bin/mynas");
    expect(entries).toContain("BUN-LICENSE.md");
    expect(entries).toContain("GPL-3.0.txt");
    expect(entries).toContain("install");
    expect(entries).toContain("LICENSE");
    expect(entries).toContain("LGPL-3.0.txt");
    expect(entries).toContain("LIBVIPS-NOTICE.md");
    expect(entries).toContain("README.md");
    expect(entries).toContain("lib/mynas/main.js");
    expect(entries).toContain("node_modules/sharp/package.json");
    expect(entries).toContain("node_modules/pino/package.json");
    expect(entries).toContain("node_modules/thread-stream/package.json");
    expect(entries).toContain("node_modules/@img/sharp-darwin-arm64/package.json");
    expect(entries).toContain("node_modules/@img/sharp-libvips-darwin-arm64/package.json");
    expect(entries).toContain("share/mynas/web/index.html");
    expect(await readFile(join(bundleRoot, "VERSION"), "utf8")).toBe("0.1.0\n");
    expect((await stat(join(bundleRoot, "bin/bun"))).mode & 0o777).toBe(0o755);
    expect((await stat(join(bundleRoot, "bin/mynas"))).mode & 0o777).toBe(0o755);
    expect((await stat(join(bundleRoot, "install"))).mode & 0o777).toBe(0o755);
  });
});
