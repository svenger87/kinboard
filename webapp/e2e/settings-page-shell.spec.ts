import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every settings sub-page wears the same frame.
 *
 * `settings/layout.tsx` renders a *floating* back button over the top-left
 * corner of every sub-page. A page that does not open with the shared shell
 * therefore has no clearance for it: the hints page put its own `<h1>`
 * underneath that button and hid the subtitle behind it, ran its rows the full
 * width of a 1280px display instead of the centred column, and tucked its last
 * row under the navigation bar.
 *
 * Then fixing the padding revealed the second half: the page also passed
 * `backHref="/settings"` to PageHeader, which renders a back control the
 * layout had already drawn. While the two overlapped it read as one; with
 * correct padding it read as two. Both faults were invisible to types, tests
 * and review, and obvious within a second of looking at the page.
 *
 * A written convention did not prevent any of that, so it is asserted here.
 * CONTRIBUTING.md carries the prose; this is what makes it hold.
 */

const SETTINGS_DIR = "src/app/settings";

/** The frame, verbatim. Widen max-w-* per page; everything else is shared. */
const SHELL = 'className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"';

function settingsPages(): { name: string; source: string }[] {
  return readdirSync(SETTINGS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: join(SETTINGS_DIR, e.name, "page.tsx") }))
    .filter((p) => {
      try {
        readFileSync(p.path);
        return true;
      } catch {
        return false; // a directory without its own page
      }
    })
    .map((p) => ({ name: p.name, source: readFileSync(p.path, "utf8") }))
    // A route that only redirects renders nothing and needs no frame.
    .filter((p) => !/^\s*redirect\(/m.test(p.source) || /<main/.test(p.source));
}

const pages = settingsPages();

test("there are settings pages to check", () => {
  // Guards against the glob silently finding nothing, which would make every
  // assertion below vacuously true.
  expect(pages.length).toBeGreaterThan(20);
});

test("every settings page opens with the shared shell", () => {
  const missing = pages.filter((p) => !p.source.includes(SHELL)).map((p) => p.name);
  expect(
    missing,
    `these settings pages do not use the shared shell, so the floating back ` +
      `button will overlap their heading: ${missing.join(", ")}`,
  ).toEqual([]);
});

test("no settings page draws a second back button to /settings", () => {
  const duplicated = pages
    .filter((p) => /backHref=\{?["']\/settings["']\}?/.test(p.source))
    .map((p) => p.name);
  expect(
    duplicated,
    `settings/layout.tsx already renders the back control for every sub-page; ` +
      `these pass backHref="/settings" as well and so render two: ${duplicated.join(", ")}`,
  ).toEqual([]);
});
