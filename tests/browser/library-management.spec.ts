import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { z } from "zod";

import { syntheticJpeg } from "../fixtures/synthetic-photo";
import { ingestSchema, prepareOwnerAndMirror } from "./photo-setup";

const albumSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  photos: z.array(z.object({ id: z.string().uuid() }).passthrough()),
});
const evidenceDirectory = process.env.MYNAS_MANAGEMENT_EVIDENCE_DIR;

const authorize = (token: string): Readonly<Record<string, string>> => ({
  authorization: `Bearer ${token}`,
});

const authenticatePage = async (page: Page, token: string): Promise<void> => {
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);
  await page.setViewportSize({ height: 844, width: 390 });
};

const uploadPhoto = async (page: Page, token: string, contents: Buffer, filename: string) => {
  const response = await page.request.post("/api/v1/photos", {
    data: contents,
    headers: {
      ...authorize(token),
      "content-type": "image/jpeg",
      "x-mynas-filename": encodeURIComponent(filename),
    },
  });
  expect(response.status()).toBe(201);
  return ingestSchema.parse(await response.json()).photo;
};

const capture = async (page: Page, filename: string): Promise<void> => {
  if (evidenceDirectory === undefined) {
    return;
  }
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ fullPage: true, path: join(evidenceDirectory, filename) });
};

const expectTouchTarget = async (locator: Locator): Promise<void> => {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
};

const contrastRatio = (foreground: readonly number[], background: readonly number[]): number => {
  const luminance = (color: readonly number[]): number => {
    const [red = 0, green = 0, blue = 0] = color.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
};

const expectGuidanceContrast = async (locator: Locator): Promise<void> => {
  const colors = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color };
  });
  const parse = (value: string): readonly number[] =>
    [...value.matchAll(/\d+(?:\.\d+)?/g)].slice(0, 3).map((match) => Number(match[0]));
  expect(contrastRatio(parse(colors.foreground), parse(colors.background))).toBeGreaterThanOrEqual(
    4.5,
  );
};

test("album creation, rename, and deletion preserve protected photos", async ({ page }) => {
  const token = await prepareOwnerAndMirror(page.request);
  const preservedFilename = "삭제해도-보존되는-사진.jpg";
  const preserved = await uploadPhoto(
    page,
    token,
    await sharp(Buffer.from(syntheticJpeg())).resize(31, 19).jpeg().toBuffer(),
    preservedFilename,
  );
  await authenticatePage(page, token);
  await page.goto("/albums");

  const createdResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/albums",
  );
  await page.getByRole("button", { name: "Create album" }).click();
  await page.getByTestId("album-name").fill("수정 전 앨범");
  await page.getByTestId("album-submit").click();
  const album = albumSchema.parse(await (await createdResponse).json());
  await page.getByTestId(`album-open-${album.id}`).click();
  await page.getByTestId("album-add-existing").click();
  await page.getByTestId("album-existing-search").fill(preservedFilename);
  await page.getByTestId(`album-existing-select-${preserved.id}`).check();
  await page.getByTestId("album-existing-submit").click();
  await expect(page.getByTestId("album-detail-photo-count")).toHaveText("1");
  await expect(page.getByTestId(`album-detail-photo-${preserved.id}`)).toBeVisible();

  await page.getByTestId("album-manage").click();
  await expect(page.getByTestId("album-settings-dialog")).toBeVisible();
  await expectTouchTarget(page.getByTestId("album-delete-start"));
  await expectGuidanceContrast(page.getByTestId("album-delete-start"));
  await capture(page, "mobile-album-settings.png");
  await page.getByTestId("album-edit-name").fill("수정된 가족 앨범");
  const renamedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `/api/v1/albums/${album.id}`,
  );
  await page.getByTestId("album-rename-submit").click();
  expect((await renamedResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "수정된 가족 앨범" })).toBeVisible();

  await page.getByTestId("album-manage").click();
  await page.getByTestId("album-delete-start").click();
  await expect(page.getByText("Protected photos will stay in your library.")).toBeVisible();
  await expectGuidanceContrast(page.getByTestId("album-delete-confirm"));
  await page.setViewportSize({ height: 900, width: 1440 });
  await capture(page, "desktop-album-delete.png");
  await page.setViewportSize({ height: 844, width: 390 });
  await capture(page, "mobile-album-delete.png");
  const deletedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === `/api/v1/albums/${album.id}`,
  );
  await page.getByTestId("album-delete-confirm").click();
  expect((await deletedResponse).status()).toBe(204);
  await expect(page.getByRole("heading", { level: 1, name: "Albums" })).toBeVisible();
  await expect(page.getByTestId(`album-open-${album.id}`)).toHaveCount(0);

  await page.getByTestId("nav-photos-mobile").click();
  await page.getByTestId("photo-search").fill(preservedFilename);
  await expect(page.getByTestId(`photo-${preserved.id}`)).toBeVisible();
  await capture(page, "mobile-album-management.png");
});

test("Photos selects, deselects, and clears visible results", async ({ page }) => {
  const token = await prepareOwnerAndMirror(page.request);
  const firstFilename = "다중선택-편의-첫번째.jpg";
  const secondFilename = "다중선택-편의-두번째.jpg";
  const first = await uploadPhoto(
    page,
    token,
    await sharp(Buffer.from(syntheticJpeg())).resize(37, 23).jpeg().toBuffer(),
    firstFilename,
  );
  const second = await uploadPhoto(
    page,
    token,
    await sharp(Buffer.from(syntheticJpeg())).resize(41, 29).jpeg().toBuffer(),
    secondFilename,
  );
  await authenticatePage(page, token);
  await page.goto("/photos");
  await page.getByTestId("photo-search").fill("다중선택-편의");

  const firstCheckbox = page.getByTestId(`photo-select-${first.id}`);
  const secondCheckbox = page.getByTestId(`photo-select-${second.id}`);
  const toggleVisible = page.getByTestId("photo-toggle-visible");
  const clearSelection = page.getByTestId("photo-clear-selection");
  const selectionSummary = page.getByTestId("photo-selection-summary");

  await expect(selectionSummary).toContainText("0 selected");
  await toggleVisible.click();
  await expect(firstCheckbox).toBeChecked();
  await expect(secondCheckbox).toBeChecked();
  await expect(selectionSummary).toContainText("2 selected");
  await expect(toggleVisible).toContainText("Deselect visible");
  await capture(page, "mobile-photo-selection.png");
  await page.setViewportSize({ height: 900, width: 1440 });
  await capture(page, "desktop-photo-selection.png");
  await page.setViewportSize({ height: 844, width: 390 });

  await toggleVisible.click();
  await expect(firstCheckbox).not.toBeChecked();
  await expect(secondCheckbox).not.toBeChecked();
  await expect(selectionSummary).toContainText("0 selected");

  await firstCheckbox.check();
  await secondCheckbox.check();
  await expect(selectionSummary).toContainText("2 selected");
  await page.getByTestId("photo-search").fill(firstFilename);
  await expect(selectionSummary).toContainText("1 outside current results");
  await clearSelection.click();
  await expect(selectionSummary).toContainText("0 selected");
  await page.getByTestId("photo-search").fill("다중선택-편의");
  await expect(firstCheckbox).not.toBeChecked();
  await expect(secondCheckbox).not.toBeChecked();

  await firstCheckbox.check();
  await secondCheckbox.check();
  await firstCheckbox.uncheck();
  await expect(selectionSummary).toContainText("1 selected");
  await expect(firstCheckbox).not.toBeChecked();
  await expect(secondCheckbox).toBeChecked();

  await expectTouchTarget(toggleVisible);
  await expectTouchTarget(clearSelection);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("Photos deletes a selected photo from the library and every album", async ({ page }) => {
  const token = await prepareOwnerAndMirror(page.request);
  const filename = "Photos-전체삭제.jpg";
  const photo = await uploadPhoto(
    page,
    token,
    await sharp(Buffer.from(syntheticJpeg())).resize(43, 31).jpeg().toBuffer(),
    filename,
  );
  const created = await page.request.post("/api/v1/albums", {
    data: { name: "전체 삭제 확인" },
    headers: authorize(token),
  });
  const album = albumSchema.parse(await created.json());
  await page.request.post(`/api/v1/albums/${album.id}/photos/${photo.id}`, {
    headers: authorize(token),
  });
  await authenticatePage(page, token);
  await page.goto("/photos");

  await page.getByTestId(`photo-select-${photo.id}`).check();
  const deleteSelected = page.getByTestId("photo-delete-selected");
  await expectTouchTarget(deleteSelected);
  await deleteSelected.click();
  const dialog = page.getByTestId("photo-delete-dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  await expect(page.getByTestId("photo-delete-library-warning")).toBeVisible();
  await expect(page.getByTestId("photo-delete-safe-action")).toBeFocused();
  await expectTouchTarget(page.getByTestId("photo-delete-safe-action"));
  await expectTouchTarget(page.getByTestId("photo-delete-library-confirm"));
  expect(await dialog.getAttribute("aria-label")).toBe(await dialog.locator("h2").textContent());
  await expectGuidanceContrast(page.getByTestId("photo-delete-library-confirm"));
  await capture(page, "mobile-photo-delete-library.png");

  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === `/api/v1/photos/${photo.id}`,
  );
  await page.getByTestId("photo-delete-library-confirm").click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByTestId(`photo-${photo.id}`)).toHaveCount(0);
  await expect(dialog).toBeHidden();

  await page.getByTestId("nav-more-mobile").click();
  await page.getByTestId("nav-albums-mobile").click();
  await page.getByTestId(`album-open-${album.id}`).click();
  await expect(page.getByTestId("album-detail-photo-count")).toHaveText("0");
});

test("Albums offers remove-only and delete-everywhere photo actions", async ({ page }) => {
  const token = await prepareOwnerAndMirror(page.request);
  const removeOnly = await uploadPhoto(
    page,
    token,
    await sharp(Buffer.from(syntheticJpeg())).resize(47, 29).jpeg().toBuffer(),
    "앨범에서만-제거.jpg",
  );
  const deleteEverywhere = await uploadPhoto(
    page,
    token,
    await sharp(Buffer.from(syntheticJpeg())).resize(53, 37).jpeg().toBuffer(),
    "앨범에서-전체삭제.jpg",
  );
  const created = await page.request.post("/api/v1/albums", {
    data: { name: "삭제 범위 선택" },
    headers: authorize(token),
  });
  const album = albumSchema.parse(await created.json());
  for (const photo of [removeOnly, deleteEverywhere]) {
    await page.request.post(`/api/v1/albums/${album.id}/photos/${photo.id}`, {
      headers: authorize(token),
    });
  }
  await authenticatePage(page, token);
  await page.goto("/albums");
  await page.getByTestId(`album-open-${album.id}`).click();

  const removeOnlyTrigger = page.getByTestId(`album-photo-manage-${removeOnly.id}`);
  await removeOnlyTrigger.click();
  await page.getByTestId("photo-delete-close").click();
  await expect(removeOnlyTrigger).toBeFocused();
  await removeOnlyTrigger.click();
  await expectTouchTarget(page.getByTestId("photo-remove-from-album"));
  await expectTouchTarget(page.getByTestId("photo-delete-library-start"));
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === `/api/v1/albums/${album.id}/photos/${removeOnly.id}`,
  );
  await page.getByTestId("photo-remove-from-album").click();
  expect((await removed).status()).toBe(204);
  await expect(page.getByTestId(`album-detail-photo-${removeOnly.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`album-detail-photo-${deleteEverywhere.id}`)).toBeVisible();
  await expect(page.getByTestId("album-manage")).toBeFocused();

  await page.getByTestId(`album-photo-manage-${deleteEverywhere.id}`).click();
  await page.getByTestId("photo-delete-library-start").click();
  await expect(page.getByTestId("photo-delete-library-warning")).toBeVisible();
  await expect(page.getByTestId("photo-delete-safe-action")).toBeFocused();
  await expectTouchTarget(page.getByTestId("photo-delete-safe-action"));
  await expectTouchTarget(page.getByTestId("photo-delete-library-confirm"));
  expect(await page.getByTestId("photo-delete-dialog").getAttribute("aria-label")).toBe(
    await page.getByTestId("photo-delete-dialog").locator("h2").textContent(),
  );
  await expectGuidanceContrast(page.getByTestId("photo-delete-library-confirm"));
  await capture(page, "mobile-album-photo-delete.png");
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === `/api/v1/photos/${deleteEverywhere.id}`,
  );
  await page.getByTestId("photo-delete-library-confirm").click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByTestId(`album-detail-photo-${deleteEverywhere.id}`)).toHaveCount(0);
  await expect(page.getByTestId("album-manage")).toBeFocused();

  await page.getByTestId("nav-photos-mobile").click();
  await page.getByTestId("photo-search").fill("앨범에서");
  await expect(page.getByTestId(`photo-${removeOnly.id}`)).toBeVisible();
  await expect(page.getByTestId(`photo-${deleteEverywhere.id}`)).toHaveCount(0);
});
