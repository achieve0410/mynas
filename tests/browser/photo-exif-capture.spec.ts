import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { syntheticExifJpeg, syntheticMalformedExifJpeg } from "../fixtures/exif-photo";
import { ingestSchema, prepareOwnerAndMirror } from "./photo-setup";

const evidenceDirectory = process.env.MYNAS_METADATA_EVIDENCE_DIR;

test("Photos shows captured date and optional location in photo details", async ({
  page,
  request,
}) => {
  const token = await prepareOwnerAndMirror(request);
  const noLocationUpload = await request.post("/api/v1/photos", {
    data: Buffer.from(syntheticMalformedExifJpeg()),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "image/jpeg",
      "x-mynas-filename": encodeURIComponent("no-location.jpg"),
    },
  });
  expect(noLocationUpload.status()).toBe(201);
  expect(await noLocationUpload.json()).toMatchObject({
    photo: { filename: "no-location.jpg", location: null },
  });
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request_) => {
    if (new URL(request_.url()).pathname !== "/api/v1/transfer-notifications") {
      failedRequests.push(`${request_.method()} ${request_.url()}`);
    }
  });
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/photos");
  const upload = async (contents: Uint8Array, filename: string) => {
    await expect(page.getByTestId("photo-upload")).toBeEnabled();
    const notification = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/v1/transfer-notifications",
    );
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/v1/photos",
    );
    await page.getByTestId("photo-upload").setInputFiles({
      buffer: Buffer.from(contents),
      mimeType: "image/jpeg",
      name: filename,
    });
    await page.getByRole("button", { name: "Upload 1" }).click();
    const completed = await response;
    const notified = await notification;
    expect(completed.status()).toBe(201);
    expect(notified.status()).toBe(204);
    await page.evaluate(async () => Promise.resolve());
    return ingestSchema.parse(await completed.json());
  };
  await upload(
    syntheticExifJpeg({
      dateTimeOriginal: "2024:03:04 05:06:07",
      latitude: 37.5,
      longitude: 127,
      offsetTimeOriginal: "+09:00",
    }),
    "gps-offset.jpg",
  );
  await page.getByRole("button", { name: "Close background transfers" }).click();
  await page.getByRole("button", { name: "Open gps-offset.jpg" }).click();
  await page.getByText("Photo details", { exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("photo-captured-at")).toHaveAttribute(
    "datetime",
    "2024-03-03T20:06:07.000Z",
  );
  await expect(dialog.getByTestId("photo-location")).toHaveText("37.500000, 127.000000");
  await expect(dialog.getByRole("link", { name: "Open location in Maps" })).toHaveAttribute(
    "href",
    "https://maps.apple.com/?ll=37.500000%2C127.000000",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  if (evidenceDirectory !== undefined) {
    await page.screenshot({
      fullPage: true,
      path: join(evidenceDirectory, "metadata-mobile.png"),
    });
  }

  await page.getByRole("button", { name: "Close photo viewer" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open no-location.jpg" }).click();
  await expect(page.getByTestId("photo-viewer-filename")).toHaveText("no-location.jpg");
  await page.getByText("Photo details", { exact: true }).click();
  await expect(dialog.getByTestId("photo-captured-at")).toHaveAttribute("datetime", /^2026-/);
  await expect(dialog.getByTestId("photo-location")).toHaveCount(0);
  if (evidenceDirectory !== undefined) {
    await page.screenshot({
      fullPage: true,
      path: join(evidenceDirectory, "no-location-mobile.png"),
    });
  }

  await page.getByRole("button", { name: "Close photo viewer" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.getByRole("button", { name: "Open gps-offset.jpg" }).click();
  await expect(page.getByTestId("photo-viewer-filename")).toHaveText("gps-offset.jpg");
  await page.getByText("Photo details", { exact: true }).click();
  if (evidenceDirectory !== undefined) {
    await page.screenshot({
      fullPage: true,
      path: join(evidenceDirectory, "metadata-desktop.png"),
    });
    await writeFile(
      join(evidenceDirectory, "metadata-action-log.json"),
      `${JSON.stringify(
        {
          actions: [
            "uploaded gps-offset.jpg and no-location.jpg",
            "opened GPS photo details at 390x844",
            "asserted captured datetime and Maps location",
            "opened no-location photo and asserted location omission",
            "reopened GPS details at 1440x900",
          ],
          failedRequests,
          pageErrors,
        },
        null,
        2,
      )}\n`,
    );
  }
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await expect(
    dialog.getByTestId("photo-captured-at"),
    "authenticated photo API remains usable",
  ).toBeVisible();
});
