/**
 * Visual audit script for the kinboard webapp.
 *
 * Joins a family ONCE via code from FAMILY_CODE env var, saves auth
 * state, then screenshots every page reusing that session. Screenshots
 * land in e2e/screenshots/.
 *
 * Usage:
 *   FAMILY_CODE=ABC123 npx playwright test e2e/visual-audit.spec.ts --project=desktop
 *   FAMILY_CODE=ABC123 npx playwright test e2e/visual-audit.spec.ts --project=mobile
 *   FAMILY_CODE=ABC123 npx playwright test e2e/visual-audit.spec.ts   # both
 */

import { test, expect, Page, BrowserContext } from "@playwright/test";
import path from "path";
import fs from "fs";
import { joinFamilyViaUI } from "./helpers";

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
if (!FAMILY_CODE) {
  throw new Error("FAMILY_CODE env var must be set to a 6-character family join code");
}
const DEVICE_NAME = "Claude Visual Auditor";
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");
const AUTH_STATE_FILE = path.join(__dirname, ".auth-state.json");

// All authenticated routes to capture
const ROUTES = [
  "/",
  "/calendar",
  "/todos",
  "/meals",
  "/recipes",
  "/recipes/new",
  "/recipes/search",
  "/shopping",
  "/birthdays",
  "/weather",
  "/energy",
  "/tesla",
  "/home-automation",
  "/cameras",
  "/schedule",
  "/settings",
  "/settings/people",
  "/settings/devices",
  "/settings/theme",
  "/settings/weather",
  "/settings/google",
  "/settings/homeassistant",
  "/settings/homeassistant/rooms",
  "/settings/homeassistant/energy",
  "/settings/tesla",
  "/settings/cameras",
  "/settings/immich",
  "/settings/screensaver",
  "/settings/notifications",
  "/settings/schedule",
  "/settings/bring",
];

async function ensureAuth(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();

  // Try loading saved auth state first
  if (fs.existsSync(AUTH_STATE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(AUTH_STATE_FILE, "utf-8"));
    await context.addCookies(cookies);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // If we're NOT redirected to /join, auth is still valid
    if (!page.url().includes("/join")) {
      return page;
    }
  }

  // Need to join fresh
  await page.goto("/join");
  await page.waitForLoadState("networkidle");

  if (!page.url().includes("/join")) {
    // Already authed somehow
    const cookies = await context.cookies();
    fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(cookies, null, 2));
    return page;
  }

  await joinFamilyViaUI(page, FAMILY_CODE, DEVICE_NAME);

  // Save cookies so subsequent tests reuse this device
  const cookies = await context.cookies();
  fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(cookies, null, 2));

  return page;
}

// Use a single shared context for all tests to avoid device spam
test.describe.configure({ mode: "serial" });

let sharedPage: Page;

test.describe("Visual Audit", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();

    // Load saved auth cookies if available
    if (fs.existsSync(AUTH_STATE_FILE)) {
      const cookies = JSON.parse(fs.readFileSync(AUTH_STATE_FILE, "utf-8"));
      await context.addCookies(cookies);
    }

    sharedPage = await context.newPage();

    // Check if auth is valid
    await sharedPage.goto("/");
    await sharedPage.waitForLoadState("networkidle");

    if (sharedPage.url().includes("/join")) {
      // Need to join
      await joinFamilyViaUI(sharedPage, FAMILY_CODE, DEVICE_NAME);

      // Save cookies for future runs
      const cookies = await sharedPage.context().cookies();
      fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(cookies, null, 2));
    }
  });

  test.afterAll(async () => {
    await sharedPage?.context().close();
  });

  for (const route of ROUTES) {
    test(`screenshot ${route}`, async ({}, testInfo) => {
      await sharedPage.goto(route);
      await sharedPage.waitForLoadState("networkidle");
      // Settle time for animations
      await sharedPage.waitForTimeout(1000);

      const safeName = route === "/" ? "dashboard" : route.replace(/\//g, "_").slice(1);
      const project = testInfo.project.name;

      await sharedPage.screenshot({
        path: path.join(SCREENSHOT_DIR, project, `${safeName}.png`),
        fullPage: true,
      });
    });
  }
});
