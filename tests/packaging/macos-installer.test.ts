import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installerSource = resolve(import.meta.dir, "../../packaging/macos/install");

describe("macOS installer", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("installs and atomically updates a clean HOME runtime", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-installer-"));
    const home = join(root, "Home With Spaces");
    const bundle = join(root, "bundle");
    await mkdir(join(bundle, "bin"), { recursive: true });
    await Promise.all([
      cp(installerSource, join(bundle, "install")),
      writeFile(join(bundle, "VERSION"), "0.1.0\n"),
      writeFile(join(bundle, "bin", "bun"), "synthetic bun"),
      writeFile(join(bundle, "bin", "mynas"), "#!/bin/sh\n"),
    ]);
    const runInstaller = async (): Promise<string> => {
      const child = Bun.spawn(["/bin/sh", join(bundle, "install")], {
        cwd: bundle,
        env: { ...process.env, HOME: home },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr, stdout] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);
      if (exitCode !== 0) {
        throw new Error(stderr);
      }
      return stdout;
    };

    expect(await runInstaller()).toContain("Installed MyNAS");
    const runtime = join(home, "Library/Application Support/MyNAS/runtime");
    const command = join(home, ".local/bin/mynas");
    expect(await readFile(join(runtime, "VERSION"), "utf8")).toBe("0.1.0\n");
    expect(await readlink(command)).toBe(join(runtime, "bin/mynas"));

    await writeFile(join(bundle, "VERSION"), "0.2.0\n");
    expect(await runInstaller()).toContain("Installed MyNAS");
    expect(await readFile(join(runtime, "VERSION"), "utf8")).toBe("0.2.0\n");
    expect(await stat(`${runtime}.new`).catch(() => null)).toBeNull();
    expect(await stat(`${runtime}.previous`).catch(() => null)).toBeNull();
  });

  test("refuses to overwrite an unrelated command path", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-installer-conflict-"));
    const home = join(root, "home");
    const bundle = join(root, "bundle");
    const command = join(home, ".local/bin/mynas");
    await Promise.all([
      mkdir(join(bundle, "bin"), { recursive: true }),
      mkdir(join(home, ".local/bin"), { recursive: true }),
    ]);
    await Promise.all([
      cp(installerSource, join(bundle, "install")),
      writeFile(join(bundle, "VERSION"), "0.1.0\n"),
      writeFile(join(bundle, "bin", "bun"), "synthetic bun"),
      writeFile(join(bundle, "bin", "mynas"), "#!/bin/sh\n"),
      writeFile(command, "unrelated command"),
    ]);

    const child = Bun.spawn(["/bin/sh", join(bundle, "install")], {
      env: { ...process.env, HOME: home },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("refusing to replace");
    expect(await readFile(command, "utf8")).toBe("unrelated command");
  });

  test("restores an interrupted previous runtime before rejecting an invalid package", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-installer-recovery-"));
    const home = join(root, "home");
    const bundle = join(root, "invalid-bundle");
    const runtime = join(home, "Library/Application Support/MyNAS/runtime");
    const previous = `${runtime}.previous`;
    await Promise.all([
      mkdir(bundle, { recursive: true }),
      mkdir(join(previous, "bin"), { recursive: true }),
    ]);
    await Promise.all([
      cp(installerSource, join(bundle, "install")),
      writeFile(join(previous, "VERSION"), "0.0.9\n"),
      writeFile(join(previous, "bin", "bun"), "previous bun"),
      writeFile(join(previous, "bin", "mynas"), "previous wrapper"),
    ]);

    const child = Bun.spawn(["/bin/sh", join(bundle, "install")], {
      env: { ...process.env, HOME: home },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("invalid MyNAS runtime bundle");
    expect(await readFile(join(runtime, "VERSION"), "utf8")).toBe("0.0.9\n");
    expect(await stat(previous).catch(() => null)).toBeNull();
  });
});
