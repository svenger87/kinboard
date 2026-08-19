import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  orphanedEventIds,
  prunableCalendars,
  type CalendarFetch,
} from "../src/lib/google-sync-prune";

/**
 * Deleting on Google deletes here too — and nothing else does.
 *
 * The sync only removed an event when Google returned a tombstone
 * (`status: "cancelled"`). That is what an *incremental* sync gives you; this
 * is a full list every time, and a full list mostly just omits what was
 * deleted. So upstream deletions accumulated. Measured on a live instance:
 * 435 events locally against 434 returned by the feed, the surplus deleted on
 * Google two days earlier and still on the board.
 *
 * The reconciliation that fixes it is the most destructive code in the sync,
 * so the tests below are mostly about when it must NOT fire. "The feed did
 * not mention it" and "we could not read the feed" look identical from here,
 * and only one of them means the event is gone.
 */

const cal = (over: Partial<CalendarFetch> = {}): CalendarFetch => ({
  calendarId: "cal-1",
  seen: new Set(["a", "b"]),
  complete: true,
  ...over,
});

test.describe("orphanedEventIds", () => {
  test("returns events the feed no longer contains", () => {
    const local = [
      { id: "e1", google_event_id: "a" },
      { id: "e2", google_event_id: "gone" },
      { id: "e3", google_event_id: "b" },
    ];
    expect(orphanedEventIds(local, new Set(["a", "b"]))).toEqual(["e2"]);
  });

  test("never touches an event the family created here", () => {
    // No google_event_id means Kinboard owns it. Google has no say.
    const local = [
      { id: "own", google_event_id: null },
      { id: "e2", google_event_id: "gone" },
    ];
    expect(orphanedEventIds(local, new Set())).toEqual(["e2"]);
  });

  test("an unchanged calendar yields nothing to delete", () => {
    const local = [
      { id: "e1", google_event_id: "a" },
      { id: "e3", google_event_id: "b" },
    ];
    expect(orphanedEventIds(local, new Set(["a", "b"]))).toEqual([]);
  });

  test("a genuinely emptied calendar deletes all of its Google events", () => {
    const local = [
      { id: "e1", google_event_id: "a" },
      { id: "own", google_event_id: null },
    ];
    expect(orphanedEventIds(local, new Set())).toEqual(["e1"]);
  });
});

test.describe("prunableCalendars", () => {
  test("a calendar that could not be read completely is never pruned", () => {
    // The dangerous case: a failed or truncated read looks like every event
    // was deleted. Skipping it leaves stale rows for one cycle; acting on it
    // would delete a family's calendar.
    const partial = cal({ calendarId: "broken", seen: new Set(), complete: false });
    expect(prunableCalendars([partial])).toEqual([]);
  });

  test("one broken calendar does not stop the others being reconciled", () => {
    const ok = cal({ calendarId: "ok" });
    const broken = cal({ calendarId: "broken", complete: false });
    expect(prunableCalendars([ok, broken]).map((c) => c.calendarId)).toEqual(["ok"]);
  });
});

test.describe("the sync route wires it up safely", () => {
  const source = readFileSync("src/app/api/cron/google-sync/route.ts", "utf8");

  test("every page is read before anything is deleted", () => {
    // A truncated page is indistinguishable from a pile of deletions, so
    // pagination is load-bearing here rather than a nicety.
    //
    // Asserted as the assignment, not the bare word: the comment above the
    // fetch explains the old truncation and names `nextPageToken`, so a
    // `toContain` check passed happily with the pagination removed. That is
    // the third time in this codebase a source assertion has matched the prose
    // describing the bug instead of the code fixing it.
    expect(
      /pageToken\s*=\s*res\.data\.nextPageToken/.test(source),
      "the page token is never read back, so only the first page is fetched",
    ).toBe(true);
    expect(source).toMatch(/while \(pageToken\)/);
  });

  test("a calendar is only recorded as complete inside the try", () => {
    // Recording it after the catch would mark a failed read as complete.
    const tryBlock = source.slice(source.indexOf("const seenInCalendar"), source.indexOf("} catch (calError)"));
    expect(tryBlock, "the calendar is not recorded as fetched inside the try block").toContain("complete: true");
  });

  test("reconciliation is bounded to the window that was queried", () => {
    const pruneBlock = source.slice(source.indexOf("for (const fetch of prunableCalendars"));
    expect(pruneBlock, "the prune query is not bounded by the sync window").toContain("timeMin");
    expect(pruneBlock).toContain("timeMax");
    expect(pruneBlock, "the prune must ignore locally-created events").toContain("google_event_id");
  });
});
