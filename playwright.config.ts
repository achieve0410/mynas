import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  outputDir: ".artifacts/qa/photos/playwright-results",
  reporter: [["list"]],
  testDir: "tests/browser",
  use: {
    baseURL: "http://127.0.0.1:7331",
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
          url: "http://127.0.0.1:7331/api/v1/health",
        },
  workers: 1,
});
