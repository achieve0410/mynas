import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import {
  authenticateLibraryPage,
  captureLibraryScreenshot,
  createPhotoFixture,
  uploadFileFixture,
  uploadPhotoFixture,
} from "./library-ux-setup";

test("friendly file and photo workflows", async ({ page, request }) => {
  const token = await authenticateLibraryPage(page, request);
  await uploadFileFixture(request, token, "reports/report-archive.txt");
  const previewId = await uploadPhotoFixture(request, token, "친근한-friendly-preview.jpg");
  await uploadPhotoFixture(request, token, "friendly-preview.jpg");

  await page.goto("/files");
  await page.getByTestId("file-search").fill("report");
  await page.getByTestId("file-sort").selectOption("type");
  await page.getByTestId("refresh-files").click();
  await expect(page.getByTestId("file-browser")).toHaveAttribute("data-refresh-state", "complete");

  await page.getByTestId("file-upload").setInputFiles({
    buffer: Buffer.from("report body"),
    mimeType: "text/plain",
    name: "report.txt",
  });
  await page.getByRole("button", { name: "Upload 1 protected item" }).click();
  const fileUploadProgress = page.getByRole("progressbar", {
    name: "report.txt upload progress",
  });
  await expect(fileUploadProgress).toBeVisible();
  await expect(page.getByTestId("transfer-file-report.txt")).toHaveAttribute(
    "data-status",
    "complete",
  );
  await expect(fileUploadProgress).toHaveAttribute("aria-valuenow", "100");

  await page.getByRole("button", { name: "report.txt" }).click();
  const fileDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current file" }).click();
  await fileDownload;
  await expect(page.getByTestId("transfer-file-download:current:report.txt")).toHaveAttribute(
    "data-status",
    "complete",
  );
  await expect(
    page.getByRole("progressbar", { name: "report.txt download progress" }),
  ).toHaveAttribute("aria-valuenow", "100");

  const exactPathDownload = page.waitForEvent("download");
  await page
    .locator(".file-workbench")
    .getByRole("button", { exact: true, name: "Download" })
    .click();
  await exactPathDownload;
  await expect(page.getByTestId("transfer-file-download:exact:report.txt")).toHaveAttribute(
    "data-status",
    "complete",
  );

  await page.getByTestId("file-select-report.txt").check();
  const fileArchiveDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selected" }).click();
  await fileArchiveDownload;
  await expect(page.getByTestId("transfer-file-download:selected:file:report.txt")).toHaveAttribute(
    "data-status",
    "complete",
  );

  await page.goto("/photos");
  await page.getByTestId("photo-search").fill("friendly");
  await page.getByTestId("photo-sort").selectOption("type");
  await page.getByTestId("refresh-photos").click();
  await expect(page.getByTestId("photo-library")).toHaveAttribute("data-refresh-state", "complete");

  const grid = page.getByTestId("photo-grid").first();
  const densityHeights: number[] = [];
  for (const density of ["small", "medium", "large"] as const) {
    await page.getByTestId(`photo-density-${density}`).click();
    await expect(page.getByTestId(`photo-density-${density}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    densityHeights.push((await grid.boundingBox())?.height ?? 0);
  }
  expect(densityHeights[0]).toBeLessThan(densityHeights[2] ?? 0);

  await page.getByTestId("photo-upload").setInputFiles({
    buffer: await createPhotoFixture("friendly-photo.jpg"),
    mimeType: "image/jpeg",
    name: "friendly-photo.jpg",
  });
  await page.getByRole("button", { name: "Upload 1" }).click();
  const photoProgress = page.getByRole("progressbar", {
    name: "friendly-photo.jpg upload progress",
  });
  await expect(photoProgress).toBeVisible();
  await expect(page.getByTestId("transfer-photo-friendly-photo.jpg")).toHaveAttribute(
    "data-status",
    "complete",
  );
  await expect(photoProgress).toHaveAttribute("aria-valuenow", "100");
  await page.getByTestId(`photo-select-${previewId}`).check();
  const photoArchiveDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selected" }).click();
  await photoArchiveDownload;
  await expect(page.getByTestId(`transfer-photo-download:selected:${previewId}`)).toHaveAttribute(
    "data-status",
    "complete",
  );
  await captureLibraryScreenshot(page, "friendly-library-desktop.png");
});

test("folder uploads keep duplicate basenames distinct", async ({ page, request }) => {
  await authenticateLibraryPage(page, request);
  const dataDirectory = process.env.MYNAS_BROWSER_DATA_DIR ?? "/tmp/mynas-playwright";
  const fileRoot = join(dataDirectory, "duplicate-file-input");
  const photoRoot = join(dataDirectory, "duplicate-photo-input");
  await Promise.all([
    mkdir(join(fileRoot, "a"), { recursive: true }),
    mkdir(join(fileRoot, "b"), { recursive: true }),
    mkdir(join(photoRoot, "a"), { recursive: true }),
    mkdir(join(photoRoot, "b"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(fileRoot, "a", "shared.txt"), "first"),
    writeFile(join(fileRoot, "b", "shared.txt"), "second"),
    writeFile(join(photoRoot, "a", "shared.jpg"), await createPhotoFixture("a/shared.jpg")),
    writeFile(join(photoRoot, "b", "shared.jpg"), await createPhotoFixture("b/shared.jpg")),
  ]);

  await page.goto("/files");
  await page.getByLabel("Object path").fill("duplicates/");
  await page.getByTestId("file-directory-upload").setInputFiles(fileRoot);
  await page.getByRole("button", { name: "Upload 2 protected items" }).click();
  for (const path of ["duplicate-file-input/a/shared.txt", "duplicate-file-input/b/shared.txt"]) {
    await expect(page.getByTestId(`transfer-file-${path}`)).toHaveAttribute(
      "data-status",
      "complete",
    );
  }

  await page.goto("/photos");
  await page.getByTestId("photo-directory-upload").setInputFiles(photoRoot);
  await page.getByRole("button", { name: "Upload 2" }).click();
  for (const path of ["duplicate-photo-input/a/shared.jpg", "duplicate-photo-input/b/shared.jpg"]) {
    await expect(page.getByTestId(`transfer-photo-${path}`)).toHaveAttribute(
      "data-status",
      "complete",
    );
  }
});

test("photo viewer keyboard navigation and swipe", async ({ page, request }) => {
  const token = await authenticateLibraryPage(page, request);
  const firstId = await uploadPhotoFixture(request, token, "viewer-a.jpg");
  await uploadPhotoFixture(request, token, "viewer-b.jpg");

  await page.goto("/photos");
  await page.getByTestId("photo-search").fill("viewer-");
  await page.getByTestId("photo-sort").selectOption("filename");
  await page.getByTestId(`photo-${firstId}`).click();

  const dialog = page.getByRole("dialog");
  await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("photo-viewer-filename")).toHaveText("viewer-b.jpg");
  await expect(page.locator(".lightbox-image-frame")).toHaveAttribute("data-direction", "next");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("photo-viewer-filename")).toHaveText("viewer-a.jpg");
  await expect(page.locator(".lightbox-image-frame")).toHaveAttribute("data-direction", "previous");
  const originalDownload = page.waitForEvent("download");
  await page.getByTestId("download-original").click();
  await originalDownload;
  await expect(page.getByTestId(`transfer-photo-download:original:${firstId}`)).toHaveAttribute(
    "data-status",
    "complete",
  );

  const stage = page.getByTestId("photo-lightbox-stage");
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(900, box?.y ?? 400);
  await page.mouse.down();
  await page.mouse.move(300, box?.y ?? 400);
  await page.mouse.up();
  await expect(page.getByTestId("photo-viewer-filename")).toHaveText("viewer-b.jpg");
  await expect(page.getByTestId("photo-viewer-position")).toHaveText("2 / 2");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(stage.locator("img")).toHaveCSS("transition-duration", "0s");
  await expect(stage.locator(".lightbox-image-frame")).toHaveCSS("animation-duration", "0s");
  await captureLibraryScreenshot(page, "photo-viewer-desktop.png");
});

test("activity log centralizes transfer outcomes", async ({ page, request }) => {
  await authenticateLibraryPage(page, request);
  await page.goto("/photos");
  await page.getByTestId("photo-upload").setInputFiles({
    buffer: Buffer.from("not a photo"),
    mimeType: "image/jpeg",
    name: "broken-photo.jpg",
  });
  await page.getByRole("button", { name: "Upload 1" }).click();
  await expect(page.getByTestId("transfer-photo-broken-photo.jpg")).toHaveAttribute(
    "data-status",
    "failed",
  );

  await page.getByTestId("nav-activity").click();
  await expect(page).toHaveURL(/\/activity$/);
  await page.getByTestId("activity-outcome-filter").selectOption("failure");
  await page.getByTestId("activity-action-filter").selectOption("photo.upload");
  await expect(page.locator(".activity-row").first()).toContainText("Failed");
  await expect(page.getByTestId("activity-list")).toContainText("broken-photo.jpg");
  await expect(page.getByTestId("activity-list")).toHaveAttribute("data-order", "newest-first");
  await page.getByTestId("refresh-activity").click();
  await expect(page.getByTestId("activity-page")).toHaveAttribute("data-refresh-state", "complete");
  await page.reload();
  await expect(page.getByTestId("activity-list")).toContainText("broken-photo.jpg");
  await captureLibraryScreenshot(page, "activity-desktop.png");
});
