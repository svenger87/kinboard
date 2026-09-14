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

import { test, expect, Page } from "@playwright/test";
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

// Authenticated routes that render without a record ID.
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
  "/home-automation",
  "/cameras",
  "/schedule",
  "/media",
  "/photos",
  "/news",
  "/notes",
  "/pocket-money",
  "/stonks",
  "/vehicles",
  "/settings",
  "/settings/people",
  "/settings/devices",
  "/settings/theme",
  "/settings/language",
  "/settings/navigation",
  "/settings/widgets",
  "/settings/integrations",
  "/settings/calendar",
  "/settings/caldav",
  "/settings/ics",
  "/settings/weather",
  "/settings/google",
  "/settings/homeassistant",
  "/settings/homeassistant/rooms",
  "/settings/vehicles",
  "/settings/media-players",
  "/settings/photos",
  "/settings/news",
  "/settings/pocket-money",
  "/settings/stonks",
  "/settings/cameras",
  "/settings/screensaver",
  "/settings/notifications",
  "/settings/schedule",
  "/settings/bring",
  "/settings/catalogue",
  "/settings/plugins",
  "/settings/recycle-bin",
  "/settings/hints",
];

test.describe("Visual Audit", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ context }) => {
    if (fs.existsSync(AUTH_STATE_FILE)) {
      await context.addCookies(JSON.parse(fs.readFileSync(AUTH_STATE_FILE, "utf-8")));
    }
  });

  for (const route of ROUTES) {
    test(`capture ${route}`, async ({ page, context }, testInfo) => {
      await page.goto(route);
      if (page.url().includes("/join")) {
        await joinFamilyViaUI(page, FAMILY_CODE, DEVICE_NAME);
        fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(await context.cookies(), null, 2));
        await page.goto(route);
      }
      await page.waitForLoadState("networkidle");
      await expect(page, `${route} redirected away from the authenticated page`).toHaveURL(
        new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`),
      );
      await expect
        .poll(
          async () => {
            const text = (await page.locator("body").innerText())
              .replace(/skip to main content/i, "")
              .trim();
            return text.length > 0 && !/^loading[….]*$/i.test(text);
          },
          { timeout: 15_000, message: `${route} remained on an empty or loading shell` },
        )
        .toBe(true);
      await page.waitForTimeout(300);

      const viewport = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(
        viewport.scrollWidth,
        `${route} overflows the viewport horizontally (${viewport.scrollWidth}px > ${viewport.clientWidth}px)`,
      ).toBeLessThanOrEqual(viewport.clientWidth);

      const safeName = route === "/" ? "dashboard" : route.replace(/\//g, "_").slice(1);
      const project = testInfo.project.name;

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, project, `${safeName}.png`),
        fullPage: true,
      });

      if (project === "mobile") {
        await page.setViewportSize({ width: 320, height: 700 });
        await page.waitForTimeout(100);
        const compactViewport = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(
          compactViewport.scrollWidth,
          `${route} overflows a compact phone (${compactViewport.scrollWidth}px > ${compactViewport.clientWidth}px)`,
        ).toBeLessThanOrEqual(compactViewport.clientWidth);
      }
    });
  }
});
