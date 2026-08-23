import { expect, test } from "@playwright/test";

import { prepareOwnerAndMirror } from "./photo-setup";

test("settings changes the owner password and returns to login", async ({ page, request }) => {
  const token = await prepareOwnerAndMirror(request);
  await page.goto("/login");
  await page.evaluate((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);
  await page.goto("/settings");

  await page.getByLabel("Current password").fill("synthetic browser owner passphrase");
  await page.getByLabel("New password", { exact: true }).fill("updated browser owner passphrase");
  await page.getByLabel("Confirm new password").fill("updated browser owner passphrase");

  const changed = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/api/v1/password",
  );
  await page.getByRole("button", { name: "Change password" }).click();
  expect((await changed).status()).toBe(204);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome back");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("updated browser owner passphrase");
  const loggedIn = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/login",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await loggedIn).status()).toBe(200);
  await expect(page).toHaveURL("/");

  await page.goto("/settings");
  await page.getByLabel("Current password").fill("updated browser owner passphrase");
  await page.getByLabel("New password", { exact: true }).fill("synthetic browser owner passphrase");
  await page.getByLabel("Confirm new password").fill("synthetic browser owner passphrase");
  const restored = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/api/v1/password",
  );
  await page.getByRole("button", { name: "Change password" }).click();
  expect((await restored).status()).toBe(204);
});
