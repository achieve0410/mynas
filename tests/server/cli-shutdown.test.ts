import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("mynas serve lifecycle", () => {
  let dataDir: string | undefined;
  let process: ReturnType<typeof Bun.spawn> | undefined;

  afterEach(async () => {
    if (process?.exitCode === null) {
      process.kill();
      await process.exited;
    }
    if (dataDir !== undefined) {
      await rm(dataDir, { force: true, recursive: true });
    }
  });

  test("handles SIGTERM through the owned graceful stop", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-cli-shutdown-"));
    const spawned = Bun.spawn(
      [
        "bun",
        "apps/cli/src/main.ts",
        "serve",
        "--data-dir",
        dataDir,
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ],
      { stderr: "inherit", stdout: "pipe" },
    );
    process = spawned;
    let output = "";
    let port: number | undefined;
    for await (const chunk of spawned.stdout) {
      output += new TextDecoder().decode(chunk);
      const match = output.match(/"port":(\d+).*"msg":"MyNAS listening"/);
      if (match?.[1] !== undefined) {
        port = Number(match[1]);
        break;
      }
    }
    expect(port).toBeNumber();

    process.kill("SIGTERM");
    expect(await process.exited).toBe(0);
    await expect(fetch(`http://127.0.0.1:${port}/api/v1/health`)).rejects.toBeInstanceOf(Error);
  });
});
