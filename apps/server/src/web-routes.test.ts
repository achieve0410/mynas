import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import type { AppEnvironment } from "./types";
import { registerWebRoutes } from "./web-routes";

describe("registerWebRoutes", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("serves an explicit packaged web root and its SPA fallback", async () => {
    root = await mkdtemp(join(tmpdir(), "mynas-packaged-web-"));
    const assets = join(root, "assets");
    await mkdir(assets);
    await Promise.all([
      writeFile(join(root, "index.html"), "<main>packaged MyNAS</main>"),
      writeFile(join(assets, "app.js"), "globalThis.packaged = true"),
    ]);
    const app = new Hono<AppEnvironment>();
    registerWebRoutes(app, root);

    const index = await app.request("/");
    expect(index.status).toBe(200);
    expect(await index.text()).toBe("<main>packaged MyNAS</main>");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect(index.headers.get("content-security-policy")).toContain("font-src 'self' data:");

    const asset = await app.request("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("globalThis.packaged = true");
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const fallback = await app.request("/files");
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toBe("<main>packaged MyNAS</main>");
    expect((await app.request("/api/v1/missing")).status).toBe(404);
  });
});
