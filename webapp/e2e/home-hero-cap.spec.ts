import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The dashboard hero takes its natural height. Nothing may squash it.
 *
 * `flex-1` let the clock block absorb all the spare height, which on a
 * 1920x1080 panel took 47% of the screen and pushed the second widget row off
 * the bottom (audit KB-01). `flex: 0 0 auto` prevents that directly.
 *
 * Two attempts to also cap it went wrong, and both are worth remembering.
 *
 * `max-height: 38vh` was sized against the wall panel, where the hero's ~460px
 * of clock, family row and Today strip fits by a single pixel. Every desktop
 * browser is shorter than the panel it emulates, so the cap landed under the
 * content and the surplus spilled out under the widget grid (#231).
 *
 * Adding `min-height: min-content` as a floor fixed that in Chromium and did
 * nothing at all in WebKit, which does not honour an intrinsic `min-height`
 * against a `max-height` on this flex item. Measured in both engines:
 *
 *   engine     1280x800   1440x810   1440x900   1920x1080
 *   chromium   -24px      -24px      -24px      -24px      (fixed)
 *   webkit      54px       52px       35px        1px      (identical to no fix)
 *
 * It shipped because it was only ever checked in Chromium. So: no cap, no
 * viewport units, no intrinsic sizing, and no second rule to disagree with the
 * first.
 */

const css = readFileSync("src/app/globals.css", "utf8");

/** The `.hero-block` rule inside the landscape media query. */
const heroRule = (() => {
  const m = css.match(/@media \(orientation: landscape\)[^{]*\{\s*\.hero-block\s*\{([^}]*)\}/);
  expect(m, "could not find the .hero-block rule — did the media query move?").toBeTruthy();
  return m![1];
})();

test("the hero cannot grow into the widget grid's space", () => {
  // The whole reason the rule exists (KB-01).
  expect(heroRule, "the hero must not be allowed to absorb spare height").toMatch(
    /flex:\s*0 0 auto/,
  );
});

test("nothing caps the hero's height", () => {
  /*
    A cap is what broke this twice. The hero's content is sized in px and does
    not shrink with the viewport, so any ceiling expressed in vh eventually
    lands underneath it — and the block has `justify-content: center` and no
    overflow rule, so the surplus is painted over by whatever follows.
  */
  expect(
    heroRule,
    "`.hero-block` has a max-height again. Its content is px-sized and the cap " +
      "would be vh-sized, which is the shape of #231 — the Today strip ends up " +
      "underneath the first row of widgets on every desktop browser.",
  ).not.toMatch(/max-height/);
});

test("it does not rely on intrinsic sizing to protect itself", () => {
  /*
    `min-height: min-content` reads like a floor and is one only in Chromium.
    In WebKit it is ignored against a max-height here, so a fix built on it is
    a fix that does not exist on every Mac and iPad in the house.
  */
  expect(
    heroRule,
    "`min-content` sizing does not behave the same in WebKit; the hero must not " +
      "depend on it",
  ).not.toMatch(/min-content/);
});
