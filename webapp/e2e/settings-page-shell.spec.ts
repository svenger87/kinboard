import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every settings sub-page wears the same frame.
 *
 * Settings pages use one shared shell so headings, content width, safe areas,
 * and bottom-navigation clearance remain consistent across phone and kiosk.
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
    `these settings pages do not use the shared shell: ${missing.join(", ")}`,
  ).toEqual([]);
});

test("settings pages let the shared PageHeader supply their back button", () => {
  const duplicated = pages
    .filter((p) => /backHref=\{?["']\/settings["']\}?/.test(p.source))
    .map((p) => p.name);
  expect(
    duplicated,
    `PageHeader supplies the correct settings parent automatically; these ` +
      `hard-code backHref="/settings": ${duplicated.join(", ")}`,
  ).toEqual([]);
});
