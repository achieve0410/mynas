import { mkdir, readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { z } from "zod";

import { prepareOwnerAndMirror } from "./photo-setup";

const artifactDirectory = ".artifacts/qa/files";
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
