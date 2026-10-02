import { test, expect, type Page } from "@playwright/test";
import { establishSession } from "./session";

/**
 * Leaving a page with a drag-to-reorder list left the next page blank.
 *
 * The page shell fades each route in and out inside an AnimatePresence with
 * mode="wait". A Reorder.Item is a layout component: it registered with that
 * presence and, on the way out, never reported that it was done. So the old
 * page's fade-out finished, the next page's wrapper never mounted, and the new
 * route's content rendered inside the old wrapper at opacity 0 -- the
 * background and the bottom bar, nothing else, until a reload. Settings ->
 * Widgets and Settings -> Navigation both have such a list.
 *
 * Only a rendered page can show this: every element is there, just drawn at
 * opacity 0, so a check for the page's heading passes either way.
 */
const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

/** How opaque the page's content is actually drawn: every ancestor's opacity, multiplied. */
function drawnOpacity(page: Page): Promise<number> {
  return page.evaluate(() => {
    let opacity = 1;
    for (let el: Element | null = document.querySelector("main"); el && el !== document.body; el = el.parentElement) {
      opacity *= Number(getComputedStyle(el).opacity);
    }
    return opacity;
  });
}

test.describe("route transitions", () => {
  // Skipped without a stack, like the other layout specs: FAMILY_CODE is how
  // this suite knows there is one to talk to.
  test.skip(!FAMILY_CODE, "needs a running stack");

  for (const path of ["/settings/widgets", "/settings/navigation"]) {
    test(`the next page shows after leaving ${path}`, async ({ page }, testInfo) => {
      await establishSession(page, FAMILY_CODE, `Route transition ${testInfo.project.name}`);
      await page.goto("/settings");
      // In-app navigation both ways: a full page load mounts a fresh shell,
      // which is why a reload was the way out.
      await page.locator(`a[href="${path}"]`).first().click();
      await page.waitForURL(`**${path}`);
      await page.locator('nav a[href="/calendar"]:visible').first().click();
      await page.waitForURL("**/calendar");
      await expect.poll(() => drawnOpacity(page), { timeout: 5000 }).toBe(1);
    });
  }
});
