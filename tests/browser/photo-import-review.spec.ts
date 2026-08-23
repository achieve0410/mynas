import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { authenticateLibraryPage, createPhotoFixture } from "./library-ux-setup";

const evidenceDirectory = ".artifacts/qa/photo-import-review";

test("reviews a mobile selection and uploads only the new protected photo", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await authenticateLibraryPage(page, request);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/photos");

  const known = await createPhotoFixture("receipt-known.jpg");
  const knownLastModified = 1_787_020_800_000;
  const firstUpload = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/photos",
  );
  await page.getByTestId("photo-upload").evaluate(
    (input, file) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(file.bytes)], "receipt-known.jpg", {
          lastModified: file.lastModified,
          type: "image/jpeg",
        }),
      );
      Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { bytes: [...known], lastModified: knownLastModified },
  );
  await page.getByRole("button", { name: /Upload 1(?: new)?/ }).click();
  expect((await firstUpload).status()).toBe(201);
  await expect(page.getByTestId("transfer-batch-summary").last()).toContainText(
    "1 of 1 photos uploaded",
  );

  await page.reload();
  let secondUploadRequests = 0;
  page.on("request", (outgoing) => {
    if (outgoing.method() === "POST" && new URL(outgoing.url()).pathname === "/api/v1/photos") {
      secondUploadRequests += 1;
    }
  });
  const fresh = await createPhotoFixture("fresh-mobile.jpg");
  await page.getByTestId("photo-upload").evaluate(
    (input, files) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(files.known)], "receipt-known.jpg", {
          lastModified: files.knownLastModified,
          type: "image/jpeg",
        }),
      );
      transfer.items.add(
        new File([new Uint8Array(files.fresh)], "새로운-写真.jpg", {
          lastModified: 1_787_020_900_000,
          type: "image/jpeg",
        }),
      );
      transfer.items.add(
        new File([new TextEncoder().encode("not a photo")], "메모-검토.txt", {
          lastModified: 1_787_020_900_001,
          type: "text/plain",
        }),
      );
      transfer.items.add(
        new File([new Uint8Array(25 * 1_024 * 1_024 + 1)], "초과-사진.jpg", {
          lastModified: 1_787_020_900_002,
          type: "image/jpeg",
        }),
      );
      input.focus();
      Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    {
      fresh: [...fresh],
      known: [...known],
      knownLastModified,
    },
  );

  const review = page.getByTestId("photo-import-review");
  await expect(review).toBeVisible();
  await expect(review.locator('[data-review-status="already-protected"]')).toHaveCount(1);
  await expect(review.locator('[data-review-status="new"]')).toHaveCount(1);
  await expect(review.locator('[data-review-status="unsupported"]')).toHaveCount(1);
  await expect(review.locator('[data-review-status="oversize"]')).toHaveCount(1);
  expect(await review.evaluate((element) => element.matches(":modal"))).toBe(true);
  await expect(review.getByRole("button", { name: "Cancel photo import" })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await review.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const checkingLabelStyle = await review
    .locator('[data-review-summary="checking"] dt')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        fontSize: style.fontSize,
        overflow: style.overflow,
        whiteSpace: style.whiteSpace,
      };
    });
  expect(checkingLabelStyle).toEqual({
    color: "rgb(162, 176, 168)",
    fontSize: "12px",
    overflow: "visible",
    whiteSpace: "normal",
  });
  await expect(review).toContainText("새로운-写真.jpg");
  await expect(review).toContainText("메모-검토.txt");
  await expect(review).toContainText("초과-사진.jpg");
  const closedDisplay = await review.evaluate((element) => {
    const dialog = element as HTMLDialogElement;
    dialog.close();
    const display = getComputedStyle(dialog).display;
    dialog.showModal();
    return display;
  });
  expect(closedDisplay).toBe("none");
  expect(secondUploadRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: `${evidenceDirectory}/mobile-review.png`,
  });
  await page.setViewportSize({ height: 1_000, width: 1_440 });
  await page.screenshot({
    fullPage: true,
    path: `${evidenceDirectory}/desktop-review.png`,
  });
  await page.setViewportSize({ height: 844, width: 390 });
  const secondUpload = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/photos",
  );
  await review.getByRole("button", { name: "Upload 1 new" }).click();
  expect((await secondUpload).status()).toBe(201);
  await expect(page.getByTestId("transfer-batch-summary").last()).toContainText(
    "1 of 1 photos uploaded",
  );
  await expect(page.getByTestId("photo-upload")).toBeFocused();
  expect(secondUploadRequests).toBe(1);

  await page.screenshot({
    fullPage: true,
    path: `${evidenceDirectory}/mobile-complete.png`,
  });
  await writeFile(
    `${evidenceDirectory}/action-log.json`,
    `${JSON.stringify(
      {
        alreadyProtected: 1,
        new: 1,
        oversize: 1,
        receiptPersistedAcrossReload: true,
        secondUploadRequests,
        unsupported: 1,
      },
      null,
      2,
    )}\n`,
  );
});

test("recognizes a server-protected photo without a local receipt", async ({ page, request }) => {
  const token = await authenticateLibraryPage(page, request);
  const filename = "server-protected-no-receipt.jpg";
  const contents = await createPhotoFixture(filename);
  const existingUpload = await request.post("/api/v1/photos", {
    data: contents,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "image/jpeg",
      "x-mynas-filename": encodeURIComponent(filename),
    },
  });
  expect(existingUpload.status()).toBe(201);

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/photos");
  let duplicateUploadRequests = 0;
  page.on("request", (outgoing) => {
    if (outgoing.method() === "POST" && new URL(outgoing.url()).pathname === "/api/v1/photos") {
      duplicateUploadRequests += 1;
    }
  });
  await page.getByTestId("photo-upload").evaluate(
    (input, file) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(file.bytes)], file.filename, {
          lastModified: 1_787_031_600_000,
          type: "image/jpeg",
        }),
      );
      Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { bytes: [...contents], filename },
  );

  const review = page.getByTestId("photo-import-review");
  await expect(review).toBeVisible();
  await expect(review.locator('[data-review-status="already-protected"]')).toHaveCount(1);
  await expect(review.locator('[data-review-status="new"]')).toHaveCount(0);
  await expect(review.getByRole("button", { name: "Add 1 protected" })).toBeDisabled();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toBeHidden();
  expect(duplicateUploadRequests).toBe(0);
});
