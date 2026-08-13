import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { z } from "zod";

import { prepareOwnerAndMirror } from "./photo-setup";

const artifactDirectory = process.env.MYNAS_BROWSER_FILES_ARTIFACT_DIR ?? ".artifacts/qa/files";
const filePath = "documents/복구-履歴.txt";
const versionSchema = z.object({ id: z.string().uuid() });

const authorize = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

test("files workflow browses folders and restores a downloadable version", async ({
  page,
  request,
}) => {
  const token = await prepareOwnerAndMirror(request);
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);

  const original = await request.put(`/api/v1/files/photos/${filePath}`, {
    data: "original recoverable bytes",
    headers: authorize(token),
  });
  expect(original.status()).toBe(201);
  const originalVersion = versionSchema.parse(await original.json());
  const current = await request.put(`/api/v1/files/photos/${filePath}`, {
    data: "current disposable bytes",
    headers: authorize(token),
  });
  expect(current.status()).toBe(201);

  await page.goto("/files");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Files");
  await page.getByLabel("Volume").selectOption("photos");
  await page.getByRole("button", { name: "documents" }).click();
  await page.getByRole("button", { name: "복구-履歴.txt" }).click();

  const history = page.getByRole("region", { name: "Version history" });
  await expect(history.getByRole("listitem")).toHaveCount(2);

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });
  const restoredResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/versions/photos/restore",
  );
  await history.getByRole("button", { name: `Restore version ${originalVersion.id}` }).click();
  expect((await restoredResponse).status()).toBe(201);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current file" }).click();
  const downloaded = await download;
  await mkdir(artifactDirectory, { recursive: true });
  const downloadPath = `${artifactDirectory}/restored-file.txt`;
  await downloaded.saveAs(downloadPath);
  expect(await readFile(downloadPath, "utf8")).toBe("original recoverable bytes");

  await page.getByRole("button", { name: "documents", exact: true }).click();
  const batchUploads: number[] = [];
  const filesUploaded = new Promise<void>((resolve) => {
    const record = (response: import("@playwright/test").Response): void => {
      if (
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname.startsWith("/api/v1/files/photos/documents/")
      ) {
        batchUploads.push(response.status());
        if (batchUploads.length === 2) {
          page.off("response", record);
          resolve();
        }
      }
    };
    page.on("response", record);
  });
  await page.getByTestId("file-upload").setInputFiles([
    { buffer: Buffer.from("alpha"), mimeType: "text/plain", name: "alpha.txt" },
    { buffer: Buffer.from("beta"), mimeType: "text/plain", name: "beta.txt" },
  ]);
  await page.getByRole("button", { name: "Upload 2 protected items" }).click();
  await filesUploaded;
  expect(batchUploads).toEqual([201, 201]);
  await expect(page.getByRole("button", { name: "alpha.txt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "beta.txt" })).toBeVisible();

  const uploadFolder = join(artifactDirectory, "folder-source");
  await mkdir(join(uploadFolder, "nested"), { recursive: true });
  await writeFile(join(uploadFolder, "nested", "kept.txt"), "directory bytes");
  await writeFile(join(uploadFolder, "too-large.bin"), Buffer.alloc(64 * 1_024 * 1_024 + 1));
  const directoryStatuses: number[] = [];
  const directoryUploaded = new Promise<void>((resolve) => {
    const record = (response: import("@playwright/test").Response): void => {
      if (
        response.request().method() === "PUT" &&
        decodeURIComponent(new URL(response.url()).pathname).includes("/documents/folder-source/")
      ) {
        directoryStatuses.push(response.status());
        if (directoryStatuses.length === 2) {
          page.off("response", record);
          resolve();
        }
      }
    };
    page.on("response", record);
  });
  await page.getByTestId("file-directory-upload").setInputFiles(uploadFolder);
  await page.getByRole("button", { name: "Upload 2 protected items" }).click();
  await directoryUploaded;
  expect(directoryStatuses.toSorted()).toEqual([201, 413]);
  await expect(page.getByText("1 of 2 files uploaded.")).toBeVisible();
  await expect(page.getByText("documents/folder-source/too-large.bin")).toBeVisible();
  await expect(page.getByRole("button", { name: "folder-source" })).toBeVisible();

  await page.getByLabel("Select folder-source").check();
  await page.getByLabel("Select alpha.txt").check();
  const archiveStarted = page.waitForEvent("download");
  const archiveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/volumes/photos/archive",
  );
  await page.getByRole("button", { name: "Download selected" }).click();
  expect((await archiveResponse).status()).toBe(200);
  const archive = await archiveStarted;
  expect(archive.suggestedFilename()).toBe("mynas-files.zip");

  await page.screenshot({
    fullPage: true,
    path: `${artifactDirectory}/files-desktop.png`,
  });

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    fullPage: true,
    path: `${artifactDirectory}/files-mobile.png`,
  });
});
