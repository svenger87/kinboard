import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The day timeline's hour gutter has to fit the label it is given.
 *
 * The gutter was built for "14": a 24px box (`w-6`) inside a 32px margin
 * (`ml-8`). `formatHourLabel` returns "2 PM" on a 12-hour clock, which does not
 * fit, so every label wrapped at its space and the two lines ran into the row
 * below — issue #229. `text-3xs` is 11px here and 13px above 1280px wide (see
 * the floor in globals.css), so the 12-hour gutter is sized for the larger.
 *
 * The 24-hour gutter is deliberately untouched: it fits, and it was tuned.
 */

const source = readFileSync("src/app/calendar/page.tsx", "utf8");

/**
 * The hour-label span on the day timeline.
 *
 * Matched loosely — any opening `<span>` carrying `text-3xs` and `tabular-nums`
 * — so that a regression fails on the assertion that explains the problem
 * rather than on the extraction, which would only say the element moved.
 */
const labelSpan = (() => {
  const m = source.match(/<span className=[^>]*text-3xs[^>]*tabular-nums[^>]*>/);
  expect(m, "could not find the day timeline's hour label — did it move?").toBeTruthy();
  return m![0];
})();

test("the hour gutter widens for a 12-hour label", () => {
  expect(
    labelSpan,
    "the hour label should get a wider box when the clock is not 24-hour",
  ).toMatch(/use24Hour \? "-left-8 w-6" : "-left-12 w-11"/);
  expect(
    source,
    "the timeline's left margin should widen with the gutter, or the labels sit " +
      "outside the page",
  ).toMatch(/use24Hour \? "ml-8" : "ml-12"/);
});

test("an hour label never wraps", () => {
  // Wrapping is the failure mode: "2 PM" silently became two lines rather than
  // overflowing somewhere visible, which is why it shipped.
  expect(labelSpan, "the hour label should be whitespace-nowrap").toContain(
    "whitespace-nowrap",
  );
});
