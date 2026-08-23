import { expect, test } from "@playwright/test";

import { authenticateLibraryPage } from "./library-ux-setup";

const isFileListResponse = (url: string): boolean =>
  new URL(url).pathname === "/api/v1/volumes/photos/files";

test("an active client sees a file uploaded by another client", async ({ browser, request }) => {
  const baseURL = process.env.MYNAS_BROWSER_BASE_URL ?? "http://127.0.0.1:7331";
  const uploaderContext = await browser.newContext({ baseURL });
  const observerContext = await browser.newContext({ baseURL });
  const uploader = await uploaderContext.newPage();
  const observer = await observerContext.newPage();

  try {
    const token = await authenticateLibraryPage(uploader, request);
    await observer.addInitScript((sessionToken) => {
      window.localStorage.setItem("mynas.sessionToken", sessionToken);
    }, token);

    await Promise.all([
      uploader.waitForResponse((response) => isFileListResponse(response.url())),
      uploader.goto("/files"),
      observer.waitForResponse((response) => isFileListResponse(response.url())),
      observer.goto("/files"),
    ]);

    await uploader.getByTestId("file-upload").setInputFiles({
      buffer: Buffer.from("cross-client contents"),
      mimeType: "text/plain",
      name: "cross-client.txt",
    });
    await uploader.getByRole("button", { name: "Upload 1 protected item" }).click();
    await expect(uploader.getByTestId("transfer-file-cross-client.txt")).toHaveAttribute(
      "data-status",
      "complete",
    );

    const observerRefresh = observer.waitForResponse(
      (response) => isFileListResponse(response.url()),
      { timeout: 5_000 },
    );
    await observerRefresh;
    await expect(observer.getByRole("button", { name: "cross-client.txt" })).toBeVisible();
  } finally {
    await Promise.all([uploaderContext.close(), observerContext.close()]);
  }
});
