import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The day timeline on the calendar page draws one block per timed event.
 *
 * Every block was `absolute left-1 right-0`, i.e. the full width of the strip,
 * so two events at the same hour were painted in the same place: whichever
 * sorted last won and the rest became an unreadable pile of overlapping
 * titles. Three overlapping events on a 1080x1920 portrait panel rendered as
 * a single band.
 *
 * `layoutDayEvents` already existed and already solved this — the week view
 * has called it since it was written. The day timeline just never did. This
 * asserts it still does, because the failure is invisible until a household
 * happens to double-book an hour, and it looks like a data problem rather than
 * a layout one.
 *
 * Asserted on the extracted class string rather than the file: the component's
 * comment explains the old `left-1 right-0` behaviour, so matching the whole
 * source would pass on the prose. dialog-min-width.spec.ts records the same trap.
 */

const source = readFileSync("src/app/calendar/page.tsx", "utf8");

test("the day timeline shares the strip between overlapping events", () => {
  expect(source, "page.tsx should import the shared layout helper").toContain(
    'from "@/lib/calendar-layout"',
  );
  expect(source, "the timeline should place events through layoutDayEvents").toMatch(
    /layoutDayEvents\(\s*timedEvents\s*\)/,
  );
});

test("no timeline block claims the full width of the strip", () => {
  // The event block is the one carrying the hover-brightness treatment.
  const classLiterals = [...source.matchAll(/className=\{?`([^`]*)`/g)].map((m) => m[1]);
  const block = classLiterals.filter((c) => c.includes("hover:brightness-125"));
  expect(block.length, "could not find the timeline event block's class string").toBeGreaterThan(0);

  for (const cls of block) {
    expect(cls, `a timeline block still pins itself full-width: ${cls.slice(0, 80)}`).not.toMatch(
      /\bleft-1\b|\bright-0\b/,
    );
  }
});
