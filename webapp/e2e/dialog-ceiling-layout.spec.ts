import { test, expect } from "@playwright/test";
import { joinFamilyViaUI } from "./helpers";

/**
 * A dialog must stay on the screen, and everything in it must be reachable.
 *
 * `dialog-overflow.spec.ts` next to this one reads `ui/dialog.tsx` and asserts
 * the ceiling is declared. This renders one and measures it, because a rule
 * being present is not the same claim as the layout being right — which is
 * precisely the gap the hero cap fell through: it read correctly in the CSS and
 * did nothing in WebKit for a whole release.
 *
 * The subject is the keyboard shortcuts dialog. It sets `sm:max-w-md` and no
 * height of its own, so it exercises the base ceiling and nothing else; it
 * opens from a keypress, so there is no button label to match in three
 * languages; and it is mounted globally, so it needs no fixture beyond a
 * session. Its list of shortcuts is comfortably taller than a short window,
 * which is the case that used to break: Radix centres a dialog with a -50%
 * translate, so one taller than the viewport grew past both edges at once while
 * the page behind it was scroll-locked, and whatever left the screen could not
 * be reached at all.
 *
 * Runs under `--project=webkit` as well as Chromium. #239 is the reason that
 * matters: an engine we do not run is an engine we do not know about.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
const DEVICE_NAME = process.env.PLAYWRIGHT_DEVICE_NAME ?? "Dialog Ceiling Test";

/** Short enough that the shortcuts list cannot fit — the case under test. */
const SHORT = { width: 1000, height: 400 };

async function openShortcutsDialog(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press("?");
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
  await page.waitForTimeout(600);
}

const measure = () => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  const cs = getComputedStyle(d);
  const r = d.getBoundingClientRect();
  return {
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    height: Math.round(r.height),
    viewport: window.innerHeight,
    maxHeight: cs.maxHeight,
    overflowY: cs.overflowY,
    scrollHeight: d.scrollHeight,
    clientHeight: d.clientHeight,
    hidden: d.scrollHeight - d.clientHeight,
  };
};

test.describe("a dialog on a short screen", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE to reach the dashboard");
  test.use({ viewport: SHORT });

  test("stays within the screen and scrolls what does not fit", async ({ page }) => {
    await joinFamilyViaUI(page, FAMILY_CODE, DEVICE_NAME);
    await openShortcutsDialog(page);

    const m = await page.evaluate(measure);
    expect(m, "the shortcuts dialog did not open").not.toBeNull();

    const offTop = Math.max(0, -m!.top);
    const offBottom = Math.max(0, m!.bottom - m!.viewport);
    expect(
      offTop + offBottom,
      `the dialog is drawn ${offTop}px above and ${offBottom}px below the screen ` +
        `(${m!.height}px tall in a ${m!.viewport}px window, max-height=${m!.maxHeight}). ` +
        `The page behind a dialog is scroll-locked, so anything off-screen cannot ` +
        `be reached.`,
    ).toBe(0);

    // The case is only meaningful if the content really is too tall here; if a
    // future shortcuts list got short enough to fit, this test would pass
    // without testing anything.
    expect(
      m!.hidden,
      "the shortcuts list now fits in a 400px window, so this test no longer " +
        "exercises the ceiling — pick a shorter viewport or a taller dialog",
    ).toBeGreaterThan(0);

    expect(
      m!.overflowY,
      `${m!.hidden}px of this dialog is out of view with overflow-y: ${m!.overflowY}, ` +
        `so there is no way to reach it`,
    ).toMatch(/auto|scroll/);
  });

  test("the bottom of the content can actually be scrolled to", async ({ page }) => {
    // Declaring `overflow-y: auto` is not the same as it working — a flex or
    // grid child with the default `min-height: auto` refuses to shrink, and the
    // scrollbar never appears.
    await joinFamilyViaUI(page, FAMILY_CODE, DEVICE_NAME);
    await openShortcutsDialog(page);

    const scrolled = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]') as HTMLElement;
      d.scrollTop = d.scrollHeight;
      return { scrollTop: d.scrollTop, max: d.scrollHeight - d.clientHeight };
    });
    expect(
      scrolled.scrollTop,
      "the dialog would not scroll to its own bottom",
    ).toBeGreaterThan(0);
    expect(scrolled.scrollTop).toBeGreaterThanOrEqual(scrolled.max - 2);
  });
});

test.describe("a dialog on a tall screen", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE to reach the dashboard");
  test.use({ viewport: { width: 1280, height: 1000 } });

  test("is its natural size, not stretched to the ceiling", async ({ page }) => {
    // The ceiling must only bite when it is needed. If it started sizing every
    // dialog, every short dialog would suddenly be full-height.
    await joinFamilyViaUI(page, FAMILY_CODE, DEVICE_NAME);
    await openShortcutsDialog(page);

    const m = await page.evaluate(measure);
    expect(m!.hidden, "nothing should be cut off in a 1000px window").toBeLessThanOrEqual(2);
    expect(
      m!.height,
      "the dialog has been stretched to fill the screen rather than fitting its content",
    ).toBeLessThan(m!.viewport - 32);
  });
});
