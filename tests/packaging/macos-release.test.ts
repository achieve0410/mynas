import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const root = resolve(import.meta.dir, "../..");

describe("macOS release packaging", () => {
  test("uses an Apple Silicon runner and publishes a checksummed artifact", async () => {
    const workflow = await readFile(resolve(root, ".github/workflows/release-macos.yml"), "utf8");
    expect(workflow).toContain("runs-on: macos-26");
    expect(workflow).toContain("bun run package:macos");
    expect(workflow).toContain("bun run qa:macos");
    expect(workflow).toContain("mynas-darwin-arm64.tar.gz.sha256");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("GITHUB_REF_NAME");
    expect(workflow).toContain("GH_REPO: $" + "{{ github.repository }}");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("publish:");
    expect(workflow).not.toContain("--clobber");
    for (const line of workflow.split("\n").filter((line) => line.includes("uses:"))) {
      expect(line).toMatch(/uses: [^@]+@[0-9a-f]{40}(?:\s|$)/);
    }
  });

  test("exposes the macOS package command without npm publication", async () => {
    const packageJson = z
      .object({
        private: z.literal(true),
        scripts: z.object({
          "package:macos": z.literal("bun scripts/package-macos.ts"),
        }),
      })
      .parse(JSON.parse(await readFile(resolve(root, "package.json"), "utf8")));
    expect(packageJson.private).toBe(true);
  });
});
