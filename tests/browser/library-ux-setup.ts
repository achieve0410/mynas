import { mkdir } from "node:fs/promises";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import sharp from "sharp";

import { syntheticJpeg } from "../fixtures/synthetic-photo";
import { ingestSchema, prepareOwnerAndMirror } from "./photo-setup";

export const LIBRARY_ARTIFACT_DIR =
  process.env.MYNAS_BROWSER_PHOTOS_ARTIFACT_DIR ?? ".artifacts/qa/library";

const authorize = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

export const authenticateLibraryPage = async (
  page: Page,
  request: APIRequestContext,
): Promise<string> => {
  const token = await prepareOwnerAndMirror(request);
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);
  return token;
};

export const uploadFileFixture = async (
  request: APIRequestContext,
  token: string,
  path: string,
  contents = "friendly file contents",
): Promise<void> => {
  const response = await request.put(`/api/v1/files/photos/${path}`, {
    data: contents,
    headers: authorize(token),
  });
  expect(response.status()).toBe(201);
};

export const createPhotoFixture = async (filename: string): Promise<Buffer> => {
  const marker = [...filename].reduce(
    (hash, character) => (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0,
    2_166_136_261,
  );
  return sharp(Buffer.from(syntheticJpeg()))
    .resize({
      fit: "fill",
      height: 32 + ((marker >>> 5) & 31),
      width: 32 + (marker & 31),
    })
    .tint({
      b: 64 + ((marker * 7) % 192),
      g: 64 + ((marker * 5) % 192),
      r: 64 + ((marker * 3) % 192),
    })
    .jpeg()
    .toBuffer();
};

export const uploadPhotoFixture = async (
  request: APIRequestContext,
  token: string,
  filename: string,
): Promise<string> => {
  const contents = await createPhotoFixture(filename);
  const response = await request.post("/api/v1/photos", {
    data: contents,
    headers: {
      ...authorize(token),
      "content-type": "image/jpeg",
      "x-mynas-filename": encodeURIComponent(filename),
    },
  });
  expect(response.status()).toBe(201);
  return ingestSchema.parse(await response.json()).photo.id;
};

export const captureLibraryScreenshot = async (page: Page, filename: string): Promise<void> => {
  await mkdir(LIBRARY_ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ fullPage: true, path: `${LIBRARY_ARTIFACT_DIR}/${filename}` });
};
