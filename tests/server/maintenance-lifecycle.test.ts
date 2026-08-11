import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type StartedServer, startServer } from "../../apps/server/src/server";

describe("maintenance server lifecycle", () => {
  let dataDir: string | undefined;
  let running: StartedServer | undefined;

  afterEach(async () => {
    await running?.stop();
    if (dataDir !== undefined) {
      await rm(dataDir, { force: true, recursive: true });
    }
  });

  test("returns an idempotent owner that closes HTTP and maintenance resources", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mynas-maintenance-lifecycle-"));
    running = await startServer({
      dataDir,
      environment: {},
      host: "127.0.0.1",
      port: 0,
    });
    const base = `http://127.0.0.1:${running.port}`;
    expect((await fetch(`${base}/api/v1/health`)).status).toBe(200);

    const firstStop = running.stop();
    const concurrentStop = running.stop();
    expect(concurrentStop).toBe(firstStop);
    await Promise.all([firstStop, concurrentStop]);
    await running.stop();
    await expect(fetch(`${base}/api/v1/health`)).rejects.toBeInstanceOf(Error);
  });
});
