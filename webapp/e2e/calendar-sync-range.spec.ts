import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  icsSyncWindow,
  ICS_WINDOW_PAST_DAYS,
  ICS_WINDOW_FUTURE_DAYS,
} from "../src/lib/ics-fetcher";
import {
  isCalendarSyncRangeDays,
  normalizeCalendarSyncRangeDays,
  DEFAULT_CALENDAR_SYNC_RANGE_DAYS,
  CALENDAR_SYNC_RANGE_DAYS,
} from "../src/lib/calendar-sync-range";

/**
 * Discussion #349: the fixed 60-day-ahead ICS/CalDAV sync window is now a
 * per-family setting (`calendar_sync_range` / SETTINGS_KEYS.calendarSyncRange),
 * one of 60 / 180 / 365 days, default 60. The past side stays fixed at 30 days.
 *
 * What this covers, stack-free:
 *   1. icsSyncWindow produces the right window for each offered value.
 *   2. an invalid or missing stored value normalizes to 60, never an error
 *      and never a wider sync than the default.
 *   3. every ICS/CalDAV sync entry point — cron and user-triggered, plus the
 *      initial sync a CalDAV calendar gets on creation — actually reads the
 *      family's value and threads it into the fetch, rather than quietly
 *      keeping the old hardcoded 60. That part can't be observed by calling
 *      a function (the threading itself is the thing that would regress),
 *      so it's checked by reading the source, the same approach
 *      e2e/realtime-publication.spec.ts uses for the publication/subscriber
 *      pairing.
 */

const SRC = join(__dirname, "..", "src");
// Not run through codeOnly: that scanner mis-detects "/*" openings inside
// string literals (ics-fetcher.ts's `Accept: "…, */*"` header is exactly
// that), and every pattern checked here is specific code, not prose that
// would otherwise be mistaken for it.
const read = (relPath: string) => readFileSync(join(SRC, relPath), "utf8");

test.describe("the window for each offered value", () => {
  for (const futureDays of CALENDAR_SYNC_RANGE_DAYS) {
    test(`${futureDays} days ahead`, () => {
      const now = new Date("2026-06-15T12:00:00Z");
      const { start, end } = icsSyncWindow(now, futureDays);

      const expectedStart = new Date(now);
      expectedStart.setDate(expectedStart.getDate() - ICS_WINDOW_PAST_DAYS);
      const expectedEnd = new Date(now);
      expectedEnd.setDate(expectedEnd.getDate() + futureDays);

      expect(start.toISOString()).toBe(expectedStart.toISOString());
      expect(end.toISOString()).toBe(expectedEnd.toISOString());

      // Past side never moves with the setting.
      const daysOfHistory = Math.round((now.getTime() - start.getTime()) / 86_400_000);
      expect(daysOfHistory).toBe(ICS_WINDOW_PAST_DAYS);
    });
  }

  test("no argument keeps the old default — existing callers are unaffected", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const withDefault = icsSyncWindow(now);
    const withExplicit60 = icsSyncWindow(now, 60);
    expect(withDefault.start.toISOString()).toBe(withExplicit60.start.toISOString());
    expect(withDefault.end.toISOString()).toBe(withExplicit60.end.toISOString());
    expect(ICS_WINDOW_FUTURE_DAYS).toBe(60);
  });
});

test.describe("an invalid value falls back to 60", () => {
  const invalid: unknown[] = [undefined, null, 0, 61, 90, 400, -60, "60", "365", {}, [], NaN];

  invalid.forEach((value, i) => {
    test(`[${i}] ${String(value)} is not a valid range`, () => {
      expect(isCalendarSyncRangeDays(value)).toBe(false);
      expect(normalizeCalendarSyncRangeDays(value)).toBe(60);
    });
  });

  test("the three offered values are, and only they are, valid", () => {
    expect(CALENDAR_SYNC_RANGE_DAYS).toEqual([60, 180, 365]);
    for (const value of CALENDAR_SYNC_RANGE_DAYS) {
      expect(isCalendarSyncRangeDays(value)).toBe(true);
      expect(normalizeCalendarSyncRangeDays(value)).toBe(value);
    }
  });

  test("the default is 60, unchanged behaviour for a family that never picks", () => {
    expect(DEFAULT_CALENDAR_SYNC_RANGE_DAYS).toBe(60);
  });
});

test.describe("the settings route refuses anything but the three values", () => {
  test("PUT /api/settings guards calendar_sync_range with isCalendarSyncRangeDays before storing it", () => {
    const src = read("app/api/settings/route.ts");
    expect(src).toMatch(/SETTINGS_KEYS\.calendarSyncRange/);
    // The guard must actually gate on validity and refuse with 400 — not just
    // mention the key (e.g. in a comment or an unrelated branch).
    const guard = /if\s*\(\s*key\s*===\s*SETTINGS_KEYS\.calendarSyncRange\s*&&\s*!isCalendarSyncRangeDays\(value\)\s*\)\s*\{[\s\S]{0,200}?status:\s*400/;
    expect(src).toMatch(guard);
  });
});

/**
 * Every place that turns an ICS feed or a CalDAV calendar into rows in the
 * events table must look up the family's own value rather than assuming 60.
 * Each check below fails if that file stops calling
 * `familyCalendarSyncFutureDays` and feeding the result into the sync/fetch
 * call — proven by having written this against the pre-threading code first
 * (removing any one call site reproduces the failure).
 */
test.describe("every sync caller passes the family's value", () => {
  test("lib/ics-sync.ts: the manual 'Sync now' path (syncFamilyIcsCalendars)", () => {
    const src = read("lib/ics-sync.ts");
    expect(src).toMatch(/import\s*\{\s*familyCalendarSyncFutureDays\s*\}\s*from\s*"@\/lib\/calendar-sync-range-server"/);
    expect(src).toMatch(/const futureDays = await familyCalendarSyncFutureDays\(familyId, supabase\)/);
    // The *call site*, not the declaration below — an exact literal so a
    // regex this loose can't be satisfied by the function signature alone.
    expect(src).toMatch(/syncIcsCalendar\(cal\.id, cal\.ics_url, cal\.ics_etag, cal\.person_id, mappingRules, futureDays\)/);
    // And the function it calls must actually accept and use it, not drop it
    // on the floor.
    expect(src).toMatch(/export async function syncIcsCalendar\(\s*[\s\S]*?futureDays:\s*number/);
    expect(src).toMatch(/fetchIcsCalendar\(icsUrl, effectiveEtag, futureDays\)/);
  });

  test("app/api/cron/sync-ics/route.ts: the cross-family cron path", () => {
    const src = read("app/api/cron/sync-ics/route.ts");
    expect(src).toMatch(/import\s*\{\s*familyCalendarSyncFutureDays/);
    expect(src).toMatch(/futureDaysByFamily\.set\(familyId, await familyCalendarSyncFutureDays\(familyId, supabase\)\)/);
    expect(src).toMatch(/syncIcsCalendar\(\s*[\s\S]*?futureDaysByFamily\.get\(cal\.family_id\)/);
  });

  test("lib/caldav-sync.ts: both the manual and the cross-family cron CalDAV path", () => {
    const src = read("lib/caldav-sync.ts");
    expect(src).toMatch(/import\s*\{\s*familyCalendarSyncFutureDays/);
    expect(src).toMatch(/export async function syncCaldavCalendar\(\s*[\s\S]*?futureDays:\s*CalendarSyncRangeDays/);
    expect(src).toMatch(/fetchCaldavEvents\(client, calendar\.caldav_url, icsSyncWindow\(new Date\(\), futureDays\)\)/);

    // syncFamilyCaldavCalendars (one family, "Sync now")
    expect(src).toMatch(/const futureDays = await familyCalendarSyncFutureDays\(familyId, supabase\)/);
    expect(src).toMatch(/syncCaldavCalendar\(cal, mappingRules, futureDays\)/);

    // syncAllCaldavCalendars (every family, cron)
    expect(src).toMatch(/futureDaysByFamily\.set\(familyId, await familyCalendarSyncFutureDays\(familyId, supabase\)\)/);
    expect(src).toMatch(/syncCaldavCalendar\(\s*cal,\s*rulesByFamily\.get\(cal\.family_id\) \?\? \[\],\s*futureDaysByFamily\.get\(cal\.family_id\),?\s*\)/);
  });

  test("app/api/caldav/calendars/route.ts: the first sync a newly added calendar gets", () => {
    const src = read("app/api/caldav/calendars/route.ts");
    expect(src).toMatch(/import\s*\{\s*familyCalendarSyncFutureDays\s*\}\s*from\s*"@\/lib\/calendar-sync-range-server"/);
    expect(src).toMatch(/syncCaldavCalendar\(\s*\{[\s\S]*?\},\s*await getMappingRules\(payload\.family_id\),\s*await familyCalendarSyncFutureDays\(payload\.family_id, supabase\),?\s*\)/);
  });

  test("app/api/calendar/test-ics/route.ts: the connectivity test before adding a feed", () => {
    const src = read("app/api/calendar/test-ics/route.ts");
    expect(src).toMatch(/import\s*\{\s*familyCalendarSyncFutureDays\s*\}\s*from\s*"@\/lib\/calendar-sync-range-server"/);
    expect(src).toMatch(/const futureDays = await familyCalendarSyncFutureDays\(auth\.session\.familyId\)/);
    expect(src).toMatch(/fetchIcsCalendar\(url\.trim\(\), null, futureDays\)/);
  });

  test("lib/ics-fetcher.ts: icsSyncWindow and fetchIcsCalendar both accept futureDays", () => {
    const src = read("lib/ics-fetcher.ts");
    expect(src).toMatch(/export function icsSyncWindow\(\s*now: Date = new Date\(\),\s*futureDays: number = ICS_WINDOW_FUTURE_DAYS,?\s*\)/);
    expect(src).toMatch(/export async function fetchIcsCalendar\(\s*[\s\S]*?futureDays: number = ICS_WINDOW_FUTURE_DAYS,?\s*\)/);
    expect(src).toMatch(/parseIcsEvents\(text, icsSyncWindow\(new Date\(\), futureDays\)\)/);
  });
});

// The settings card is a client component: the module it imports must not
// reach next/headers through the server Supabase client, or the production
// build fails ("You're importing a module that depends on next/headers").
test("the client-side half imports nothing server-only", () => {
  const src = readFileSync(join(__dirname, "../src/lib/calendar-sync-range.ts"), "utf8");
  expect(src).not.toMatch(/supabase\/server|next\/headers/);
});
