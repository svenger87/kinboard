import { test, expect } from "@playwright/test";
import { establishSession } from "./session";

/**
 * A settings sub-page keeps its header (back button and name) in view while
 * it scrolls, so the way back is never a scroll to the top away (#282). At rest
 * the header has no backdrop and sits where it always did; once the page has
 * scrolled past it, it stays at the top of the screen with a backdrop. Pages
 * outside Settings are unchanged. Needs the stack (FAMILY_CODE) and a dev
 * server.
 */

const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

test("a long settings page keeps its back button in view while it scrolls", async ({ page }) => {
  // The kitchen screen's page size (1080×1920 at 150%), where the long pages are long.
  await page.setViewportSize({ width: 720, height: 1232 });
  await establishSession(page, familyCode!, "settings-sticky-header");
  await page.goto("/settings/screensaver");

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const header = page.locator("[data-stuck], h1").first().locator("xpath=ancestor-or-self::*[contains(@class,'sticky')][1]");
  await expect(header).toHaveCount(1);
  const restingTop = (await header.boundingBox())!.y;
  expect(restingTop).toBeGreaterThan(20);
  await expect(header).not.toHaveAttribute("data-stuck");

  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(scrollable, "the page must be long enough to scroll for this check to mean anything").toBeGreaterThan(300);
  await page.mouse.wheel(0, scrollable);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);

  await expect(header).toHaveAttribute("data-stuck", "");
  const box = (await header.boundingBox())!;
  expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
  await expect(heading).toBeInViewport();
  const back = header.locator('a[href="/settings"]');
  await expect(back).toBeInViewport();

  // Back at the top, it is plain again.
  await page.mouse.wheel(0, -scrollable - 100);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(header).not.toHaveAttribute("data-stuck");
});
