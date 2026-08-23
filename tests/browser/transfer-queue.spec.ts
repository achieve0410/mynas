import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { authenticateLibraryPage, uploadFileFixture } from "./library-ux-setup";

const evidenceDirectory = "/tmp/ulw-mynas-transfer";
type TransferActionLog = {
  readonly backgroundPage: boolean;
  readonly completed: number;
  readonly maximumActive: number;
  readonly operation: "download" | "upload";
  readonly routeAfterNavigation: string;
  readonly started: number;
};
const actionLog: TransferActionLog[] = [];
const writeActionLog = async (entry: TransferActionLog): Promise<void> => {
  actionLog.push(entry);
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    `${evidenceDirectory}/action-log.json`,
    `${JSON.stringify(actionLog, null, 2)}\n`,
  );
};

const eventWithin = async <Value>(
  promise: Promise<Value>,
  message: string,
  timeoutMs = 5_000,
): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });

const createGate = () => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release: () => release?.(),
    wait,
  };
};

test("uploads run three at a time and survive route and background-tab changes", async ({
  context,
  page,
  request,
}) => {
  await authenticateLibraryPage(page, request);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/files");

  const gate = createGate();
  let active = 0;
  let maximumActive = 0;
  let started = 0;
  let resolveThird: (() => void) | undefined;
  const thirdStarted = new Promise<void>((resolve) => {
    resolveThird = resolve;
  });
  await page.route("**/api/v1/files/**", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    started += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    if (started === 3) {
      resolveThird?.();
    }
    await gate.wait;
    await route.continue();
    active -= 1;
  });

  await page.getByTestId("file-upload").setInputFiles(
    Array.from({ length: 4 }, (_, index) => ({
      buffer: Buffer.from(`parallel upload ${index}`),
      mimeType: "text/plain",
      name: `parallel-upload-${index}.txt`,
    })),
  );
  await page.getByRole("button", { name: "Upload 4 protected items" }).click();
  await expect(
    page.getByTestId("transfer-center").locator('[data-status="transferring"]'),
  ).toHaveCount(3);
  await eventWithin(thirdStarted, `expected three concurrent upload requests, observed ${started}`);
  expect(maximumActive).toBe(3);

  await page.getByTestId("nav-photos-mobile").click();
  await expect(page).toHaveURL(/\/photos$/);
  await expect(page.getByTestId("transfer-center")).toContainText("parallel-upload-0.txt");

  const foreground = await context.newPage();
  await foreground.goto("about:blank");
  await foreground.bringToFront();
  gate.release();
  await page.bringToFront();
  await expect(page.getByTestId("transfer-center").locator('[data-status="complete"]')).toHaveCount(
    4,
  );
  const transferCenter = page.getByTestId("transfer-center");
  expect(await transferCenter.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe(
    "auto",
  );
  const clearFinishedBox = await page.getByRole("button", { name: "Clear finished" }).boundingBox();
  const closeBox = await page
    .getByRole("button", { name: "Close background transfers" })
    .boundingBox();
  expect(clearFinishedBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(clearFinishedBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(closeBox?.width ?? 0).toBe(44);
  expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(
    Math.abs(
      (clearFinishedBox?.y ?? 0) +
        (clearFinishedBox?.height ?? 0) / 2 -
        ((closeBox?.y ?? 0) + (closeBox?.height ?? 0) / 2),
    ),
  ).toBeLessThan(4);

  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: `${evidenceDirectory}/transfer-mobile.png`,
  });
  await writeActionLog({
    backgroundPage: true,
    completed: 4,
    maximumActive,
    operation: "upload",
    routeAfterNavigation: new URL(page.url()).pathname,
    started,
  });
  await page.getByRole("button", { name: "Close background transfers" }).click();
  await expect(page.getByTestId("transfer-center")).toHaveCount(0);
  await page.getByTestId("nav-files-mobile").click();
  await page.getByTestId("file-upload").setInputFiles({
    buffer: Buffer.from("reopened transfer center"),
    mimeType: "text/plain",
    name: "transfer-center-reopens.txt",
  });
  await page.getByRole("button", { name: "Upload 1 protected item" }).click();
  await expect(page.getByTestId("transfer-center")).toContainText("transfer-center-reopens.txt");
  await foreground.close();
});

test("selected files download as three concurrent jobs across route changes", async ({
  context,
  page,
  request,
}) => {
  const token = await authenticateLibraryPage(page, request);
  const paths = Array.from({ length: 4 }, (_, index) => `parallel-download-${index}.txt`);
  await Promise.all(
    paths.map((path, index) => uploadFileFixture(request, token, path, `${index}`)),
  );
  await page.goto("/files");

  for (const path of paths) {
    await page.getByTestId(`file-select-${path}`).check();
  }

  const gate = createGate();
  let active = 0;
  let maximumActive = 0;
  let started = 0;
  let resolveThird: (() => void) | undefined;
  const thirdStarted = new Promise<void>((resolve) => {
    resolveThird = resolve;
  });
  await page.route("**/api/v1/files/**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    started += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    if (started === 3) {
      resolveThird?.();
    }
    await gate.wait;
    await route.continue();
    active -= 1;
  });

  let downloaded = 0;
  let resolveDownloads: (() => void) | undefined;
  const allDownloads = new Promise<void>((resolve) => {
    resolveDownloads = resolve;
  });
  page.on("download", () => {
    downloaded += 1;
    if (downloaded === paths.length) {
      resolveDownloads?.();
    }
  });

  await page.getByRole("button", { name: "Download selected" }).click();
  await eventWithin(
    thirdStarted,
    `expected three concurrent download requests, observed ${started}`,
  );
  expect(maximumActive).toBe(3);

  await page.getByTestId("nav-photos").click();
  await expect(page).toHaveURL(/\/photos$/);
  await expect(page.getByTestId("transfer-center")).toContainText(paths[0] ?? "");

  const foreground = await context.newPage();
  await foreground.goto("about:blank");
  await foreground.bringToFront();
  gate.release();
  await page.bringToFront();
  await eventWithin(allDownloads, `expected ${paths.length} downloads, observed ${downloaded}`);
  await expect(page.getByTestId("transfer-center").locator('[data-status="complete"]')).toHaveCount(
    paths.length,
  );
  await writeActionLog({
    backgroundPage: true,
    completed: downloaded,
    maximumActive,
    operation: "download",
    routeAfterNavigation: new URL(page.url()).pathname,
    started,
  });
  await foreground.close();
});

test("keeps ten-thousand selected photos bounded while three uploads run", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await authenticateLibraryPage(page, request);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/photos");

  const gate = createGate();
  let active = 0;
  let maximumActive = 0;
  let started = 0;
  let resolveThird: (() => void) | undefined;
  const thirdStarted = new Promise<void>((resolve) => {
    resolveThird = resolve;
  });
  await page.route("**/api/v1/photos", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    started += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    if (started === 3) {
      resolveThird?.();
    }
    await gate.wait;
    await route.fulfill({
      contentType: "application/json",
      json: {
        deduplicated: false,
        job: {
          error: null,
          id: "10000000-0000-4000-8000-000000000001",
          photoId: "20000000-0000-4000-8000-000000000001",
          status: "completed",
        },
        photo: {
          capturedAt: "2026-08-18T00:00:00.000Z",
          checksum: "a".repeat(64),
          filename: "bulk-photo.jpg",
          format: "jpeg",
          height: 1,
          id: "20000000-0000-4000-8000-000000000001",
          importedAt: "2026-08-18T00:00:00.000Z",
          location: null,
          originalPath: "photos/bulk-photo.jpg",
          previewPath: "photos/previews/bulk-photo.webp",
          width: 1,
        },
      },
      status: 201,
    });
    active -= 1;
  });

  await page.getByTestId("photo-upload").evaluate((input) => {
    const transfer = new DataTransfer();
    for (let index = 0; index < 10_000; index += 1) {
      transfer.items.add(
        new File([new Uint8Array([255, 216, 255, 217])], `bulk-${index}.jpg`, {
          lastModified: 1_787_020_800_000 + index,
          type: "image/jpeg",
        }),
      );
    }
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("button", { name: /Upload 10000(?: new)?/ }).click();
  await eventWithin(
    thirdStarted,
    `expected three concurrent bulk photo requests, observed ${started}`,
    30_000,
  );

  const transferCenter = page.getByTestId("transfer-center");
  expect(await transferCenter.locator("[data-status]").count()).toBeLessThanOrEqual(23);
  await expect(transferCenter.getByTestId("transfer-batch-summary")).toContainText("10000");
  expect(maximumActive).toBe(3);

  gate.release();
  await expect(transferCenter.getByTestId("transfer-batch-summary")).toContainText(
    "10000 of 10000 photos uploaded",
    { timeout: 120_000 },
  );
  expect(started).toBe(10_000);
  expect(maximumActive).toBe(3);
  expect(await transferCenter.locator("[data-status]").count()).toBeLessThanOrEqual(20);

  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: `${evidenceDirectory}/transfer-10000-mobile.png`,
  });
  await writeFile(
    `${evidenceDirectory}/10k-action-log.json`,
    `${JSON.stringify(
      {
        completed: started,
        maximumActive,
        selected: 10_000,
        visibleRows: await transferCenter.locator("[data-status]").count(),
      },
      null,
      2,
    )}\n`,
  );
});
