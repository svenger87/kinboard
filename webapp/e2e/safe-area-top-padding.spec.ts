import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * `.safe-area-inset` must not set an unconditional `padding-top` on the page
 * shell.
 *
 * The declaration is `padding-top: env(safe-area-inset-top, 0)`. On a device
 * with no notch that resolves to 0, so it did not *add* an inset — it replaced
 * the shell's `pt-16` with nothing. Measured on a 390px viewport, main's
 * computed padding-top was 0px and the page heading and its icon sat
 * underneath the floating back button that settings/layout.tsx draws over the
 * top-left corner. Desktop escaped it only because `md:pt-20` sorts after this
 * rule in the utilities layer — so it looked correct on the wall display and
 * was broken on every phone.
 *
 * Left and right already floor with `max(1rem, …)`. Top cannot floor at a
 * constant, because the 100 elements sharing this class want different
 * clearances, so the shell keeps its own padding and everything else keeps the
 * inset.
 *
 * This asserts the source rather than the rendering, which is the weaker test:
 * a cascade fault is only truly visible in a browser at a mobile viewport.
 * Asserting computed padding-top belongs in the smoke suite, which has a
 * running stack; this at least fails if the guard is deleted.
 */

const css = readFileSync("src/app/globals.css", "utf8");

test("the safe-area top inset does not clobber the page shell's padding", () => {
  const rule = css.slice(css.indexOf(".safe-area-inset {"));
  const block = rule.slice(0, rule.indexOf("\n  }"));

  expect(block, ".safe-area-inset no longer scopes its padding-top away from <main>").toContain(
    "&:not(main)",
  );

  // The bare declaration, outside the :not(main) guard, is the regression.
  const guarded = block.slice(block.indexOf("&:not(main)"));
  const beforeGuard = block.slice(0, block.indexOf("&:not(main)"));
  expect(
    /padding-top\s*:/.test(beforeGuard),
    "padding-top is set unconditionally again — this collapses pt-16 to 0 on any device without a notch",
  ).toBe(false);
  expect(guarded).toMatch(/padding-top\s*:\s*env\(safe-area-inset-top/);
});
