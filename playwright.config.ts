import { defineConfig } from "@playwright/test";

const baseURL = process.env.MYNAS_BROWSER_BASE_URL ?? "http://127.0.0.1:7331";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  outputDir:
    process.env.MYNAS_BROWSER_PLAYWRIGHT_OUTPUT ??
    ".artifacts/qa/photos/playwright-results",
  reporter: [["list"]],
  testDir: "tests/browser",
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 900, width: 1440 },
  },
  webServer:
    process.env.MYNAS_BROWSER_SERVER === "external"
      ? undefined
      : {
          command: "bun tests/browser/server.ts",
          reuseExistingServer: false,
          stderr: "pipe",
          stdout: "pipe",
          timeout: 15_000,
          url: `${baseURL}/api/v1/health`,
        },
  workers: 1,
});
