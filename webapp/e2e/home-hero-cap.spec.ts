import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The dashboard hero's height cap must not be able to cut into its content.
 *
 * `.hero-block` is capped at `max-height: 38vh` on landscape viewports wider
 * than 1024px, so the clock block cannot absorb the height the widget grid
 * needs (audit KB-01). The cap was written against the 1920x1080 wall panel,
 * where 38vh is 410px and the hero's content is 411px — it fit by a pixel.
 *
 * Every desktop browser is shorter than the panel it is emulating, because
 * window chrome takes its cut, and the hero's content does not shrink with the
 * viewport: it is a clock, a row of family avatars and the Today strip, all
 * sized in px. So the cap landed under the content on every real desktop
 * window, and with `justify-content: center` and no overflow rule the surplus
 * spilled out of the block. The widget grid is laid out from the clamped edge
 * and carries the same `z-[1]`, so DOM order put it on top of the Today strip.
 * Measured overlap: 28px at 1920x937, 35px at 1600x900, 60px at 1366x768,
 * 73px at 1440x700.
 *
 * `min-height: min-content` is the floor that makes the cap safe. It is free:
 * the cap only ever bound where it was clipping, so on a viewport tall enough
 * for 38vh to clear the content it was already inert.
 *
 * Static, like home-widget-grid-width.spec.ts, so the fast suite keeps running
 * without a stack.
 */

const css = readFileSync("src/app/globals.css", "utf8");

/** The `.hero-block` rule inside the landscape media query. */
const heroRule = (() => {
  const m = css.match(/@media \(orientation: landscape\)[^{]*\{\s*\.hero-block\s*\{([^}]*)\}/);
  expect(m, "could not find the .hero-block cap — did the media query move?").toBeTruthy();
  return m![1];
})();

test("the hero cap has a content floor under it", () => {
  expect(heroRule, "the hero cap is still there").toMatch(/max-height:\s*38vh/);
  expect(
    heroRule.match(/min-height:\s*min-content/),
    "`.hero-block` caps its height without a `min-height: min-content` floor, so " +
      "on any viewport shorter than ~1080px the cap lands under the hero's own " +
      "content and the Today strip spills under the widget grid",
  ).toBeTruthy();
});

test("the cap is not expressed as a bare viewport unit against px content", () => {
  // max(38vh, min-content) reads like a floor but resolves to the cap alone in
  // Chromium — measured identical overlap to no fix at all. If someone reaches
  // for it again, this says why it does not work.
  expect(
    heroRule,
    "`max(38vh, min-content)` does not floor a max-height in Chromium; use a " +
      "separate `min-height: min-content`",
  ).not.toMatch(/max-height:\s*max\(/);
});
