import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

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
const FULL_BLEED_SHELL = 'className="min-h-page bg-background text-foreground safe-area-inset"';

function pagePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pagePaths(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

function settingsPages(): { name: string; source: string }[] {
  return pagePaths(SETTINGS_DIR)
    .filter((path) => path !== join(SETTINGS_DIR, "page.tsx"))
    .map((path) => ({
      name: relative(SETTINGS_DIR, path).replace(/\/page\.tsx$/, ""),
      source: readFileSync(path, "utf8"),
    }))
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
  const missing = pages
    .filter((p) => !p.source.includes(SHELL) && !p.source.includes(FULL_BLEED_SHELL))
    .map((p) => p.name);
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

test("every rendered settings sub-page has a back control", () => {
  const missing = pages
    .filter((page) => !page.source.includes("<PageHeader"))
    .filter((page) => !/<Link\s+href=["']\/settings/.test(page.source))
    .map((page) => page.name);

  expect(
    missing,
    `these settings pages use neither PageHeader nor their own settings back link: ${missing.join(", ")}`,
  ).toEqual([]);
});

test("settings header actions can wrap individually inside the mobile safe area", () => {
  const groupedActions = pages
    .filter((page) => /actions=\{\s*<div className=["'][^"']*flex/.test(page.source))
    .map((page) => page.name);

  expect(
    groupedActions,
    `these settings pages group PageHeader actions in a non-wrapping row: ${groupedActions.join(", ")}`,
  ).toEqual([]);
});
