import { test, expect } from "@playwright/test";
import { joinFamilyViaUI } from "./helpers";

/**
 * The dashboard hero and the widget grid must not occupy the same pixels.
 *
 * `home-hero-cap.spec.ts` next to this one reads the CSS and forbids the two
 * shapes that broke it. This one renders the page and measures, because the CSS
 * rule being right is not the same claim as the layout being right — and the
 * gap between those two claims is where this bug lived for a release.
 *
 * The history: `max-height: 38vh` was sized against the wall panel and landed
 * under the hero's px-sized content on every shorter screen, so the Today strip
 * spilled and the widget grid painted over it (#231). The fix for that added
 * `min-height: min-content`, which Chromium honours and WebKit does not — so it
 * shipped in rc.20 looking fixed and was still broken on every Mac and iPad:
 *
 *   engine     1280x800   1440x810   1440x900   1920x1080
 *   chromium     -24px      -24px      -24px      -24px
 *   webkit        54px       52px       35px        1px
 *
 * Run this under `--project=webkit` as well as the Chromium projects. A test
 * that only ever runs in one engine cannot see a difference between engines.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
const DEVICE_NAME = process.env.PLAYWRIGHT_DEVICE_NAME ?? "Hero Layout Test";

test.describe("the dashboard hero", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE to reach the dashboard");

  test("does not overlap the widget grid", async ({ page }) => {
    await joinFamilyViaUI(page, FAMILY_CODE, DEVICE_NAME);
    await page.goto("/");
    await page.waitForSelector(".hero-block", { timeout: 20_000 });
    // The clock and the Today strip settle after their data arrives; measuring
    // before that reads a hero that has not reached its full height yet.
    await page.waitForTimeout(2500);

    const m = await page.evaluate(() => {
      const hero = document.querySelector(".hero-block");
      const grid = document.querySelector("section.grid[aria-label]");
      if (!hero || !grid) return null;
      // The hero's own box may be clamped; what matters is where its children
      // are actually painted, which is what spills when the clamp is wrong.
      const contentBottom = Math.max(
        ...[...hero.children].map((c) => c.getBoundingClientRect().bottom),
      );
      const cs = getComputedStyle(hero);
      return {
        overlap: Math.round(contentBottom - grid.getBoundingClientRect().top),
        heroHeight: Math.round(hero.getBoundingClientRect().height),
        maxHeight: cs.maxHeight,
        minHeight: cs.minHeight,
      };
    });

    expect(m, "could not find the hero block or the widget grid").not.toBeNull();
    expect(
      m!.overlap,
      `the hero's content runs ${m!.overlap}px into the widget grid — the grid ` +
        `carries the same z-index and comes later in the DOM, so it is painted ` +
        `over the Today strip. hero=${m!.heroHeight}px max-height=${m!.maxHeight} ` +
        `min-height=${m!.minHeight}`,
    ).toBeLessThanOrEqual(0);
  });
});
