import { test, expect } from "@playwright/test";
import { parseEventPatch } from "../src/lib/integration-event-input";
import { loadFamilyEvent, type FamilyEventDb } from "../src/lib/family-event-scope";
import {
  deleteVerdict,
  syncDeletedCalendarEvent,
  syncUpdatedCalendarEvent,
  type CaldavEventsApi,
  type GoogleEventsApi,
  type StoredCalendarEvent,
  type WritableCalendar,
  type WriteThroughDeps,
} from "../src/lib/calendar-write-through";

/**
 * RFC-011 task 4: editing and deleting a calendar event through the
 * Integration API, with write-through to Google or CalDAV.
 *
 * Two pure halves are tested here. The partial-update parser decides which
 * columns change and which provider dates follow; the write-through takes its
 * Google and CalDAV clients as injected dependencies, so what it *sends* —
 * the exclusive all-day end, the family's zone, no call at all when the
 * event was never linked — is observable without a provider or a database.
 */

const BERLIN = "Europe/Berlin";

// An all-day event on 3–4 Oct 2026, stored the way the app stores one: local
// midnight of the first day to local 23:59:59.999 of the last (CEST, +02:00).
const ALL_DAY = { start_at: "2026-10-02T22:00:00.000Z", end_at: "2026-10-04T21:59:59.999Z", all_day: true };
const TIMED = { start_at: "2026-10-03T07:00:00.000Z", end_at: "2026-10-03T08:00:00.000Z", all_day: false };

test.describe("parseEventPatch: only the fields present change", () => {
  test("a title alone touches nothing else and carries no provider dates", () => {
    const r = parseEventPatch({ title: "  Swimming  " }, TIMED, BERLIN);
    expect(r).toEqual({ ok: true, value: { columns: { title: "Swimming" } } });
  });

  test("description and location can be changed or cleared with null", () => {
    const r = parseEventPatch({ description: " bring towels ", location: null }, TIMED, BERLIN);
    expect(r).toEqual({ ok: true, value: { columns: { description: "bring towels", location: null } } });
  });

  test("an empty body, an unknown-only body, or a calendar move is refused", () => {
    expect(parseEventPatch({}, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ colour: "red" }, TIMED, BERLIN).ok).toBe(false);
    const move = parseEventPatch({ calendar_id: "11111111-1111-1111-1111-111111111111" }, TIMED, BERLIN);
    expect(move.ok).toBe(false);
  });

  test("the same bounds as create apply", () => {
    expect(parseEventPatch({ title: "   " }, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ title: "x".repeat(301) }, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ description: "x".repeat(2001) }, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ location: 5 }, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ all_day: "yes" }, TIMED, BERLIN).ok).toBe(false);
  });
});

test.describe("parseEventPatch: a timed event", () => {
  test("a new start alone keeps the stored end", () => {
    const r = parseEventPatch({ start_at: "2026-10-03T08:30:00+02:00" }, TIMED, BERLIN);
    expect(r).toEqual({ ok: true, value: { columns: { start_at: "2026-10-03T06:30:00.000Z" } } });
  });

  test("a new start at or after the stored end is refused rather than shifting the end", () => {
    const r = parseEventPatch({ start_at: "2026-10-03T11:00:00+02:00" }, TIMED, BERLIN);
    expect(r.ok).toBe(false);
  });

  test("both ends together, normalised to UTC", () => {
    const r = parseEventPatch({ start_at: "2026-10-05T18:00:00+02:00", end_at: "2026-10-05T19:30:00+02:00" }, TIMED, BERLIN);
    expect(r).toEqual({
      ok: true,
      value: { columns: { start_at: "2026-10-05T16:00:00.000Z", end_at: "2026-10-05T17:30:00.000Z" } },
    });
  });

  test("dates, offset-less timestamps and over-long events are refused", () => {
    expect(parseEventPatch({ start_date: "2026-10-05" }, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ start_at: "2026-10-03T08:30:00" }, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ end_at: "2028-10-03T08:30:00Z" }, TIMED, BERLIN).ok).toBe(false);
  });
});

test.describe("parseEventPatch: an all-day event", () => {
  test("a new last day alone keeps the stored first day, with the exclusive provider end", () => {
    const r = parseEventPatch({ end_date: "2026-10-05" }, ALL_DAY, BERLIN);
    expect(r).toEqual({
      ok: true,
      value: {
        columns: { end_at: "2026-10-05T21:59:59.999Z" },
        allDayDates: { start: "2026-10-03", endExclusive: "2026-10-06" },
      },
    });
  });

  test("a new first day alone keeps the stored last day", () => {
    const r = parseEventPatch({ start_date: "2026-10-04" }, ALL_DAY, BERLIN);
    expect(r).toEqual({
      ok: true,
      value: {
        columns: { start_at: "2026-10-03T22:00:00.000Z" },
        allDayDates: { start: "2026-10-04", endExclusive: "2026-10-05" },
      },
    });
  });

  test("a first day after the stored last day is refused", () => {
    expect(parseEventPatch({ start_date: "2026-10-06" }, ALL_DAY, BERLIN).ok).toBe(false);
  });

  test("timestamps are refused without switching to a timed event", () => {
    expect(parseEventPatch({ start_at: "2026-10-03T09:00:00+02:00" }, ALL_DAY, BERLIN).ok).toBe(false);
  });
});

test.describe("parseEventPatch: switching between all-day and timed needs both ends", () => {
  test("timed → all-day with both dates", () => {
    const r = parseEventPatch({ all_day: true, start_date: "2026-10-03", end_date: "2026-10-03" }, TIMED, BERLIN);
    expect(r).toEqual({
      ok: true,
      value: {
        columns: { all_day: true, start_at: "2026-10-02T22:00:00.000Z", end_at: "2026-10-03T21:59:59.999Z" },
        allDayDates: { start: "2026-10-03", endExclusive: "2026-10-04" },
      },
    });
  });

  test("timed → all-day with one date, or none, is refused", () => {
    expect(parseEventPatch({ all_day: true }, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ all_day: true, start_date: "2026-10-03" }, TIMED, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ all_day: true, end_date: "2026-10-03" }, TIMED, BERLIN).ok).toBe(false);
  });

  test("all-day → timed with both timestamps", () => {
    const r = parseEventPatch({ all_day: false, start_at: "2026-10-03T09:00:00+02:00", end_at: "2026-10-03T10:00:00+02:00" }, ALL_DAY, BERLIN);
    expect(r).toEqual({
      ok: true,
      value: { columns: { all_day: false, start_at: "2026-10-03T07:00:00.000Z", end_at: "2026-10-03T08:00:00.000Z" } },
    });
  });

  test("all-day → timed with one timestamp is refused", () => {
    expect(parseEventPatch({ all_day: false, start_at: "2026-10-03T09:00:00+02:00" }, ALL_DAY, BERLIN).ok).toBe(false);
    expect(parseEventPatch({ all_day: false }, ALL_DAY, BERLIN).ok).toBe(false);
  });

  test("restating the current kind is not a switch", () => {
    const r = parseEventPatch({ all_day: true, end_date: "2026-10-05" }, ALL_DAY, BERLIN);
    expect(r.ok).toBe(true);
  });

  test("restating the current kind and nothing else changes nothing, so it is refused", () => {
    // Otherwise the route would run `.update({})` — PostgREST answers that
    // with no row (PGRST116) and the edit 500s — and still call the provider.
    const allDay = parseEventPatch({ all_day: true }, ALL_DAY, BERLIN);
    const timed = parseEventPatch({ all_day: false }, TIMED, BERLIN);
    expect(allDay).toEqual({ ok: false, error: expect.stringContaining("nothing to change") });
    expect(timed).toEqual({ ok: false, error: expect.stringContaining("nothing to change") });
  });
});

// ---------------------------------------------------------------------------
// Write-through with injected provider clients
// ---------------------------------------------------------------------------

const LOCAL_CAL: WritableCalendar = {
  id: "cal-1", google_calendar_id: null, ics_url: null, caldav_url: null, caldav_server_url: null, caldav_read_only: null,
};
const GOOGLE_CAL: WritableCalendar = { ...LOCAL_CAL, google_calendar_id: "family@group.calendar.google.com" };
const CALDAV_CAL: WritableCalendar = { ...LOCAL_CAL, caldav_url: "https://dav.example.com/cal/family/" };

function row(overrides: Partial<StoredCalendarEvent> = {}): StoredCalendarEvent {
  return {
    id: "ev-1", calendar_id: "cal-1", title: "Swimming", description: null, location: "Pool",
    ...TIMED, google_event_id: null, caldav_href: null, caldav_etag: null,
    ...overrides,
  };
}

function fakes(opts: { googleFails?: unknown; caldavFails?: unknown; googleMissing?: boolean; caldavMissing?: boolean } = {}) {
  const google: { patch: unknown[]; delete: unknown[] } = { patch: [], delete: [] };
  const caldav: { update: unknown[][]; delete: unknown[][]; create: unknown[][] } = { update: [], delete: [], create: [] };
  const etags: unknown[][] = [];
  const links: unknown[][] = [];
  const googleApi: GoogleEventsApi = {
    async patch(params) { google.patch.push(params); if (opts.googleFails) throw opts.googleFails; },
    async delete(params) { google.delete.push(params); if (opts.googleFails) throw opts.googleFails; },
  };
  const caldavApi: CaldavEventsApi = {
    async update(href, ical, etag) { caldav.update.push([href, ical, etag]); if (opts.caldavFails) throw opts.caldavFails; return { etag: "\"new\"" }; },
    async delete(href, etag) { caldav.delete.push([href, etag]); if (opts.caldavFails) throw opts.caldavFails; },
    async create(calendarUrl, uid, ical) {
      caldav.create.push([calendarUrl, uid, ical]);
      if (opts.caldavFails) throw opts.caldavFails;
      return { href: `${calendarUrl}${uid}.ics`, etag: "\"created\"" };
    },
  };
  const deps: WriteThroughDeps = {
    googleEvents: async () => (opts.googleMissing ? null : googleApi),
    caldavEvents: async () => (opts.caldavMissing ? null : caldavApi),
    saveCaldavEtag: async (event, etag) => { etags.push([event.id, event.calendar_id, etag]); },
    saveCaldavLink: async (event, link) => { links.push([event.id, event.calendar_id, link]); },
  };
  return { google, caldav, etags, links, deps };
}

test.describe("syncUpdatedCalendarEvent: Google", () => {
  test("an all-day event is patched with dates and Google's exclusive end", async () => {
    const f = fakes();
    const event = row({ ...ALL_DAY, google_event_id: "g-1" });
    const sync = await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, event, { start: "2026-10-03", endExclusive: "2026-10-05" }, BERLIN, f.deps);
    expect(sync).toEqual({ provider: "google", synced: true });
    expect(f.google.patch).toEqual([{
      calendarId: "family@group.calendar.google.com",
      eventId: "g-1",
      requestBody: {
        summary: "Swimming", description: null, location: "Pool",
        start: { date: "2026-10-03", dateTime: null, timeZone: null },
        end: { date: "2026-10-05", dateTime: null, timeZone: null },
      },
    }]);
  });

  test("a timed event is patched with dateTime and the family's zone, clearing any date", async () => {
    const f = fakes();
    await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, row({ google_event_id: "g-1" }), undefined, "America/New_York", f.deps);
    const body = (f.google.patch[0] as { requestBody: Record<string, unknown> }).requestBody;
    expect(body.start).toEqual({ dateTime: TIMED.start_at, timeZone: "America/New_York", date: null });
    expect(body.end).toEqual({ dateTime: TIMED.end_at, timeZone: "America/New_York", date: null });
  });

  test("an all-day edit that did not touch the dates leaves Google's dates alone", async () => {
    const f = fakes();
    await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, row({ ...ALL_DAY, google_event_id: "g-1" }), undefined, BERLIN, f.deps);
    const body = (f.google.patch[0] as { requestBody: Record<string, unknown> }).requestBody;
    expect(body).not.toHaveProperty("start");
    expect(body).not.toHaveProperty("end");
    expect(body.summary).toBe("Swimming");
  });

  test("an event never linked to Google is not patched", async () => {
    const f = fakes();
    const sync = await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, row(), undefined, BERLIN, f.deps);
    expect(sync).toEqual({ provider: "google", synced: false, reason: "not_linked" });
    expect(f.google.patch).toEqual([]);
  });

  test("a disconnected account and a failing API are reported, never thrown", async () => {
    const missing = fakes({ googleMissing: true });
    expect(await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, row({ google_event_id: "g-1" }), undefined, BERLIN, missing.deps))
      .toEqual({ provider: "google", synced: false, reason: "google_not_connected" });
    const failing = fakes({ googleFails: new Error("boom") });
    expect(await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, row({ google_event_id: "g-1" }), undefined, BERLIN, failing.deps))
      .toEqual({ provider: "google", synced: false, reason: "provider_write_failed" });
  });
});

test.describe("syncDeletedCalendarEvent: Google", () => {
  test("deletes the stored Google event", async () => {
    const f = fakes();
    const sync = await syncDeletedCalendarEvent("fam", GOOGLE_CAL, row({ google_event_id: "g-1" }), f.deps);
    expect(sync).toEqual({ provider: "google", synced: true });
    expect(f.google.delete).toEqual([{ calendarId: "family@group.calendar.google.com", eventId: "g-1" }]);
  });

  test("an event never linked to Google is not deleted there", async () => {
    const f = fakes();
    const sync = await syncDeletedCalendarEvent("fam", GOOGLE_CAL, row(), f.deps);
    expect(sync).toEqual({ provider: "google", synced: false, reason: "not_linked" });
    expect(f.google.delete).toEqual([]);
  });

  test("an event already gone from Google counts as deleted", async () => {
    for (const status of [404, 410]) {
      const f = fakes({ googleFails: Object.assign(new Error("gone"), { code: status }) });
      expect(await syncDeletedCalendarEvent("fam", GOOGLE_CAL, row({ google_event_id: "g-1" }), f.deps))
        .toEqual({ provider: "google", synced: true });
    }
  });

  test("any other failure is reported, never thrown", async () => {
    const f = fakes({ googleFails: Object.assign(new Error("server"), { code: 500 }) });
    expect(await syncDeletedCalendarEvent("fam", GOOGLE_CAL, row({ google_event_id: "g-1" }), f.deps))
      .toEqual({ provider: "google", synced: false, reason: "provider_write_failed" });
  });
});

test.describe("CalDAV write-through", () => {
  const linked = { google_event_id: "caldav:abc@kinboard", caldav_href: "https://dav.example.com/cal/family/abc.ics", caldav_etag: "\"old\"" };

  test("an update replaces the whole resource with the stored ETag and saves the new one", async () => {
    const f = fakes();
    const sync = await syncUpdatedCalendarEvent("fam", CALDAV_CAL, row(linked), undefined, BERLIN, f.deps);
    expect(sync).toEqual({ provider: "caldav", synced: true });
    expect(f.caldav.update).toHaveLength(1);
    const [href, ical, etag] = f.caldav.update[0] as [string, string, string];
    expect(href).toBe(linked.caldav_href);
    expect(etag).toBe("\"old\"");
    expect(ical).toContain("UID:abc@kinboard");
    expect(ical).toContain("SUMMARY:Swimming");
    expect(f.etags).toEqual([["ev-1", "cal-1", "\"new\""]]);
  });

  test("an all-day CalDAV update is serialised in the family's zone with an exclusive DTEND", async () => {
    const f = fakes();
    await syncUpdatedCalendarEvent("fam", CALDAV_CAL, row({ ...linked, ...ALL_DAY }), undefined, BERLIN, f.deps);
    const ical = (f.caldav.update[0] as string[])[1];
    expect(ical).toContain("DTSTART;VALUE=DATE:20261003");
    expect(ical).toContain("DTEND;VALUE=DATE:20261005");
  });

  test("one occurrence of a repeating event is refused before any request", async () => {
    const f = fakes();
    const recurring = row({ ...linked, google_event_id: "caldav:abc@kinboard__20261003T070000Z" });
    expect(await syncUpdatedCalendarEvent("fam", CALDAV_CAL, recurring, undefined, BERLIN, f.deps))
      .toEqual({ provider: "caldav", synced: false, reason: "recurring" });
    expect(await syncDeletedCalendarEvent("fam", CALDAV_CAL, recurring, f.deps))
      .toEqual({ provider: "caldav", synced: false, reason: "recurring" });
    expect(f.caldav.update).toEqual([]);
    expect(f.caldav.delete).toEqual([]);
  });

  test("an edit to an event never written to the server creates it there, as /api/caldav/events does", async () => {
    const f = fakes();
    expect(await syncUpdatedCalendarEvent("fam", CALDAV_CAL, row(), undefined, BERLIN, f.deps))
      .toEqual({ provider: "caldav", synced: true });
    expect(f.caldav.update).toEqual([]);
    expect(f.caldav.create).toHaveLength(1);
    const [calendarUrl, uid, ical] = f.caldav.create[0] as string[];
    expect(calendarUrl).toBe(CALDAV_CAL.caldav_url);
    expect(uid).toMatch(/@kinboard$/);
    expect(ical).toContain(`UID:${uid}`);
    expect(ical).toContain("SUMMARY:Swimming");
    expect(f.links).toEqual([["ev-1", "cal-1", {
      google_event_id: `caldav:${uid}`, caldav_href: `${CALDAV_CAL.caldav_url}${uid}.ics`, caldav_etag: "\"created\"",
    }]]);
  });

  test("a failed repair create is reported, never thrown", async () => {
    const f = fakes({ caldavFails: new Error("down") });
    expect(await syncUpdatedCalendarEvent("fam", CALDAV_CAL, row(), undefined, BERLIN, f.deps))
      .toEqual({ provider: "caldav", synced: false, reason: "provider_write_failed" });
    expect(f.links).toEqual([]);
  });

  test("a delete of an event never written to the server does not call it", async () => {
    const f = fakes();
    expect(await syncDeletedCalendarEvent("fam", CALDAV_CAL, row(), f.deps))
      .toEqual({ provider: "caldav", synced: false, reason: "not_linked" });
    expect(f.caldav.delete).toEqual([]);
    expect(f.caldav.create).toEqual([]);
  });

  test("a delete removes the resource with its ETag", async () => {
    const f = fakes();
    expect(await syncDeletedCalendarEvent("fam", CALDAV_CAL, row(linked), f.deps)).toEqual({ provider: "caldav", synced: true });
    expect(f.caldav.delete).toEqual([[linked.caldav_href, "\"old\""]]);
  });

  test("missing credentials, conflicts and failures are reported, never thrown", async () => {
    const { CaldavConflictError } = await import("../src/lib/caldav-client");
    expect(await syncDeletedCalendarEvent("fam", CALDAV_CAL, row(linked), fakes({ caldavMissing: true }).deps))
      .toEqual({ provider: "caldav", synced: false, reason: "caldav_not_connected" });
    expect(await syncDeletedCalendarEvent("fam", CALDAV_CAL, row(linked), fakes({ caldavFails: new CaldavConflictError("delete") }).deps))
      .toEqual({ provider: "caldav", synced: false, reason: "conflict" });
    expect(await syncUpdatedCalendarEvent("fam", CALDAV_CAL, row(linked), undefined, BERLIN, fakes({ caldavFails: new Error("down") }).deps))
      .toEqual({ provider: "caldav", synced: false, reason: "provider_write_failed" });
  });
});

test.describe("local and read-only calendars", () => {
  test("a local calendar needs no provider call", async () => {
    const f = fakes();
    expect(await syncUpdatedCalendarEvent("fam", LOCAL_CAL, row(), undefined, BERLIN, f.deps)).toEqual({ provider: "local", synced: true });
    expect(await syncDeletedCalendarEvent("fam", LOCAL_CAL, row(), f.deps)).toEqual({ provider: "local", synced: true });
    expect(f.google.patch.length + f.google.delete.length + f.caldav.update.length + f.caldav.delete.length).toBe(0);
  });

  test("a read-only calendar is never written", async () => {
    const f = fakes();
    const ics = { ...LOCAL_CAL, ics_url: "https://example.com/a.ics" };
    expect(await syncDeletedCalendarEvent("fam", ics, row(), f.deps)).toEqual({ provider: "local", synced: false, reason: "calendar_read_only" });
  });
});

test.describe("deleteVerdict: provider first, local row kept on failure", () => {
  test("synced or never linked → delete locally", () => {
    expect(deleteVerdict({ provider: "local", synced: true })).toEqual({ proceed: true });
    expect(deleteVerdict({ provider: "google", synced: true })).toEqual({ proceed: true });
    expect(deleteVerdict({ provider: "google", synced: false, reason: "not_linked" })).toEqual({ proceed: true });
    expect(deleteVerdict({ provider: "caldav", synced: false, reason: "not_linked" })).toEqual({ proceed: true });
  });

  test("a repeating occurrence or a server-side change is a conflict", () => {
    expect(deleteVerdict({ provider: "caldav", synced: false, reason: "recurring" })).toMatchObject({ proceed: false, status: 409, code: "conflict" });
    expect(deleteVerdict({ provider: "caldav", synced: false, reason: "conflict" })).toMatchObject({ proceed: false, status: 409, code: "conflict" });
  });

  test("anything else keeps the row and answers 502", () => {
    for (const reason of ["provider_write_failed", "google_not_connected", "caldav_not_connected"]) {
      expect(deleteVerdict({ provider: "google", synced: false, reason })).toMatchObject({ proceed: false, status: 502, code: "upstream_unavailable" });
    }
  });
});

// ---------------------------------------------------------------------------
// Family scoping: an event reaches a family only through its calendar
// ---------------------------------------------------------------------------

/** The same shape as e2e/family-scope.spec.ts's fakeClient: rows matched on every `.eq`. */
function fakeClient(rows: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  return {
    calls,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      calls.push({ table, filters });
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          const match = (rows[table] ?? []).find((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
          return { data: match ?? null, error: null };
        },
      };
      return chain;
    },
  };
}

/** The test boundary: the fake stands in for the real admin client. */
const asDb = (fake: ReturnType<typeof fakeClient>) => fake as unknown as FamilyEventDb;

test.describe("loadFamilyEvent", () => {
  const calendar = (id: string, family_id: string, extra: Record<string, unknown> = {}) => ({
    id, family_id, google_calendar_id: null, ics_url: null, caldav_url: null, caldav_server_url: null, caldav_read_only: null, ...extra,
  });
  const DATA = {
    calendars: [calendar("cal-ours", "fam-a"), calendar("cal-theirs", "fam-b"), calendar("cal-ics", "fam-a", { ics_url: "https://x/a.ics" })],
    events: [
      { ...row({ id: "ev-ours", calendar_id: "cal-ours" }) },
      { ...row({ id: "ev-theirs", calendar_id: "cal-theirs" }) },
      { ...row({ id: "ev-ics", calendar_id: "cal-ics" }) },
    ],
  };

  test("finds our event with its calendar", async () => {
    const found = await loadFamilyEvent(asDb(fakeClient(DATA)), "fam-a", "ev-ours");
    expect(found?.event.id).toBe("ev-ours");
    expect(found?.calendar.id).toBe("cal-ours");
  });

  test("an event in another family's calendar is null, like a missing one", async () => {
    expect(await loadFamilyEvent(asDb(fakeClient(DATA)), "fam-a", "ev-theirs")).toBeNull();
    expect(await loadFamilyEvent(asDb(fakeClient(DATA)), "fam-a", "ev-missing")).toBeNull();
  });

  test("it filters the calendar on family_id, not just on id", async () => {
    const db = fakeClient(DATA);
    await loadFamilyEvent(asDb(db), "fam-a", "ev-ours");
    expect(db.calls.find((c) => c.table === "calendars")?.filters).toEqual({ id: "cal-ours", family_id: "fam-a" });
  });

  test("an event in a read-only calendar is null, and empty ids match nothing", async () => {
    expect(await loadFamilyEvent(asDb(fakeClient(DATA)), "fam-a", "ev-ics")).toBeNull();
    expect(await loadFamilyEvent(asDb(fakeClient(DATA)), "", "ev-ours")).toBeNull();
  });
});
