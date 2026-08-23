import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Route, test } from "@playwright/test";

import { prepareOwnerAndMirror } from "./photo-setup";

const artifactDirectory =
  process.env.MYNAS_BROWSER_PROTECTION_ARTIFACT_DIR ?? ".artifacts/qa/protection";

test("protection preserves failure and recovery as one actionable incident", async ({
  page,
  request,
}) => {
  const root = await mkdtemp(join(tmpdir(), "mynas-protection-browser-"));
  const backupDirectory = join(root, "backups");
  const detachedDirectory = join(root, "detached-backups");
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request_) => failedRequests.push(request_.url()));

  try {
    await mkdir(backupDirectory);
    const token = await prepareOwnerAndMirror(request);
    const authorized = { authorization: `Bearer ${token}` };
    const saved = await request.put("/api/v1/maintenance/policy", {
      data: {
        backupDirectory,
        backupIntervalHours: 24,
        enabled: true,
        retentionCount: 2,
        scrubIntervalHours: 168,
      },
      headers: authorized,
    });
    expect(saved.status()).toBe(200);
    await rename(backupDirectory, detachedDirectory);
    const failedRun = await request.post("/api/v1/maintenance/run", {
      headers: authorized,
    });
    expect(failedRun.status()).toBe(201);

    await page.addInitScript((sessionToken) => {
      window.localStorage.setItem("mynas.sessionToken", sessionToken);
    }, token);
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/protection");

    const protectionPage = page.getByTestId("protection-page");
    await expect(protectionPage).toBeVisible();
    await expect(page.getByTestId("protection-state")).toHaveAttribute("data-state", "attention");
    const activeIncident = page.getByTestId("incident-list").locator('[data-status="active"]');
    await expect(activeIncident).toHaveCount(1);
    await expect(activeIncident).toHaveAttribute("data-severity", "warning");
    await expect(activeIncident.locator('[data-field="severity"]')).toBeVisible();
    await expect(activeIncident.locator('[data-field="impact"]')).not.toBeEmpty();
    await expect(activeIncident.locator('[data-field="remediation"]')).not.toBeEmpty();
    await expect(activeIncident.locator("time")).toHaveCount(2);
    await expect(page.locator(".page-heading > svg")).toBeHidden();
    expect(
      await page
        .getByRole("region", { name: "Protection controls" })
        .evaluate((element) => getComputedStyle(element).borderTopStyle),
    ).toBe("solid");
    const monoFontStacks = await page.evaluate(() => {
      const stacks: Record<"ja" | "ko", string> = { ja: "", ko: "" };
      for (const language of ["ja", "ko"] as const) {
        const sample = document.createElement("span");
        sample.className = "mono";
        sample.lang = language;
        sample.textContent = "漢字";
        document.body.append(sample);
        stacks[language] = getComputedStyle(sample).fontFamily;
        sample.remove();
      }
      return stacks;
    });
    expect(monoFontStacks.ja.indexOf("Noto Sans JP")).toBeLessThan(
      monoFontStacks.ja.indexOf("Noto Sans KR"),
    );
    expect(monoFontStacks.ko.indexOf("Noto Sans KR")).toBeLessThan(
      monoFontStacks.ko.indexOf("Noto Sans JP"),
    );
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({
      fullPage: true,
      path: `${artifactDirectory}/protection-mobile-active.png`,
    });

    await rename(detachedDirectory, backupDirectory);
    const recoveredRun = await request.post("/api/v1/maintenance/run", {
      headers: authorized,
    });
    expect(recoveredRun.status()).toBe(201);
    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/incidents",
    );
    await page.getByTestId("refresh-protection").click();
    expect((await refreshed).status()).toBe(200);
    await expect(page.getByTestId("protection-state")).toHaveAttribute("data-state", "protected");
    await expect(page.getByTestId("incident-list").locator("li")).toHaveCount(0);

    await page.getByTestId("incident-status-filter").selectOption("resolved");
    const resolvedIncident = page.getByTestId("incident-list").locator('[data-status="resolved"]');
    await expect(resolvedIncident).toHaveCount(1);
    await page.setViewportSize({ height: 900, width: 1_440 });
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      fullPage: true,
      path: `${artifactDirectory}/protection-desktop-resolved.png`,
    });
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("protection never reports a safe state when its ledger is unavailable", async ({
  page,
  request,
}) => {
  const token = await prepareOwnerAndMirror(request);
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);
  await page.route("**/api/v1/incidents?*", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: { code: "internal_error", message: "incident ledger unavailable" },
      }),
      contentType: "application/json",
      status: 500,
    });
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/protection");

  await expect(page.getByTestId("protection-state")).toHaveAttribute("data-state", "unknown");
  await expect(page.getByRole("alert")).toBeVisible();
  const retry = page.getByTestId("retry-protection");
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("refresh-protection")).toHaveCount(0);
  await expect(page.locator(".page-heading > svg")).toBeHidden();
  expect(
    await retry.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await expect(page.locator('[data-empty-state="pristine"]')).toHaveCount(0);
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: `${artifactDirectory}/protection-mobile-unknown.png`,
  });
});

test("protection never claims safety while refresh responses are incomplete", async ({
  page,
  request,
}) => {
  const token = await prepareOwnerAndMirror(request);
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);
  const calls = { active: 0, all: 0 };
  let signalActiveRefresh: ((route: Route) => void) | null = null;
  let signalAllRefresh: ((route: Route) => void) | null = null;
  const activeRequested = new Promise<Route>((resolve) => {
    signalActiveRefresh = resolve;
  });
  const allRequested = new Promise<Route>((resolve) => {
    signalAllRefresh = resolve;
  });
  await page.route("**/api/v1/incidents?*", async (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    if (status !== "active" && status !== "all") {
      await route.abort();
      return;
    }
    calls[status] += 1;
    if (calls[status] === 1) {
      await route.fulfill({ body: "[]", contentType: "application/json", status: 200 });
      return;
    }
    if (status === "active") {
      signalActiveRefresh?.(route);
      return;
    }
    signalAllRefresh?.(route);
  });
  await page.goto("/protection");
  await expect(page.getByTestId("protection-state")).toHaveAttribute("data-state", "protected");

  await page.getByTestId("refresh-protection").click();
  const [activeRefresh, allRefresh] = await Promise.all([activeRequested, allRequested]);
  await expect(page.getByTestId("protection-state")).toHaveAttribute("data-state", "checking");
  await expect(page.getByTestId("protection-skeleton")).toBeVisible();
  await activeRefresh.fulfill({ body: "[]", contentType: "application/json", status: 200 });
  await expect(page.getByTestId("protection-state")).toHaveAttribute("data-state", "checking");
  await allRefresh.fulfill({ body: "[]", contentType: "application/json", status: 200 });
  await expect(page.getByTestId("protection-state")).toHaveAttribute("data-state", "protected");
});

test("protection state cannot hide an older active incident behind resolved history", async ({
  page,
  request,
}) => {
  const token = await prepareOwnerAndMirror(request);
  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem("mynas.sessionToken", sessionToken);
  }, token);
  const resolved = Array.from({ length: 100 }, (_, index) => ({
    firstSeenAt: "2026-08-23T00:00:00.000Z",
    id: crypto.randomUUID(),
    impact: "Resolved maintenance impact",
    kind: "catalog_backup_failed",
    lastSeenAt: new Date(Date.parse("2026-08-23T01:00:00.000Z") + index).toISOString(),
    occurrenceCount: 1,
    remediation: "No action required",
    resolvedAt: new Date(Date.parse("2026-08-23T01:00:00.000Z") + index).toISOString(),
    severity: "warning",
    status: "resolved",
    title: "Resolved incident",
  }));
  const active = {
    ...resolved[0],
    id: crypto.randomUUID(),
    lastSeenAt: "2026-08-22T00:00:00.000Z",
    remediation: "Run a catalog backup now",
    resolvedAt: null,
    status: "active",
    title: "Older active incident",
  };
  await page.route("**/api/v1/incidents?*", async (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    await route.fulfill({
      body: JSON.stringify(status === "active" ? [active] : resolved),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/protection");

  await expect(page.getByTestId("protection-state")).toHaveAttribute("data-state", "attention");
  await expect(page.getByTestId("incident-list").getByText("Older active incident")).toBeVisible();
  await expect(page.getByText("Run a catalog backup now")).toBeVisible();
  await page.getByTestId("incident-status-filter").selectOption("all");
  await expect(page.getByTestId("incident-list").getByText("Older active incident")).toBeVisible();
});
