import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { settingsBackHref, SETTINGS_PARENT_PATHS } from "@/lib/constants";

/**
 * The back control on a settings sub-page goes to its parent.
 *
 * Settings routes are flat — `/settings/caldav`, not
 * `/settings/calendar/caldav` — so the parent cannot be derived from the URL.
 * The layout hard-coded `/settings`, so reaching CalDAV (Settings -> Calendar
 * -> CalDAV) and coming back landed two levels up, and the way in had to be
 * walked again.
 *
 * `/settings/calendar` is the only page with children today and links to all
 * three of them, so those three are the map. The mapping is asserted from the
 * links that page actually renders, rather than trusted to stay in step by
 * hand: a fourth child added to that page and not to the map is exactly the
 * regression this exists to catch.
 */

test("every settings page linked from the calendar page maps back to it", () => {
  const calendarPage = readFileSync("src/app/settings/calendar/page.tsx", "utf8");
  const children = [
    ...new Set(
      [...calendarPage.matchAll(/href="(\/settings\/[a-z-]+)"/g)]
        .map((m) => m[1])
        .filter((href) => href !== "/settings" && href !== "/settings/calendar"),
    ),
  ];

  expect(children.length, "the calendar settings page links to no sub-pages any more").toBeGreaterThan(0);

  for (const child of children) {
    expect(
      settingsBackHref(child),
      `${child} is linked from the calendar settings page but its back control ` +
        `returns to ${settingsBackHref(child)} — add it to SETTINGS_PARENT_PATHS`,
    ).toBe("/settings/calendar");
  }
});

test("an ordinary settings page still goes back to the root", () => {
  expect(settingsBackHref("/settings/weather")).toBe("/settings");
  expect(settingsBackHref("/settings/hints")).toBe("/settings");
});

test("the layout does not hard-code the back destination", () => {
  const layout = readFileSync("src/app/settings/layout.tsx", "utf8");
  expect(layout, "the back link should resolve through settingsBackHref").toContain(
    "settingsBackHref(pathname)",
  );
  expect(
    /href="\/settings"/.test(layout),
    "the layout hard-codes href=\"/settings\" again, which sends nested pages to the root",
  ).toBe(false);
});

test("the map only contains real parents", () => {
  for (const [child, parent] of Object.entries(SETTINGS_PARENT_PATHS)) {
    expect(child.startsWith("/settings/")).toBe(true);
    expect(parent.startsWith("/settings")).toBe(true);
    expect(child).not.toBe(parent);
  }
});
