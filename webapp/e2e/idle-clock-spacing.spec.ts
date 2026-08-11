import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The idle screen's bottom cluster — the clock, and the events/birthdays block
 * above it.
 *
 * On a landscape desktop panel those sit in opposite corners and never meet.
 * Everywhere else (portrait wall panels, and landscape under `lg`) they stack,
 * and they used to do that by each anchoring itself to the bottom edge with a
 * hand-picked offset: the clock at `bottom-32` (128px), the block at
 * `bottom-56` (224px). That reserves 96px for the clock. The clock renders
 * 108px tall, so it overlapped the last event card by 12px — measured on an
 * 800x1280 portrait panel, and identically at 1000x640 and 768x1024.
 *
 * The number was also fragile in one direction only: every extra pixel of
 * clock height came straight out of the gap. Growing the clock font took the
 * overlap to -36, -72 and -108px, while the fixed version held +24px at every
 * one of those heights.
 *
 * So the two blocks share one bottom-anchored flow container with a real gap,
 * and the spacing stops being a figure anybody has to keep in sync with the
 * clock's rendered height. This test guards the mechanism, not the pixel
 * value: reintroducing a hard-coded bottom offset on either block is the
 * regression.
 *
 * Asserted against the extracted class strings rather than the file, because
 * the explanatory comment in the component names `bottom-32` and `bottom-56`
 * too — matching the whole source would pass on the prose while the layout
 * had gone back to being wrong. dialog-min-width.spec.ts records the same trap.
 */

const source = readFileSync("src/components/screensaver.tsx", "utf8");

/** Every `className="..."` literal in the component. */
const classLiterals = [...source.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);

const find = (needle: string) => {
  const hits = classLiterals.filter((c) => c.includes(needle));
  expect(hits.length, `no className containing "${needle}" — did the block move or get renamed?`).toBe(1);
  return hits[0];
};

test("the bottom cluster is one flow container, not two guessed offsets", () => {
  const wrapper = find("landscape:lg:contents");

  // Bottom-anchored, and a column so the two blocks stack with a real gap.
  expect(wrapper, "wrapper should anchor to the bottom edge").toMatch(/\bbottom-\d+\b/);
  expect(wrapper, "wrapper should stack its children as a column").toMatch(/flex-col(-reverse)?\b/);
  expect(wrapper, "wrapper should separate the blocks with a gap utility").toMatch(/\bgap-\d+\b/);
});

test("neither block re-anchors itself to the bottom edge outside landscape", () => {
  for (const [name, needle] of [
    ["clock", "screensaver-slide-up"],
    ["events/birthdays", "screensaver-slide-right"],
  ] as const) {
    const cls = find(needle);

    // An unprefixed `bottom-*` is the regression: it takes the block out of the
    // shared column's spacing and back to guessing clearance for its sibling.
    const bare = cls
      .split(/\s+/)
      .filter((c) => /^bottom-\d+$/.test(c));
    expect(bare, `${name} must not carry an unprefixed bottom-* offset (found: ${bare.join(", ")})`).toEqual([]);

    // The landscape corner placement is the half that should stay absolute.
    expect(cls, `${name} should still position itself for landscape:lg`).toContain("landscape:lg:absolute");
  }
});
