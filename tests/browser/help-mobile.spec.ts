import { expect, test } from "@playwright/test";

import {
  authenticateLibraryPage,
  captureLibraryScreenshot,
  createPhotoFixture,
  uploadFileFixture,
  uploadPhotoFixture,
} from "./library-ux-setup";

const guideTopics = [
  "overview",
  "storage",
  "files",
  "photos",
  "albums",
  "activity",
  "settings",
] as const;
const guideSections = ["purpose", "setup", "verification"] as const;

const expectNoHorizontalOverflow = async (page: Parameters<typeof authenticateLibraryPage>[0]) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
    ),
  ).toBe(true);
};

const expectTouchTargets = async (
  page: Parameters<typeof authenticateLibraryPage>[0],
  testIds: readonly string[],
) => {
  for (const testId of testIds) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box?.height ?? 0, testId).toBeGreaterThanOrEqual(44);
  }
};

test("guide explains every primary menu", async ({ page, request }) => {
  await authenticateLibraryPage(page, request);
  await page.goto("/");
  await page.getByTestId("nav-guide").click();

  for (const topic of guideTopics) {
    await page.getByTestId(`guide-topic-${topic}`).click();
    const panel = page.getByTestId(`guide-panel-${topic}`);
    await expect(panel).toHaveAttribute("data-active", "true");
    for (const section of guideSections) {
      await expect(panel.locator(`[data-section-key="${section}"]`)).toBeVisible();
    }
  }
  await captureLibraryScreenshot(page, "guide-desktop.png");
});

test("mobile library workflows remain usable", async ({ page, request }) => {
  const token = await authenticateLibraryPage(page, request);
  await uploadFileFixture(request, token, "mobile/mobile-report.txt");
  const photoId = await uploadPhotoFixture(request, token, "mobile-viewer.jpg");
  await page.setViewportSize({ height: 844, width: 390 });

  await page.goto("/files");
  await page.getByTestId("file-search").fill("mobile-report");
  await page.getByTestId("file-sort").selectOption("name");
  await page.getByTestId("refresh-files").click();
  await expectTouchTargets(page, ["file-search", "file-sort", "refresh-files"]);
  await expectNoHorizontalOverflow(page);

  await page.getByTestId("nav-photos-mobile").click();
  await page.getByTestId("photo-search").fill("mobile");
  await page.getByTestId("photo-sort").selectOption("filename");
  await page.getByTestId("refresh-photos").click();
  await expectTouchTargets(page, [
    "photo-search",
    "photo-sort",
    "refresh-photos",
    "photo-density-small",
    "photo-density-medium",
    "photo-density-large",
  ]);
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("photo-upload").setInputFiles({
    buffer: await createPhotoFixture("mobile-upload.jpg"),
    mimeType: "image/jpeg",
    name: "mobile-upload.jpg",
  });
  await page.getByRole("button", { name: "Upload 1" }).click();
  await expect(page.getByTestId("transfer-photo-mobile-upload.jpg")).toHaveAttribute(
    "data-status",
    "complete",
  );
  await page.getByTestId(`photo-${photoId}`).click();
  await page.getByTestId("photo-zoom-in").click();
  await expect(page.getByTestId("photo-zoom-value")).toHaveText("125%");

  const stage = page.getByTestId("photo-lightbox-stage");
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  const y = (box?.y ?? 200) + (box?.height ?? 200) / 2;
  const left = (box?.x ?? 0) + (box?.width ?? 390) * 0.2;
  const right = (box?.x ?? 0) + (box?.width ?? 390) * 0.8;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [{ x: left, y }],
    type: "touchStart",
  });
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [{ x: right, y }],
    type: "touchMove",
  });
  await cdp.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" });
  await expect(page.getByTestId("photo-viewer-filename")).toHaveText("mobile-upload.jpg");
  await page.getByRole("button", { name: "Close photo viewer" }).click();

  await page.getByTestId("nav-more-mobile").click();
  await page.getByTestId("nav-activity-mobile").click();
  await expect(page).toHaveURL(/\/activity$/);
  await expectTouchTargets(page, [
    "activity-outcome-filter",
    "activity-action-filter",
    "refresh-activity",
  ]);
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("nav-more-mobile").click();
  await page.getByTestId("nav-guide-mobile").click();
  await expect(page).toHaveURL(/\/guide$/);
  await expectTouchTargets(
    page,
    guideTopics.map((topic) => `guide-topic-${topic}`),
  );
  await expectNoHorizontalOverflow(page);
  await captureLibraryScreenshot(page, "library-mobile-top.png");
  const verification = page
    .getByTestId("guide-panel-overview")
    .locator('[data-section-key="verification"]');
  await verification.scrollIntoViewIfNeeded();
  await expect(verification).toBeVisible();
  const [verificationBox, mobileNavBox] = await Promise.all([
    verification.boundingBox(),
    page.getByRole("navigation", { name: "Mobile navigation" }).boundingBox(),
  ]);
  expect((verificationBox?.y ?? 0) + (verificationBox?.height ?? 0)).toBeLessThanOrEqual(
    mobileNavBox?.y ?? 0,
  );
  await captureLibraryScreenshot(page, "library-mobile.png");
});
