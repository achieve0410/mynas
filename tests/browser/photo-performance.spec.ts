import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { z } from "zod";

import { authenticateLibraryPage, uploadPhotoFixture } from "./library-ux-setup";

const albumSchema = z.object({ id: z.string().uuid() });
const evidenceDirectory = "/tmp/ulw-mynas-perf";
const photoCount = 180;
const renderWindow = 60;

const authorize = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

test("Photos and Album bound mounted previews without changing decoded images", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const token = await authenticateLibraryPage(page, request);
  await page.setViewportSize({ height: 844, width: 390 });
  const photoIds: string[] = [];
  for (let offset = 0; offset < photoCount; offset += 8) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(8, photoCount - offset) }, (_, index) =>
        uploadPhotoFixture(
          request,
          token,
          `performance-bounded-${String(offset + index).padStart(3, "0")}.jpg`,
        ),
      ),
    );
    photoIds.push(...batch);
  }
  const uniquePhotoIds = [...new Set(photoIds)];
  expect(uniquePhotoIds.length).toBeGreaterThan(renderWindow * 2);

  const albumResponse = await request.post("/api/v1/albums", {
    data: { name: "Performance window" },
    headers: authorize(token),
  });
  expect(albumResponse.status()).toBe(201);
  const album = albumSchema.parse(await albumResponse.json());
  await Promise.all(
    uniquePhotoIds.map(async (photoId) => {
      const response = await request.post(`/api/v1/albums/${album.id}/photos/${photoId}`, {
        headers: authorize(token),
      });
      expect(response.status()).toBe(200);
    }),
  );

  let previewRequests = 0;
  page.on("request", (request_) => {
    if (/\/api\/v1\/photos\/[^/]+\/preview$/.test(new URL(request_.url()).pathname)) {
      previewRequests += 1;
    }
  });

  await page.goto("/photos");
  await page.getByTestId("photo-search").fill("performance-bounded");
  await expect(page.locator(".photo-item")).toHaveCount(renderWindow);
  const photosInitialMounted = await page.locator(".photo-item").count();
  const initiallyMountedPhotoIds = await page
    .locator('.photo-item [data-testid^="photo-"]')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const testId = element.getAttribute("data-testid");
        return testId === null ? [] : [testId.slice("photo-".length)];
      }),
    );
  const latePhotoId = uniquePhotoIds.find((photoId) => !initiallyMountedPhotoIds.includes(photoId));
  if (latePhotoId === undefined) {
    throw new Error("Photos did not expose a later render window");
  }
  expect(previewRequests).toBeLessThan(renderWindow);

  await page.getByTestId("photo-window-sentinel").scrollIntoViewIfNeeded();
  await expect(page.locator(".photo-item")).toHaveCount(renderWindow * 2);
  await page.getByTestId("photo-window-sentinel").scrollIntoViewIfNeeded();
  await expect(page.locator(".photo-item")).toHaveCount(uniquePhotoIds.length);
  await expect(page.getByTestId(`photo-${initiallyMountedPhotoIds[0] ?? ""}`)).toBeAttached();
  const latePhoto = page.getByTestId(`photo-${latePhotoId}`);
  await expect(latePhoto).toBeAttached();
  await latePhoto.scrollIntoViewIfNeeded();
  const latePhotoImage = latePhoto.locator("img");
  await expect(latePhotoImage).toBeVisible();
  await latePhotoImage.evaluate(async (image) => {
    await (image as HTMLImageElement).decode();
  });
  expect(
    await latePhotoImage.evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: `${evidenceDirectory}/photos-scroll-mobile.png` });

  await page.goto("/albums");
  await page.getByTestId(`album-open-${album.id}`).click();
  await expect(page.getByTestId("album-detail")).toBeVisible();
  await expect(page.locator(".album-detail-photo")).toHaveCount(renderWindow);
  const albumInitialMounted = await page.locator(".album-detail-photo").count();
  const initiallyMountedAlbumIds = await page
    .locator('.album-detail-photo[data-testid^="album-detail-photo-"]')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const testId = element.getAttribute("data-testid");
        return testId === null ? [] : [testId.slice("album-detail-photo-".length)];
      }),
    );
  const lateAlbumPhotoId = uniquePhotoIds.find(
    (photoId) => !initiallyMountedAlbumIds.includes(photoId),
  );
  if (lateAlbumPhotoId === undefined) {
    throw new Error("Album did not expose a later render window");
  }
  await page.getByTestId("album-window-sentinel").scrollIntoViewIfNeeded();
  await expect(page.locator(".album-detail-photo")).toHaveCount(renderWindow * 2);
  await page.getByTestId("album-window-sentinel").scrollIntoViewIfNeeded();
  await expect(page.locator(".album-detail-photo")).toHaveCount(uniquePhotoIds.length);
  await expect(
    page.getByTestId(`album-detail-photo-${initiallyMountedAlbumIds[0] ?? ""}`),
  ).toBeAttached();
  const lateAlbumPhoto = page.getByTestId(`album-detail-photo-${lateAlbumPhotoId}`);
  await expect(lateAlbumPhoto).toBeAttached();
  await lateAlbumPhoto.scrollIntoViewIfNeeded();
  const lateAlbumPhotoImage = lateAlbumPhoto.locator("img");
  await expect(lateAlbumPhotoImage).toBeVisible();
  await lateAlbumPhotoImage.evaluate(async (image) => {
    await (image as HTMLImageElement).decode();
  });
  expect(
    await lateAlbumPhotoImage.evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
  const mobileNavigationBox = await mobileNavigation.boundingBox();
  const mobileLayout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    overflow: [...document.querySelectorAll("*")]
      .map((element) => {
        const rectangle = element.getBoundingClientRect();
        return {
          className: element.className,
          left: rectangle.left,
          right: rectangle.right,
          tagName: element.tagName,
          width: rectangle.width,
        };
      })
      .filter(({ left, right }) => left < -1 || right > window.innerWidth + 1)
      .slice(0, 12),
    scrollWidth: document.documentElement.scrollWidth,
    scrollX: window.scrollX,
  }));
  const mobileNavigationItems = await Promise.all(
    ["Overview", "Files", "Photos", "More navigation"].map((name) => {
      const role = name === "More navigation" ? "button" : "link";
      return mobileNavigation.getByRole(role, { name }).boundingBox();
    }),
  );
  expect(mobileNavigationBox).not.toBeNull();
  expect(mobileNavigationItems.every((box) => box !== null)).toBe(true);
  expect(mobileNavigationItems[0]?.x ?? -1, JSON.stringify(mobileLayout)).toBeGreaterThanOrEqual(
    mobileNavigationBox?.x ?? 0,
  );
  expect(
    (mobileNavigationItems.at(-1)?.x ?? 0) + (mobileNavigationItems.at(-1)?.width ?? 0),
  ).toBeLessThanOrEqual((mobileNavigationBox?.x ?? 0) + (mobileNavigationBox?.width ?? 0));
  await page.screenshot({ path: `${evidenceDirectory}/album-scroll-mobile.png` });

  await writeFile(
    `${evidenceDirectory}/metrics.json`,
    `${JSON.stringify(
      {
        albumInitialMounted,
        photoCount: uniquePhotoIds.length,
        photosInitialMounted,
        previewRequests,
      },
      null,
      2,
    )}\n`,
  );
});
