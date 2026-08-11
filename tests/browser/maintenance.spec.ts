import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { prepareOwnerAndMirror } from "./photo-setup";

const artifactDirectory =
  process.env.MYNAS_BROWSER_MAINTENANCE_ARTIFACT_DIR ??
  ".artifacts/qa/maintenance";
const backupDirectory =
  process.env.MYNAS_BROWSER_MAINTENANCE_DIR ??
  "/tmp/mynas-playwright-maintenance/백업-保管";

test("settings configures and runs observable maintenance", async ({ page, request }) => {
  const token = await prepareOwnerAndMirror(request);
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/settings");

  const enabled = page.getByLabel("Enable automatic maintenance");
  const directory = page.getByLabel("Backup directory");
  const backupInterval = page.getByLabel("Backup interval hours");
  await enabled.focus();
  await expect(enabled).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(directory).toBeFocused();
  expect(
    await directory.evaluate((element) => {
      const navigation = document.querySelector<HTMLElement>(".mobile-nav");
      return (
        navigation !== null &&
        element.getBoundingClientRect().bottom <= navigation.getBoundingClientRect().top
      );
    }),
  ).toBe(true);
  await enabled.check();
  await directory.fill(backupDirectory);
  await backupInterval.fill("24");
  await page.getByLabel("Scrub interval hours").fill("168");
  await page.getByLabel("Backups to keep").fill("2");

  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/api/v1/maintenance/policy",
  );
  await page.getByRole("button", { name: "Save maintenance policy" }).click();
  expect((await saved).status()).toBe(200);

  const completed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/maintenance/run",
  );
  await page.getByRole("button", { name: "Run maintenance now" }).click();
  expect((await completed).status()).toBe(201);

  const history = page.getByRole("region", { name: "Maintenance history" });
  await expect(history.locator('[data-status="completed"]')).toHaveCount(2);
  await expect(directory).toHaveValue(backupDirectory);

  await mkdir(artifactDirectory, { recursive: true });
  for (const viewport of [
    { height: 900, name: "desktop", width: 1_440 },
    { height: 768, name: "compact", width: 1_024 },
    { height: 1_024, name: "tablet", width: 768 },
    { height: 844, name: "mobile", width: 390 },
  ]) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      window.scrollTo({ top: 0 });
    });
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (viewport.width === 390) {
      expect(
        await page
          .getByRole("button", { name: /maintenance (policy|now)/ })
          .evaluateAll((buttons) =>
            buttons.every((button) => button.getBoundingClientRect().height >= 44),
          ),
      ).toBe(true);
    }
    await page.screenshot({
      fullPage: true,
      path: `${artifactDirectory}/maintenance-${viewport.name}.png`,
    });
  }

  await backupInterval.fill("48");
  await expect(page.getByText("Maintenance policy saved.")).toHaveCount(0);
  const rerun = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/maintenance/run",
  );
  await page.getByRole("button", { name: "Run maintenance now" }).click();
  expect((await rerun).status()).toBe(201);
  await expect(backupInterval).toHaveValue("48");
});
