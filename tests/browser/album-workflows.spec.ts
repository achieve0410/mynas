import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { z } from "zod";

import { syntheticExifJpeg } from "../fixtures/exif-photo";
import { syntheticJpeg } from "../fixtures/synthetic-photo";
import { ingestSchema, prepareOwnerAndMirror } from "./photo-setup";

const albumSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  photos: z.array(z.object({ id: z.string().uuid() }).passthrough()),
});
const evidenceDirectory = process.env.MYNAS_ALBUM_EVIDENCE_DIR;

const authorize = (token: string): Readonly<Record<string, string>> => ({
  authorization: `Bearer ${token}`,
});

const authenticatePage = async (page: Page, token: string): Promise<void> => {
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);
  await page.setViewportSize({ height: 844, width: 390 });
};

const createAlbum = async (
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<z.infer<typeof albumSchema>> => {
  const response = await request.post("/api/v1/albums", {
    data: { name },
    headers: authorize(token),
  });
  expect(response.status()).toBe(201);
  return albumSchema.parse(await response.json());
};

const uploadPhoto = async (
  request: APIRequestContext,
  token: string,
  contents: Buffer,
  filename: string,
) => {
  const response = await request.post("/api/v1/photos", {
    data: contents,
    headers: {
      ...authorize(token),
      "content-type": "image/jpeg",
      "x-mynas-filename": encodeURIComponent(filename),
    },
  });
  expect(response.status()).toBe(201);
  return ingestSchema.parse(await response.json());
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

const contrastRatio = (locator: Locator): Promise<number> =>
  locator.evaluate((element) => {
    const channels = (value: string): readonly number[] =>
      (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const luminance = (values: readonly number[]): number =>
      values.reduce((total, value, index) => {
        const normalized = (value ?? 0) / 255;
        const linear =
          normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        return total + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
      }, 0);
    const foreground = luminance(channels(getComputedStyle(element).color));
    let current: Element | null = element;
    let background = 0;
    while (current !== null) {
      const color = getComputedStyle(current).backgroundColor;
      const values = channels(color);
      const alpha = Number((color.match(/\d+(?:\.\d+)?/g) ?? [])[3] ?? 1);
      if (values.length === 3 && alpha > 0) {
        background = luminance(values);
        break;
      }
      current = current.parentElement;
    }
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });

test("iPhone album flow creates and enters an empty album", async ({ page, request }) => {
  const token = await prepareOwnerAndMirror(request);
  await authenticatePage(page, token);
  await page.goto("/albums");

  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/albums",
  );
  await page.getByRole("button", { name: "Create album" }).click();
  await page.getByTestId("album-name").fill("아이폰 가족앨범");
  await page.getByTestId("album-submit").click();
  const album = albumSchema.parse(await (await created).json());

  await page.getByTestId(`album-open-${album.id}`).click();
  await expect(page.getByTestId("album-detail")).toBeVisible();
  await expect(page.getByTestId("album-detail-empty")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "아이폰 가족앨범" })).toBeVisible();

  const photoInput = page.getByTestId("album-photo-upload");
  await expect(photoInput).toHaveAttribute("multiple", "");
  await expect(photoInput).toHaveAttribute("accept", /image/);
  expect(await photoInput.getAttribute("webkitdirectory")).toBeNull();
  await expect(page.getByTestId("album-photo-directory-upload")).toHaveAttribute(
    "webkitdirectory",
    "",
  );
  await expect(page.getByTestId("album-photo-picker-note")).toBeVisible();
  await expectTouchTarget(page.getByTestId("album-add-existing"));
  await expectTouchTarget(photoInput.locator("xpath=.."));
  await expectTouchTarget(page.getByTestId("album-photo-directory-upload").locator("xpath=.."));
  await photoInput.setInputFiles({
    buffer: Buffer.from(syntheticJpeg()),
    mimeType: "image/jpeg",
    name: "touch-target.jpg",
  });
  const importReview = page.getByTestId("photo-import-review");
  await expectTouchTarget(importReview.getByRole("button", { name: "Upload 1 new" }));
  await expectTouchTarget(importReview.getByRole("button", { name: "Cancel", exact: true }));
  await importReview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(importReview).toBeHidden();
  expect(await contrastRatio(page.getByTestId("album-photo-picker-note"))).toBeGreaterThanOrEqual(
    4.5,
  );
  await capture(page, "mobile-empty-album.png");
});

test("album adds an existing photo and removes it from candidates", async ({ page, request }) => {
  const token = await prepareOwnerAndMirror(request);
  const existingFilename = "기존-라이브러리-사진.jpg";
  const existing = await uploadPhoto(
    request,
    token,
    await sharp(Buffer.from(syntheticJpeg())).resize(19, 13).jpeg().toBuffer(),
    existingFilename,
  );
  const album = await createAlbum(request, token, "기존 사진 선택");
  await authenticatePage(page, token);
  await page.goto("/albums");
  await page.getByTestId(`album-open-${album.id}`).click();

  await page.getByTestId("album-add-existing").click();
  await page.getByTestId("album-existing-search").fill(existingFilename);
  const submit = page.getByTestId("album-existing-submit");
  await expect(submit).toBeDisabled();
  await expectTouchTarget(page.getByRole("button", { name: "Cancel" }));
  await expectTouchTarget(submit);
  await page.getByTestId(`album-existing-select-${existing.photo.id}`).check();
  await page.getByTestId("album-existing-submit").click();

  await expect(page.getByTestId("album-detail-photo-count")).toHaveText("1");
  await expect(page.getByTestId(`album-detail-photo-${existing.photo.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`album-detail-photo-${existing.photo.id}`).getByRole("img"),
  ).toBeVisible();

  await page.getByTestId("album-add-existing").click();
  await page.getByTestId("album-existing-search").fill(existingFilename);
  await expect(page.getByTestId("album-existing-empty")).toBeVisible();
  await capture(page, "mobile-existing-photo.png");
});

test("album uploads a new photo and attaches it after completion", async ({ page, request }) => {
  const token = await prepareOwnerAndMirror(request);
  const existing = await uploadPhoto(
    request,
    token,
    await sharp(Buffer.from(syntheticJpeg())).resize(12, 8).jpeg().toBuffer(),
    "앨범-기존-사진.jpg",
  );
  const album = await createAlbum(request, token, "앨범 안에서 업로드");
  const addExisting = await request.post(`/api/v1/albums/${album.id}/photos/${existing.photo.id}`, {
    headers: authorize(token),
  });
  expect(addExisting.status()).toBe(200);
  await authenticatePage(page, token);
  await page.goto("/albums");
  await page.getByTestId(`album-open-${album.id}`).click();

  const filename = "새로운-아이폰-사진.jpg";
  const uploadCompleted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/photos",
  );
  await page.getByTestId("album-photo-upload").setInputFiles({
    buffer: await sharp(Buffer.from(syntheticJpeg())).rotate(90).jpeg().toBuffer(),
    mimeType: "image/jpeg",
    name: filename,
  });
  await page.getByRole("button", { name: "Upload 1" }).click();
  const uploaded = ingestSchema.parse(await (await uploadCompleted).json());

  await expect(page.getByTestId(`transfer-photo-${filename}`)).toHaveAttribute(
    "data-status",
    "complete",
  );
  await expect(page.getByTestId("album-detail-photo-count")).toHaveText("2");
  await expect(page.getByTestId(`album-detail-photo-${uploaded.photo.id}`)).toBeVisible();
  await capture(page, "mobile-album-upload.png");
});

test("album reuses an exact protected photo without showing a stale upload completion", async ({
  page,
  request,
}) => {
  const token = await prepareOwnerAndMirror(request);
  const album = await createAlbum(request, token, "중복 없는 앨범 추가");
  const filename = "앨범-보호됨-재사용.jpg";
  const photoBytes = await sharp(Buffer.from(syntheticJpeg())).resize(17, 11).jpeg().toBuffer();
  await authenticatePage(page, token);
  await page.goto("/albums");
  await page.getByTestId(`album-open-${album.id}`).click();

  const firstUpload = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/photos",
  );
  await page.getByTestId("album-photo-upload").setInputFiles({
    buffer: photoBytes,
    mimeType: "image/jpeg",
    name: filename,
  });
  await page.getByRole("button", { name: "Upload 1 new" }).click();
  const uploaded = ingestSchema.parse(await (await firstUpload).json());
  await expect(page.getByTestId(`album-detail-photo-${uploaded.photo.id}`)).toBeVisible();
  await expect(page.getByTestId("transfer-batch-summary").last()).toContainText(
    "1 of 1 photos uploaded",
  );

  let duplicateUploadRequests = 0;
  page.on("request", (outgoing) => {
    if (outgoing.method() === "POST" && new URL(outgoing.url()).pathname === "/api/v1/photos") {
      duplicateUploadRequests += 1;
    }
  });
  await page.getByTestId("album-photo-upload").setInputFiles({
    buffer: photoBytes,
    mimeType: "image/jpeg",
    name: filename,
  });
  const review = page.getByTestId("photo-import-review");
  await expect(review.locator('[data-review-status="already-protected"]')).toHaveCount(1);
  await expect(review.locator('[data-review-status="new"]')).toHaveCount(0);
  const reused = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/albums/${album.id}/photos/${uploaded.photo.id}`,
  );
  await review.getByRole("button", { name: "Add 1 protected" }).click();
  expect((await reused).status()).toBe(200);

  await expect(page.getByText("1 protected photos reused without uploading.")).toBeVisible();
  expect(duplicateUploadRequests).toBe(0);
  await expect(page.getByTestId("transfer-center")).toBeHidden();
});

test("Photos and Album show capture-time order", async ({ page, request }) => {
  const token = await prepareOwnerAndMirror(request);
  const older = await uploadPhoto(
    request,
    token,
    Buffer.from(
      syntheticExifJpeg({
        dateTimeOriginal: "2020:01:02 03:04:05",
        offsetTimeOriginal: "+00:00",
      }),
    ),
    "capture-order-older.jpg",
  );
  const newer = await uploadPhoto(
    request,
    token,
    Buffer.from(
      syntheticExifJpeg({
        dateTimeOriginal: "2030:01:02 03:04:05",
        offsetTimeOriginal: "+00:00",
      }),
    ),
    "capture-order-newer.jpg",
  );
  const portrait = await uploadPhoto(
    request,
    token,
    await sharp({
      create: {
        background: { b: 211, g: 176, r: 126 },
        channels: 3,
        height: 1_600,
        width: 1_200,
      },
    })
      .jpeg()
      .toBuffer(),
    "viewer-portrait.jpg",
  );
  const album = await createAlbum(request, token, "촬영 시점 정렬");
  for (const photoId of [older.photo.id, newer.photo.id]) {
    const added = await request.post(`/api/v1/albums/${album.id}/photos/${photoId}`, {
      headers: authorize(token),
    });
    expect(added.status()).toBe(200);
  }
  await authenticatePage(page, token);

  await page.goto("/photos");
  const photoOrder = page.locator(
    `[data-testid="photo-${newer.photo.id}"], [data-testid="photo-${older.photo.id}"]`,
  );
  await expect(photoOrder).toHaveCount(2);
  expect(
    await photoOrder.evaluateAll((elements) => elements.map((element) => element.dataset.testid)),
  ).toEqual([`photo-${newer.photo.id}`, `photo-${older.photo.id}`]);

  await page.goto("/albums");
  await page.getByTestId(`album-open-${album.id}`).click();
  const albumOrder = page.locator(
    `[data-testid="album-detail-photo-${newer.photo.id}"], [data-testid="album-detail-photo-${older.photo.id}"]`,
  );
  await expect(albumOrder).toHaveCount(2);
  expect(
    await albumOrder.evaluateAll((elements) => elements.map((element) => element.dataset.testid)),
  ).toEqual([`album-detail-photo-${newer.photo.id}`, `album-detail-photo-${older.photo.id}`]);
  const newerCard = page.getByTestId(`album-detail-photo-${newer.photo.id}`);
  await expect(newerCard.getByTestId(`album-photo-captured-${newer.photo.id}`)).toHaveAttribute(
    "datetime",
    "2030-01-02T03:04:05.000Z",
  );
  await expect(newerCard.getByText(/^Captured /)).toBeVisible();
  const openNewer = newerCard.getByRole("button", { name: "Open capture-order-newer.jpg" });
  await openNewer.click();

  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute("aria-label", "Photo viewer for capture-order-newer.jpg");
  await expect(viewer.getByTestId("photo-viewer-filename")).toHaveText("capture-order-newer.jpg");
  await viewer.locator("details.lightbox-meta").locator("summary").click();
  await expect(viewer.getByTestId("photo-captured-at")).toHaveAttribute(
    "datetime",
    "2030-01-02T03:04:05.000Z",
  );

  await page.keyboard.press("ArrowRight");
  await expect(viewer).toHaveAttribute("aria-label", "Photo viewer for capture-order-older.jpg");
  await expect(viewer.getByTestId("photo-viewer-filename")).toHaveText("capture-order-older.jpg");
  await expect(viewer.getByTestId("photo-captured-at")).toHaveAttribute(
    "datetime",
    "2020-01-02T03:04:05.000Z",
  );
  await capture(page, "capture-time-order-viewer-mobile.png");
  await viewer.getByRole("button", { name: "Close photo viewer" }).click();
  await expect(openNewer).toBeFocused();

  const addedPortrait = await request.post(
    `/api/v1/albums/${album.id}/photos/${portrait.photo.id}`,
    {
      headers: authorize(token),
    },
  );
  expect(addedPortrait.status()).toBe(200);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.reload();
  await page.getByTestId(`album-open-${album.id}`).click();
  await page.getByRole("button", { name: "Open viewer-portrait.jpg" }).click();
  await expect(viewer).toBeVisible();
  const stage = page.getByTestId("photo-lightbox-stage");
  const portraitImage = stage.locator("img");
  await expect(portraitImage).toBeVisible();
  const naturalSize = await portraitImage.evaluate(async (image) => {
    const loadedImage = image as HTMLImageElement;
    await loadedImage.decode();
    return {
      height: loadedImage.naturalHeight,
      width: loadedImage.naturalWidth,
    };
  });
  expect(naturalSize.height).toBeGreaterThan(naturalSize.width);
  const stageBox = await stage.boundingBox();
  const frameBox = await stage.locator(".lightbox-image-frame").boundingBox();
  const imageBox = await portraitImage.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  expect((frameBox?.y ?? 0) + (frameBox?.height ?? 0)).toBeLessThanOrEqual(
    (stageBox?.y ?? 0) + (stageBox?.height ?? 0) + 1,
  );
  expect((imageBox?.y ?? 0) + (imageBox?.height ?? 0)).toBeLessThanOrEqual(
    (stageBox?.y ?? 0) + (stageBox?.height ?? 0) + 1,
  );
  await capture(page, "capture-time-order-viewer-desktop.png");
  await viewer.getByRole("button", { name: "Close photo viewer" }).click();
});
