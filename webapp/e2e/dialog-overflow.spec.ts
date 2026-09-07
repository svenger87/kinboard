import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cn } from "../src/lib/utils";

/**
 * A dialog or sheet can never be taller than the screen it is on.
 *
 * Radix centres a dialog with `top-1/2` and a -50% translate, so one whose
 * content exceeds the viewport grows past *both* edges at once — and the page
 * behind it is scroll-locked, so the parts that went off-screen cannot be
 * reached at all. Most dialogs here set no height and were fine only because
 * their content happened to be short.
 *
 * Measured on Settings → People's add-person dialog, which sets `max-w-md` and
 * no height:
 *
 *   900x420   h=850  top=-215  maxH=none  overflow=visible  -> 430px unreachable
 *   800x360   h=850  top=-245  maxH=none  overflow=visible  -> 490px unreachable
 *
 * and after giving the base component a ceiling:
 *
 *   900x420   h=388  top=16    maxH=388px overflow=auto     -> scrolls, all reachable
 *   800x360   h=328  top=16    maxH=328px overflow=auto     -> scrolls, all reachable
 *
 * Sheets have the same shape from the other direction: top and bottom sheets
 * are pinned to an edge and grow away from it, off the opposite side.
 */

const dialog = readFileSync("src/components/ui/dialog.tsx", "utf8");
const sheet = readFileSync("src/components/ui/sheet.tsx", "utf8");

test.describe("the base components", () => {
  test("a dialog is bounded by the screen and can scroll", () => {
    expect(
      dialog,
      "DialogContent has no height ceiling, so a long dialog grows past both " +
        "edges of a scroll-locked page",
    ).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
    expect(dialog).toMatch(/overflow-y-auto/);
  });

  test("it uses dvh, not vh", () => {
    // On a phone the browser chrome makes `vh` taller than the visible area,
    // which would put the bottom of a full-height dialog back under the URL bar.
    const rule = dialog.match(/max-h-\[calc\(100(d?)vh-2rem\)\]/);
    expect(rule?.[1], "the dialog ceiling should be in dvh").toBe("d");
  });

  test("every sheet side is bounded and scrollable", () => {
    for (const side of ["top", "bottom"]) {
      const m = sheet.match(new RegExp(`${side}:\\s*\\n?\\s*"([^"]*)"`));
      expect(m, `could not find the ${side} sheet variant`).toBeTruthy();
      expect(m![1], `a ${side} sheet needs a ceiling`).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
      expect(m![1], `a ${side} sheet needs to scroll`).toContain("overflow-y-auto");
    }
    for (const side of ["left", "right"]) {
      const m = sheet.match(new RegExp(`${side}:\\s*\\n?\\s*"([^"]*)"`));
      expect(m, `could not find the ${side} sheet variant`).toBeTruthy();
      // These are already h-full, so they clip rather than run off — same result.
      expect(m![1], `a ${side} sheet needs to scroll`).toContain("overflow-y-auto");
    }
  });
});

test.describe("a dialog can still override the default", () => {
  /*
    The whole approach rests on `cn` being tailwind-merge: the base sets a
    ceiling and a scrollbar, and any dialog that wants its own — the recipe
    detail's `max-h-[85vh] overflow-hidden flex flex-col`, say — must win.
    If `cn` were plain concatenation both classes would apply and the more
    specific one would lose to source order.
  */
  const BASE = "max-h-[calc(100dvh-2rem)] overflow-y-auto";

  test("a tighter max-h replaces the default", () => {
    const out = cn(BASE, "max-w-2xl max-h-[80vh]");
    expect(out).toContain("max-h-[80vh]");
    expect(out).not.toContain("max-h-[calc(100dvh-2rem)]");
  });

  test("overflow-hidden replaces the default scrollbar", () => {
    const out = cn(BASE, "max-h-[80vh] overflow-hidden flex flex-col");
    expect(out).toContain("overflow-hidden");
    expect(out).not.toContain("overflow-y-auto");
  });

  test("a dialog that says nothing keeps both defaults", () => {
    const out = cn(BASE, "max-w-md");
    expect(out).toContain("max-h-[calc(100dvh-2rem)]");
    expect(out).toContain("overflow-y-auto");
  });
});

test.describe("the add-meal dialog", () => {
  const meals = readFileSync("src/app/meals/page.tsx", "utf8");

  test("its clamp has an overflow strategy", () => {
    /*
      This one is the hero bug (#231) in a dialog: the contents are sized in px
      — header, search box, a 300px recipe list, footer, about 480px in all —
      while the clamp is `max-h-[80vh]`. Below roughly a 620px viewport the
      clamp landed under the content and the surplus was painted outside the
      dialog with no way to scroll to it.

      Measured before: 202px cut off at 1024x600, 298px at 800x480.
    */
    expect(
      meals,
      "the add-meal dialog clamps its height without saying what happens to the " +
        "overflow",
    ).toContain('className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"');
  });

  test("the recipe list shrinks instead of overflowing", () => {
    // `min-h-0` is the load-bearing part: a flex child defaults to
    // `min-height: auto` and refuses to shrink below its content, which
    // silently recreates the overflow the clamp was meant to prevent.
    expect(meals).toMatch(/ScrollArea className="min-h-0 flex-1 pr-4 sm:max-h-\[300px\]"/);
  });
});
