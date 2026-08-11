import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { z } from "zod";

const dataDir = process.env.MYNAS_BROWSER_DATA_DIR ?? "/tmp/mynas-playwright";
const ownerPassword = "synthetic browser owner passphrase";
const loginSchema = z.object({ token: z.string().min(32) });
const recordsSchema = z.array(z.object({ id: z.string() }).passthrough());
const setupStatusSchema = z.object({ setupComplete: z.boolean() });

export const syntheticJpegFilename = "합성-풍경-長い写真.jpg";
export const ingestSchema = z.object({
  job: z.object({
    id: z.string().uuid(),
    photoId: z.string().uuid(),
    status: z.literal("completed"),
  }),
  photo: z.object({
    checksum: z.string().length(64),
    id: z.string().uuid(),
  }),
});

const authorize = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

export const prepareOwnerAndMirror = async (request: APIRequestContext): Promise<string> => {
  await mkdir(`${dataDir}/disk-a`, { recursive: true });
  await mkdir(`${dataDir}/disk-b`, { recursive: true });

  const setupStatus = setupStatusSchema.parse(
    await (await request.get("/api/v1/setup/status")).json(),
  );
  if (!setupStatus.setupComplete) {
    const setup = await request.post("/api/v1/setup", {
      data: { password: ownerPassword, username: "owner" },
    });
    expect(setup.status()).toBe(201);
  }

  const login = await request.post("/api/v1/login", {
    data: { password: ownerPassword, username: "owner" },
  });
  expect(login.status()).toBe(200);
  const token = loginSchema.parse(await login.json()).token;
  const currentBackends = recordsSchema.parse(
    await (
      await request.get("/api/v1/backends", {
        headers: authorize(token),
      })
    ).json(),
  );

  for (const id of ["disk-a", "disk-b"]) {
    if (currentBackends.some((backend) => backend.id === id)) {
      continue;
    }
    const backend = await request.post("/api/v1/backends", {
      data: { id, kind: "local", root: `${dataDir}/${id}` },
      headers: authorize(token),
    });
    expect(backend.status()).toBe(201);
  }

  const currentVolumes = recordsSchema.parse(
    await (
      await request.get("/api/v1/volumes", {
        headers: authorize(token),
      })
    ).json(),
  );
  if (!currentVolumes.some((volume) => volume.id === "photos")) {
    const volume = await request.post("/api/v1/volumes", {
      data: { id: "photos", kind: "mirror", members: ["disk-a", "disk-b"] },
      headers: authorize(token),
    });
    expect(volume.status()).toBe(201);
  }
  return token;
};

export const verifyTokenLifecycle = async (page: Page): Promise<void> => {
  await page.getByLabel("Token name").fill("Browser QA");
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/tokens",
  );
  await page.getByRole("button", { name: "Create token" }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole("button", { name: "Revoke Browser QA" })).toBeVisible();

  const revoked = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname.startsWith("/api/v1/tokens/"),
  );
  await page.getByRole("button", { name: "Revoke Browser QA" }).click();
  expect((await revoked).status()).toBe(204);
  await expect(page.getByText("No active API tokens.")).toBeVisible();
};

export const verifyHealthyRepairAvailability = async (page: Page): Promise<void> => {
  await expect(page.getByRole("button", { name: "Repair" })).toBeEnabled();
  const scrubbed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/volumes/photos/scrub",
  );
  await page.getByRole("button", { name: "Scrub" }).click();
  expect((await scrubbed).status()).toBe(200);
  await expect(page.getByText(/Scrub completed: 0 corrupt, 0 missing/).first()).toBeVisible();
  const repaired = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/volumes/photos/repair",
  );
  const confirmation = page.waitForEvent("dialog");
  const clickRepair = page.getByRole("button", { name: "Repair" }).click();
  const dialog = await confirmation;
  expect(dialog.message()).toContain('Repair mirror "photos"');
  await dialog.accept();
  await clickRepair;
  expect((await repaired).status()).toBe(200);
  await expect(
    page.getByText("Repair completed: 0 repaired, 0 unrecoverable.").first(),
  ).toBeVisible();
};

export const verifyOriginalChecksum = (contents: Uint8Array, expected: string): string => {
  const actual = createHash("sha256").update(contents).digest("hex");
  expect(actual).toBe(expected);
  return actual;
};

export const revokeBrowserSession = async (
  page: Page,
  request: APIRequestContext,
  token: string,
): Promise<void> => {
  await page.getByTestId("nav-more-mobile").click();
  const logout = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/logout",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  expect((await logout).status()).toBe(204);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome back");
  const revoked = await request.get("/api/v1/system/status", {
    headers: authorize(token),
  });
  expect(revoked.status()).toBe(401);
};
