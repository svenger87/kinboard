import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The home widget grid sizes itself against its container, not the viewport.
 *
 * It was `w-[min(96vw,2200px)]`, inside a wrapper that already has `p-4`. So
 * it measured the window while its container measured `100vw - 32px`, and
 * below 800px the viewport unit won: `mx-auto` cannot centre a child wider
 * than its container, so the grid pinned left and ran under the right-hand
 * padding. Every card sat 16px from the left and 0px from the right, clipped
 * by main's `overflow-hidden`.
 *
 * The threshold is why it shipped: `0.96 * vw > vw - 32` only holds below
 * 800px, so the wall display and every desktop looked correct and only phones
 * and small tablets were wrong.
 *
 * A viewport unit is the wrong tool for any width inside a padded wrapper.
 * `w-full` inherits the padding that is already there.
 */

const source = readFileSync("src/app/page.tsx", "utf8");
/**
 * The loading skeleton draws the same grid. It has to match the real one's
 * width, not just its columns — when it did not, the cards shifted sideways
 * the moment loading finished, which is the jump it exists to prevent.
 */
const skeleton = readFileSync("src/components/auth-guard.tsx", "utf8");

/** The widget grid's class string. */
const gridClass = (() => {
  const m = source.match(/<section className="([^"]*auto-rows-min[^"]*)"/);
  expect(m, "could not find the widget grid's class string — did it move?").toBeTruthy();
  return m![1];
})();

test("the widget grid does not size itself in viewport units", () => {
  const vwWidth = gridClass.match(/\bw-\[[^\]]*vw[^\]]*\]/);
  expect(
    vwWidth?.[0],
    `the widget grid sizes with a viewport unit (${vwWidth?.[0]}) inside a padded ` +
      `wrapper, so it overflows the padding on viewports below ~800px`,
  ).toBeUndefined();
});

test("the loading skeleton's grid is sized like the real one", () => {
  const m = skeleton.match(/<section className="(mt-auto grid[^"]*)"/);
  expect(m, "could not find the skeleton grid's class string — did it move?").toBeTruthy();
  const cls = m![1];
  const vw = cls.match(/\bw-\[[^\]]*vw[^\]]*\]/);
  expect(
    vw?.[0],
    `the skeleton grid sizes with a viewport unit (${vw?.[0]}), so it overflows ` +
      `the padding the real grid respects and the cards jump when loading ends`,
  ).toBeUndefined();
  expect(cls).toContain("w-full");
});

test("it fills its container and keeps the large-panel cap", () => {
  expect(gridClass, "the grid should take its container's width").toContain("w-full");
  // The 2200px cap exists so a 2560px kiosk does not leave dead margin (KB-02).
  expect(gridClass, "the large-panel cap was dropped").toMatch(/max-w-\[2200px\]/);
});
