import { expect, test } from "@playwright/test";

import { authenticateLibraryPage, uploadPhotoFixture } from "./library-ux-setup";

test("photo previews load only near the visible viewport", async ({ page, request }) => {
  const token = await authenticateLibraryPage(page, request);
  const photoIds: string[] = [];
  for (let index = 0; index < 24; index += 1) {
    photoIds.push(
      await uploadPhotoFixture(
        request,
        token,
        `viewport-preview-${String(index).padStart(2, "0")}.jpg`,
      ),
    );
  }

  let previewRequests = 0;
  page.on("request", (request_) => {
    if (/\/api\/v1\/photos\/[^/]+\/preview$/.test(new URL(request_.url()).pathname)) {
      previewRequests += 1;
    }
  });

  await page.goto("/photos");
  const visibleId = photoIds.at(-1);
  expect(visibleId).toBeDefined();
  const visiblePreview = page.getByTestId(`photo-${visibleId}`).locator("img");
  await expect(visiblePreview).toBeVisible();
  expect(
    await visiblePreview.evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  expect(previewRequests).toBeLessThan(photoIds.length);

  const hiddenId = photoIds[0];
  expect(hiddenId).toBeDefined();
  const hiddenResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/photos/${hiddenId}/preview` &&
      response.status() === 200,
  );
  await page.getByTestId(`photo-${hiddenId}`).scrollIntoViewIfNeeded();
  await hiddenResponse;
  await expect(page.getByTestId(`photo-${hiddenId}`).locator("img")).toBeVisible();
});
