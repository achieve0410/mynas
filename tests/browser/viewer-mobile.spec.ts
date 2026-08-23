import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { z } from "zod";

import { photosSchema } from "../../apps/web/src/schemas";
import { authenticateLibraryPage, uploadPhotoFixture } from "./library-ux-setup";

const albumSchema = z.object({ id: z.string().uuid() });
const deliverySchema = z.object({
  kind: z.enum(["download", "share"]),
  name: z.string(),
  size: z.number().int().nonnegative(),
  type: z.string(),
});
const evidenceDirectory = "/tmp/ulw-mynas-viewer";
const authorize = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

const greatestCommonDivisor = (left: number, right: number): number => {
  let a = left;
  let b = right;
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
};

test("mobile viewer uses two header rows, collapsed album metadata, and pinch zoom", async ({
  page,
  request,
}) => {
  const albumName = "주말 가족 사진 모음";
  const memberFilename = "가족-여름-여행-사진-원본-아주-긴-이름.jpg";
  const token = await authenticateLibraryPage(page, request);
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value(this: HTMLAnchorElement) {
        console.log(
          `MYNAS_PHOTO_DELIVERY:${JSON.stringify({
            kind: "download",
            name: this.download,
            size: 0,
            type: "",
          })}`,
        );
      },
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: ({ files }: ShareData) => files?.length === 1,
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async ({ files }: ShareData) => {
        const file = files?.[0];
        if (file === undefined) {
          throw new Error("shared photo file is missing");
        }
        console.log(
          `MYNAS_PHOTO_DELIVERY:${JSON.stringify({
            kind: "share",
            name: file.name,
            size: file.size,
            type: file.type,
          })}`,
        );
      },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) =>
        query === "(pointer: coarse)"
          ? {
              addEventListener: () => undefined,
              addListener: () => undefined,
              dispatchEvent: () => true,
              matches: true,
              media: query,
              onchange: null,
              removeEventListener: () => undefined,
              removeListener: () => undefined,
            }
          : matchMedia(query),
    });
  });
  await page.setViewportSize({ height: 844, width: 390 });
  const targetId = await uploadPhotoFixture(request, token, memberFilename);
  await uploadPhotoFixture(request, token, "가족-여름-여행-사진-다음.jpg");

  const albumResponse = await request.post("/api/v1/albums", {
    data: { name: albumName },
    headers: authorize(token),
  });
  expect(albumResponse.status()).toBe(201);
  const album = albumSchema.parse(await albumResponse.json());
  const membershipResponse = await request.post(`/api/v1/albums/${album.id}/photos/${targetId}`, {
    headers: authorize(token),
  });
  expect(membershipResponse.status()).toBe(200);

  const photosResponse = await request.get("/api/v1/photos", {
    headers: { authorization: `Bearer ${token}` },
  });
  const target = photosSchema
    .parse(await photosResponse.json())
    .find((photo) => photo.id === targetId);
  expect(target).toBeDefined();
  const divisor = greatestCommonDivisor(target?.width ?? 1, target?.height ?? 1);
  const expectedRatio = `${(target?.width ?? 1) / divisor}:${(target?.height ?? 1) / divisor}`;
  const expectedDimensions = `${target?.width}×${target?.height} (${expectedRatio})`;

  await page.goto("/photos");
  await page.getByTestId("photo-search").fill("가족-여름-여행");
  await page.getByTestId(`photo-${targetId}`).click();
  const viewer = page.getByRole("dialog", { name: `Photo viewer for ${memberFilename}` });
  await expect(viewer).toBeVisible();

  const primaryRow = page.getByTestId("photo-viewer-primary-row");
  const secondaryRow = page.getByTestId("photo-viewer-secondary-row");
  await expect(primaryRow).toBeVisible();
  await expect(secondaryRow).toBeVisible();
  await expect.soft(page.getByTestId("photo-viewer-dimensions")).toHaveText(expectedDimensions);
  const dimensionsFit = await page
    .getByTestId("photo-viewer-dimensions")
    .evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(dimensionsFit).toBe(true);
  await expect(page.getByTestId("photo-viewer-position")).toHaveText(/^[12] \/ 2$/);

  const filenameBox = await page.getByTestId("photo-viewer-filename").boundingBox();
  const closeBox = await page.getByRole("button", { name: "Close photo viewer" }).boundingBox();
  const positionBox = await page.getByTestId("photo-viewer-position").boundingBox();
  const downloadBox = await page.getByTestId("download-original").boundingBox();
  const primaryRowBox = await primaryRow.boundingBox();
  const secondaryRowBox = await secondaryRow.boundingBox();
  const viewerBox = await viewer.boundingBox();
  expect(filenameBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(positionBox).not.toBeNull();
  expect(downloadBox).not.toBeNull();
  expect(primaryRowBox).not.toBeNull();
  expect(secondaryRowBox).not.toBeNull();
  expect(viewerBox).not.toBeNull();
  const viewerFontFamily = await page
    .getByTestId("photo-viewer-filename")
    .evaluate((element) => window.getComputedStyle(element).fontFamily);
  expect(viewerFontFamily.indexOf("Noto Sans KR Variable")).toBeLessThan(
    viewerFontFamily.indexOf("Noto Sans JP Variable"),
  );
  const verticalCenter = (box: typeof filenameBox): number =>
    (box?.y ?? 0) + (box?.height ?? 0) / 2;
  expect(Math.abs(verticalCenter(filenameBox) - verticalCenter(closeBox))).toBeLessThan(8);
  expect((filenameBox?.x ?? 0) < (closeBox?.x ?? 0)).toBe(true);
  expect(Math.abs(verticalCenter(positionBox) - verticalCenter(downloadBox))).toBeLessThan(8);
  expect((positionBox?.x ?? 0) < (downloadBox?.x ?? 0)).toBe(true);
  expect
    .soft(
      Math.abs(
        (primaryRowBox?.x ?? 0) +
          (primaryRowBox?.width ?? 0) -
          ((closeBox?.x ?? 0) + (closeBox?.width ?? 0)),
      ),
    )
    .toBeLessThan(2);
  expect
    .soft(
      (viewerBox?.x ?? 0) +
        (viewerBox?.width ?? 0) -
        ((primaryRowBox?.x ?? 0) + (primaryRowBox?.width ?? 0)),
    )
    .toBeLessThanOrEqual(16);
  expect
    .soft(
      (viewerBox?.x ?? 0) +
        (viewerBox?.width ?? 0) -
        ((secondaryRowBox?.x ?? 0) + (secondaryRowBox?.width ?? 0)),
    )
    .toBeLessThanOrEqual(16);
  expect
    .soft(
      Math.abs(
        (secondaryRowBox?.x ?? 0) +
          (secondaryRowBox?.width ?? 0) -
          ((downloadBox?.x ?? 0) + (downloadBox?.width ?? 0)),
      ),
    )
    .toBeLessThan(2);

  const deliveryEvent = page.waitForEvent("console", {
    predicate: (message) => message.text().startsWith("MYNAS_PHOTO_DELIVERY:"),
  });
  await page.getByTestId("download-original").click();
  const delivery = deliverySchema.parse(
    JSON.parse((await deliveryEvent).text().slice("MYNAS_PHOTO_DELIVERY:".length)),
  );
  expect.soft(delivery).toEqual({
    kind: "share",
    name: memberFilename,
    size: expect.any(Number),
    type: "image/jpeg",
  });
  expect.soft(delivery.size).toBeGreaterThan(0);

  await expect(page.getByRole("button", { name: "Previous photo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next photo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom out" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveCount(0);

  const details = viewer.locator("details.lightbox-meta");
  expect(await details.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  await expect(details.getByText(albumName)).toBeHidden();
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: `${evidenceDirectory}/mobile-collapsed.png` });
  await details.locator("summary").click();
  await expect(details.getByText("Imported")).toBeVisible();
  await expect(details.getByText("SHA-256")).toBeVisible();
  await expect(details.getByText(albumName)).toBeVisible();
  await expect(primaryRow).toBeInViewport();
  await expect(secondaryRow).toBeInViewport();
  const expandedPrimaryRowBox = await primaryRow.boundingBox();
  const expandedSecondaryRowBox = await secondaryRow.boundingBox();
  expect(expandedPrimaryRowBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(expandedSecondaryRowBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(
    (expandedPrimaryRowBox?.y ?? 0) + (expandedPrimaryRowBox?.height ?? 0),
  ).toBeLessThanOrEqual(844);
  expect(
    (expandedSecondaryRowBox?.y ?? 0) + (expandedSecondaryRowBox?.height ?? 0),
  ).toBeLessThanOrEqual(844);

  const stage = page.getByTestId("photo-lightbox-stage");
  const stageBox = await stage.boundingBox();
  expect(stageBox).not.toBeNull();
  const centerX = (stageBox?.x ?? 0) + (stageBox?.width ?? 0) / 2;
  const centerY = (stageBox?.y ?? 0) + (stageBox?.height ?? 0) / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [
      { id: 1, x: centerX - 34, y: centerY },
      { id: 2, x: centerX + 34, y: centerY },
    ],
    type: "touchStart",
  });
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [
      { id: 1, x: centerX - 86, y: centerY },
      { id: 2, x: centerX + 86, y: centerY },
    ],
    type: "touchMove",
  });
  await cdp.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" });
  const scale = await stage
    .locator("img")
    .evaluate((image) => new DOMMatrix(getComputedStyle(image).transform).a);
  expect(scale).toBeGreaterThan(1);

  await page.screenshot({ path: `${evidenceDirectory}/mobile-expanded.png` });
});
