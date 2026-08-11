import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { syntheticJpeg, syntheticJpegSha256 } from "../fixtures/synthetic-photo";
import {
  ingestSchema,
  prepareOwnerAndMirror,
  revokeBrowserSession,
  syntheticJpegFilename,
  verifyHealthyRepairAvailability,
  verifyOriginalChecksum,
  verifyTokenLifecycle,
} from "./photo-setup";

const ARTIFACT_DIR =
  process.env.MYNAS_BROWSER_PHOTOS_ARTIFACT_DIR ?? ".artifacts/qa/photos";
const dataDirectory = process.env.MYNAS_BROWSER_DATA_DIR ?? "/tmp/mynas-playwright";

test("photo flagship completes the real browser journey", async ({ browser, page, request }) => {
  const token = await prepareOwnerAndMirror(request);
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);

  const documentResponse = await page.goto("/photos");
  expect(documentResponse?.status()).toBe(200);
  expect(documentResponse?.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(documentResponse?.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const uploadCompleted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/photos",
  );
  await page.getByTestId("photo-upload").setInputFiles({
    buffer: Buffer.from(syntheticJpeg()),
    mimeType: "image/jpeg",
    name: syntheticJpegFilename,
  });
  const uploadResponse = await uploadCompleted;
  expect(uploadResponse.status()).toBe(201);
  const ingest = ingestSchema.parse(await uploadResponse.json());
  expect(ingest.job.status).toBe("completed");
  expect(ingest.photo.checksum).toBe(syntheticJpegSha256());

  const photo = page.getByTestId(`photo-${ingest.photo.id}`);
  await expect(photo).toBeVisible();
  const portraitFilename = "縦向き-合成.jpg";
  const portraitUploadCompleted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/photos",
  );
  await expect(page.getByTestId("photo-upload")).toBeEnabled();
  await page.getByTestId("photo-upload").setInputFiles({
    buffer: await sharp(Buffer.from(syntheticJpeg())).rotate(90).jpeg().toBuffer(),
    mimeType: "image/jpeg",
    name: portraitFilename,
  });
  const portraitResponse = await portraitUploadCompleted;
  expect(portraitResponse.status()).toBe(201);
  const portraitIngest = ingestSchema.parse(await portraitResponse.json());
  const portraitPhoto = page.getByTestId(`photo-${portraitIngest.photo.id}`);
  await expect(portraitPhoto).toBeVisible();
  await expect(photo.getByRole("img")).toBeVisible();

  await photo.focus();
  await page.keyboard.press("Enter");
  const lightbox = page.getByRole("dialog");
  await expect(lightbox).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
  await expect(photo).toBeFocused();

  await page.getByTestId(`photo-select-${ingest.photo.id}`).check();
  await page.getByTestId("create-album").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("album-name")).toBeHidden();
  await expect(page.getByTestId("create-album")).toBeFocused();
  await page.getByTestId("create-album").click();
  await page.getByTestId("album-name").fill("Synthetic QA");
  await page.getByTestId("album-submit").click();
  await expect(page.getByTestId("album-name")).toBeHidden();
  await page.getByTestId("nav-albums").click();
  await expect(page.getByTestId("album-photo-count")).toHaveText("1");
  await expect(page.getByTestId(`album-photo-${ingest.photo.id}`)).toBeVisible();
  await page.getByTestId("nav-photos").click();
  await expect(photo).toBeVisible();

  await mkdir(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ fullPage: true, path: `${ARTIFACT_DIR}/timeline-desktop.png` });
  await page.setViewportSize({ height: 844, width: 390 });
  const hasNoHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalOverflow).toBe(true);
  await page.screenshot({ fullPage: true, path: `${ARTIFACT_DIR}/timeline-mobile.png` });
  await page.getByTestId("nav-more-mobile").click();
  await expect(page.getByRole("dialog", { name: "More navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "More navigation" })).toBeHidden();
  await expect(page.getByTestId("nav-more-mobile")).toBeFocused();
  await page.getByTestId("nav-more-mobile").click();
  await page.getByTestId("nav-settings-mobile").click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByTestId("nav-photos-mobile").click();
  await expect(photo).toBeVisible();

  await portraitPhoto.focus();
  await page.keyboard.press("Enter");
  const mobileLightbox = page.getByRole("dialog");
  await expect(mobileLightbox).toBeVisible();
  await expect(mobileLightbox.getByRole("img", { name: portraitFilename })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(mobileLightbox.getByText(syntheticJpegFilename, { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(mobileLightbox.getByText(portraitFilename, { exact: true })).toBeVisible();
  await page.screenshot({ fullPage: true, path: `${ARTIFACT_DIR}/lightbox-mobile.png` });
  await page.keyboard.press("ArrowRight");
  await expect(mobileLightbox.getByRole("img", { name: syntheticJpegFilename })).toBeVisible();
  const downloadStarted = page.waitForEvent("download");
  await page.getByTestId("download-original").click();
  const download = await downloadStarted;
  const downloadPath = await download.path();
  if (downloadPath === null) {
    throw new Error("browser did not provide a downloaded original");
  }
  const original = await readFile(downloadPath);
  const sha256 = verifyOriginalChecksum(original, syntheticJpegSha256());

  await rename(`${dataDirectory}/disk-b`, `${dataDirectory}/disk-b-offline`);
  try {
    await page.goto("/photos");
    await expect(page.getByText("Uploads paused")).toBeVisible();
    await expect(page.getByTestId("photo-upload")).toBeDisabled();
  } finally {
  await rename(`${dataDirectory}/disk-b-offline`, `${dataDirectory}/disk-b`);
  }
  await page.reload();
  await expect(page.getByTestId("photo-upload")).toBeEnabled();

  await page.setViewportSize({ height: 900, width: 1440 });
  const dashboardRoutes = [
    ["overview", "/", "dashboard-overview.png"],
    ["storage", "/storage", "dashboard-storage.png"],
    ["files", "/files", "dashboard-files.png"],
    ["photos", "/photos", "timeline-desktop.png"],
    ["albums", "/albums", "dashboard-albums.png"],
    ["settings", "/settings", "dashboard-settings.png"],
  ] as const;
  const viewports = [
    ["desktop", { height: 900, width: 1440 }],
    ["laptop", { height: 768, width: 1024 }],
    ["tablet", { height: 1024, width: 768 }],
    ["mobile", { height: 844, width: 390 }],
  ] as const;
  const routeScreenshots: string[] = [];
  for (const [viewportName, viewport] of viewports) {
    await page.setViewportSize(viewport);
    for (const [routeName, route, desktopScreenshot] of dashboardRoutes) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (routeName === "overview" || routeName === "storage") {
        await expect(page.getByText("disk-a").first()).toBeVisible();
      }
      if (routeName === "storage" && viewportName === "desktop") {
        await verifyHealthyRepairAvailability(page);
      }
      if (routeName === "albums") {
        await expect(page.getByTestId("album-photo-count")).toHaveText("1");
      }
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const screenshot =
        viewportName === "desktop"
          ? desktopScreenshot
          : routeName === "photos"
            ? `timeline-${viewportName}.png`
            : `dashboard-${routeName}-${viewportName}.png`;
      routeScreenshots.push(screenshot);
      await page.screenshot({
        fullPage: viewportName !== "mobile",
        path: `${ARTIFACT_DIR}/${screenshot}`,
      });
      if (viewportName === "mobile") {
        const lastContent = page.locator("main .page > :last-child");
        await lastContent.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const contentBox = await lastContent.boundingBox();
        const navBox = await page.locator(".mobile-nav").boundingBox();
        if (contentBox === null || navBox === null) {
          throw new Error(`could not measure mobile content for ${route}`);
        }
        expect(contentBox.y + contentBox.height).toBeLessThanOrEqual(navBox.y);
        const bottomScreenshot = screenshot.replace(".png", "-bottom.png");
        routeScreenshots.push(bottomScreenshot);
        await page.screenshot({ path: `${ARTIFACT_DIR}/${bottomScreenshot}` });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
  }
  const anonymousPage = await browser.newPage();
  const loginScreenshots: string[] = [];
  for (const [viewportName, viewport] of viewports) {
    await anonymousPage.setViewportSize(viewport);
    const loginResponse = await anonymousPage.goto("/login");
    expect(loginResponse?.status()).toBe(200);
    await expect(anonymousPage.getByRole("heading", { level: 1 })).toBeVisible();
    await anonymousPage.evaluate(() => document.fonts.ready);
    const screenshot =
      viewportName === "desktop" ? "dashboard-login.png" : `dashboard-login-${viewportName}.png`;
    loginScreenshots.push(screenshot);
    await anonymousPage.screenshot({ fullPage: true, path: `${ARTIFACT_DIR}/${screenshot}` });
  }
  await anonymousPage.close();
  await verifyTokenLifecycle(page);
  await revokeBrowserSession(page, request, token);

  await writeFile(
    `${ARTIFACT_DIR}/action-log.json`,
    `${JSON.stringify(
      {
        albumPhotoCount: 1,
        browserLogout: "revoked",
        completedAt: new Date().toISOString(),
        degradedWriteGate: "upload-disabled",
        fixture: syntheticJpegFilename,
        jobStatus: ingest.job.status,
        keyboardLightbox: "open-enter-close-escape",
        mobileViewport: { height: 844, horizontalOverflow: false, width: 390 },
        originalSha256: sha256,
        tokenLifecycle: "created-listed-revoked",
        screenshots: [
          "timeline-desktop.png",
          "timeline-mobile.png",
          "lightbox-mobile.png",
          ...routeScreenshots,
          ...loginScreenshots,
        ],
      },
      null,
      2,
    )}\n`,
  );
});
