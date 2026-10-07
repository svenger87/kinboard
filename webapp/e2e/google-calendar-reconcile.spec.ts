import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { matchesOr } from "./postgrest-or";
import {
  VISIBLE_CALENDARS,
  isVisibleCalendar,
  mergeReconnectedGoogleSettings,
  planGoogleCalendarReconcile,
  reconcileGoogleCalendars,
} from "../src/lib/google-calendar-reconcile";
import { fetchSchoolBreaks, type SchoolDb } from "../src/lib/school-days";
import { codeOnly } from "./source-helpers";

/**
 * Unticking a Google calendar in Settings -> Google Calendar used to change
 * only `enabled_calendars`. The syncs only ever looked at that list, so the
 * unticked calendar's row and events simply stayed: on prod, "Feiertage in
 * Deutschland" was unticked and still had 106 events and `is_holidays = true`
 * -- on every screen, and still deciding which days were school days.
 *
 * Now an unticked Google-backed row is switched off (`sync_enabled = false`,
 * keeping its colour, person and flags) and its events deleted, on save and
 * on every sync; ticking it again switches it back on. Every read path skips
 * a switched-off Google calendar.
 */

type Row = Record<string, unknown>;
type Filter =
  | { op: "eq" | "in" | "notnull" | "lte" | "gte"; column: string; value?: unknown }
  | { op: "or"; prefix: string; value: string };

/** A stand-in for the service-role client: enough of PostgREST for these reads and writes. */
function fakeDb(tables: Record<string, Row[]>) {
  const log: Array<{ table: string; verb: string; filters: Filter[]; patch?: Row }> = [];

  const get = (table: string, row: Row, column: string): unknown => {
    if (table === "events" && column.startsWith("calendars.")) {
      const cal = (tables.calendars ?? []).find((c) => c.id === row.calendar_id);
      return cal ? cal[column.slice("calendars.".length)] ?? null : undefined;
    }
    return row[column] ?? null;
  };
  const matches = (table: string, filters: Filter[]) => (row: Row) =>
    filters.every((f) => {
      if (f.op === "or") return matchesOr(f.value, (c) => get(table, row, `${f.prefix}${c}`));
      const actual = get(table, row, f.column);
      if (f.op === "eq") return actual === f.value;
      if (f.op === "in") return (f.value as unknown[]).includes(actual);
      if (f.op === "notnull") return actual !== null;
      if (f.op === "lte") return String(actual) <= String(f.value);
      return String(actual) >= String(f.value);
    });

  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      let verb = "select";
      let patch: Row | undefined;
      const run = () => {
        log.push({ table, verb, filters, patch });
        const rows = tables[table] ?? [];
        const hit = rows.filter(matches(table, filters));
        if (verb === "update") for (const r of hit) Object.assign(r, patch);
        if (verb === "delete") tables[table] = rows.filter((r) => !hit.includes(r));
        return { data: hit.map((r) => ({ ...r })), error: null };
      };
      const chain = {
        select() { return chain; },
        update(p: Row) { verb = "update"; patch = p; return chain; },
        delete() { verb = "delete"; return chain; },
        eq(column: string, value: unknown) { filters.push({ op: "eq", column, value }); return chain; },
        in(column: string, value: unknown[]) { filters.push({ op: "in", column, value }); return chain; },
        not(column: string, op: string, value: unknown) {
          if (op !== "is" || value !== null) throw new Error(`unsupported not(${column}, ${op}, ${String(value)})`);
          filters.push({ op: "notnull", column });
          return chain;
        },
        or(value: string, opts?: { referencedTable?: string }) {
          filters.push({ op: "or", prefix: opts?.referencedTable ? `${opts.referencedTable}.` : "", value });
          return chain;
        },
        lte(column: string, value: unknown) { filters.push({ op: "lte", column, value }); return chain; },
        gte(column: string, value: unknown) { filters.push({ op: "gte", column, value }); return chain; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as any, tables, log };
}

const OURS = "family-ours";
const THEIRS = "family-theirs";
const FEIERTAGE = "de.german#holiday@group.v.calendar.google.com";
const FAMILIE = "familie@group.calendar.google.com";
const ABFUHR = "abfuhr@group.calendar.google.com";

/** The prod household: three Google calendars, an ICS feed, a local calendar, and a neighbour. */
function household() {
  return fakeDb({
    calendars: [
      { id: "cal-feiertage", family_id: OURS, google_calendar_id: FEIERTAGE, sync_enabled: true, is_holidays: true, is_waste_collection: false, color: "#0b8043", person_id: null },
      { id: "cal-familie", family_id: OURS, google_calendar_id: FAMILIE, sync_enabled: true, is_holidays: false, is_waste_collection: false, color: "#3b82f6", person_id: "p-1" },
      { id: "cal-abfuhr", family_id: OURS, google_calendar_id: ABFUHR, sync_enabled: true, is_holidays: false, is_waste_collection: true, color: "#795548", person_id: null },
      { id: "cal-ics", family_id: OURS, google_calendar_id: null, ics_url: "https://example.test/ferien.ics", sync_enabled: true, is_holidays: true },
      // The demo seed's shape: a local calendar with sync_enabled = false that must stay on screen.
      { id: "cal-local", family_id: OURS, google_calendar_id: null, sync_enabled: false, is_holidays: false },
      // Another family subscribed to the very same Google holiday calendar.
      { id: "cal-theirs", family_id: THEIRS, google_calendar_id: FEIERTAGE, sync_enabled: true, is_holidays: true },
    ],
    events: [
      { id: "e-tag-der-einheit", calendar_id: "cal-feiertage", google_event_id: "g1", title: "Tag der Deutschen Einheit", all_day: true, start_at: "2026-10-03T12:00:00Z", end_at: "2026-10-03T12:00:00Z" },
      { id: "e-reformation", calendar_id: "cal-feiertage", google_event_id: "g2", title: "Reformationstag", all_day: true, start_at: "2026-10-31T12:00:00Z", end_at: "2026-10-31T12:00:00Z" },
      // Created in Kinboard, never pushed to Google (the push failed): only Kinboard has it.
      { id: "e-kinboard-only", calendar_id: "cal-feiertage", google_event_id: null, title: "Schulfest", all_day: true, start_at: "2026-10-16T12:00:00Z", end_at: "2026-10-16T12:00:00Z" },
      { id: "e-familie", calendar_id: "cal-familie", google_event_id: "g3", title: "Oma", all_day: false, start_at: "2026-10-05T15:00:00Z", end_at: "2026-10-05T16:00:00Z" },
      { id: "e-abfuhr", calendar_id: "cal-abfuhr", google_event_id: "g4", title: "Restmüll", all_day: true, start_at: "2026-10-06T12:00:00Z", end_at: "2026-10-06T12:00:00Z" },
      { id: "e-ics", calendar_id: "cal-ics", google_event_id: null, title: "Herbstferien", all_day: true, start_at: "2026-10-12T12:00:00Z", end_at: "2026-10-24T12:00:00Z" },
      { id: "e-local", calendar_id: "cal-local", google_event_id: null, title: "Elternabend", all_day: false, start_at: "2026-10-07T17:00:00Z", end_at: "2026-10-07T18:00:00Z" },
      { id: "e-theirs", calendar_id: "cal-theirs", google_event_id: "g1", title: "Tag der Deutschen Einheit", all_day: true, start_at: "2026-10-03T12:00:00Z", end_at: "2026-10-03T12:00:00Z" },
    ],
  });
}

const ids = (rows: Row[]) => rows.map((r) => r.id).sort();
const cal = (tables: Record<string, Row[]>, id: string) => tables.calendars.find((c) => c.id === id)!;

test.describe("reconcileGoogleCalendars", () => {
  test("unticking removes the calendar's events and switches its row off", async () => {
    const { db, tables } = household();
    const result = await reconcileGoogleCalendars(db, OURS, [FAMILIE, ABFUHR]);

    expect(result).toEqual({ disabled: 1, enabled: 0, deletedEvents: 2 });
    // Google's copies go; the event that exists only in Kinboard stays.
    expect(ids(tables.events.filter((e) => e.calendar_id === "cal-feiertage"))).toEqual(["e-kinboard-only"]);
    // The row stays, switched off, with everything the family set on it.
    expect(cal(tables, "cal-feiertage")).toMatchObject({ sync_enabled: false, is_holidays: true, color: "#0b8043" });
  });

  test("ticking it again switches it back on with its flags intact", async () => {
    const { db, tables } = household();
    await reconcileGoogleCalendars(db, OURS, [FAMILIE, ABFUHR]);
    const result = await reconcileGoogleCalendars(db, OURS, [FAMILIE, ABFUHR, FEIERTAGE]);

    expect(result).toEqual({ disabled: 0, enabled: 1, deletedEvents: 0 });
    expect(cal(tables, "cal-feiertage")).toMatchObject({
      sync_enabled: true, is_holidays: true, is_waste_collection: false, color: "#0b8043",
    });
    // The event only Kinboard had was kept, and is a school break again with its calendar.
    const breaks = await fetchSchoolBreaks(OURS, "2026-10-01", "2026-10-31", "Europe/Berlin", db as SchoolDb);
    expect(breaks.map((b) => b.name)).toContain("Schulfest");
  });

  test("the calendars still ticked, and every non-Google calendar, are untouched", async () => {
    const { db, tables } = household();
    const before = JSON.parse(JSON.stringify(tables));
    await reconcileGoogleCalendars(db, OURS, [FAMILIE, ABFUHR]);

    for (const id of ["cal-familie", "cal-abfuhr", "cal-ics", "cal-local"]) {
      expect(cal(tables, id), id).toEqual(cal(before, id));
    }
    expect(ids(tables.events)).toEqual(ids(before.events).filter((id: unknown) => id !== "e-tag-der-einheit" && id !== "e-reformation"));
    expect(cal(tables, "cal-theirs")).toEqual(cal(before, "cal-theirs"));
  });

  test("another family on the same Google calendar is untouched", async () => {
    const { db, tables, log } = household();
    await reconcileGoogleCalendars(db, OURS, [FAMILIE, ABFUHR]);

    expect(cal(tables, "cal-theirs").sync_enabled).toBe(true);
    expect(tables.events.some((e) => e.id === "e-theirs")).toBe(true);
    // And every calendars query named the family, not just this fixture's luck.
    for (const q of log.filter((l) => l.table === "calendars")) {
      expect(q.filters, `${q.verb} on calendars`).toContainEqual({ op: "eq", column: "family_id", value: OURS });
    }
  });

  test("with nothing ticked, every Google calendar goes and nothing else does", async () => {
    const { db, tables } = household();
    const result = await reconcileGoogleCalendars(db, OURS, []);

    expect(result).toEqual({ disabled: 3, enabled: 0, deletedEvents: 4 });
    expect(ids(tables.events)).toEqual(["e-ics", "e-kinboard-only", "e-local", "e-theirs"]);
    expect(cal(tables, "cal-ics").sync_enabled).toBe(true);
    expect(cal(tables, "cal-local").sync_enabled).toBe(false);
  });

  test("a setting without a list is not a decision to untick everything", async () => {
    const { db, tables, log } = household();
    const before = JSON.parse(JSON.stringify(tables));
    // A list with a non-id in it is not filtered down to its strings, which
    // would untick everything else: it is not a list we can act on.
    for (const missing of [undefined, null, "x", {}, [FAMILIE, { id: ABFUHR }], [42]]) {
      expect(await reconcileGoogleCalendars(db, OURS, missing)).toEqual({ disabled: 0, enabled: 0, deletedEvents: 0 });
    }
    expect(tables).toEqual(before);
    expect(log).toEqual([]);
  });

  test("events written into a switched-off calendar after the fact are cleared on the next run", async () => {
    // A sync that was mid-flight when the calendar was unticked can still
    // write into it; the next reconcile must not skip rows already off.
    const { db, tables } = household();
    await reconcileGoogleCalendars(db, OURS, [FAMILIE, ABFUHR]);
    tables.events.push({ id: "late", calendar_id: "cal-feiertage", google_event_id: "g9", title: "late", start_at: "2026-12-25T12:00:00Z", end_at: "2026-12-25T12:00:00Z" });
    const result = await reconcileGoogleCalendars(db, OURS, [FAMILIE, ABFUHR]);
    expect(result.deletedEvents).toBe(1);
    expect(tables.events.some((e) => e.id === "late")).toBe(false);
  });
});

test.describe("planGoogleCalendarReconcile", () => {
  test("a row with no Google id is never planned", () => {
    const plan = planGoogleCalendarReconcile(
      [{ id: "local", google_calendar_id: null, sync_enabled: false }],
      [],
    );
    expect(plan).toEqual({ off: [], on: [] });
  });

  test("a ticked row that is already on is left alone", () => {
    const plan = planGoogleCalendarReconcile(
      [{ id: "a", google_calendar_id: "g", sync_enabled: true }, { id: "b", google_calendar_id: "h", sync_enabled: null }],
      ["g", "h"],
    );
    expect(plan).toEqual({ off: [], on: [] });
  });
});

test.describe("which calendars are on screen", () => {
  const rows = [
    { google_calendar_id: null, sync_enabled: false, want: true },
    { google_calendar_id: null, sync_enabled: null, want: true },
    { google_calendar_id: "g", sync_enabled: true, want: true },
    { google_calendar_id: "g", sync_enabled: null, want: true },
    { google_calendar_id: "g", sync_enabled: false, want: false },
  ];

  test("only a switched-off Google calendar is hidden", () => {
    for (const { want, ...row } of rows) expect(isVisibleCalendar(row), JSON.stringify(row)).toBe(want);
  });

  test("an event whose calendar does not exist fails the filter, as with !inner", () => {
    expect(matchesOr(VISIBLE_CALENDARS, () => undefined)).toBe(false);
  });

  test("the PostgREST filter says the same as the JavaScript rule", () => {
    for (const { want, ...row } of rows) {
      expect(matchesOr(VISIBLE_CALENDARS, (c) => (row as Row)[c]), JSON.stringify(row)).toBe(want);
    }
  });
});

test.describe("reconnecting Google", () => {
  const CONNECTION = {
    access_token: "new-access", refresh_token: "new-refresh", expiry_date: 1_900_000_000_000,
    token_type: "Bearer", email: "familie@example.test", connected_at: "2026-10-02T12:00:00Z",
  };
  const STORED = {
    email: "familie@example.test",
    enabled_calendars: [FAMILIE, ABFUHR],
    mapping_rules: [{ id: "r1", person_id: "p-1", match_type: "contains", pattern: "Mara", priority: 1 }],
    auto_sync: true,
    last_sync: "2026-10-01T08:00:00Z",
    needs_reauth: true,
    auto_sync_error: "Token refresh failed",
    connected_at: "2026-01-01T00:00:00Z",
  };

  test("keeps the ticked calendars, mapping rules and auto-sync, and replaces the connection", () => {
    const merged = mergeReconnectedGoogleSettings(STORED, CONNECTION);
    expect(merged).toMatchObject({
      enabled_calendars: [FAMILIE, ABFUHR],
      mapping_rules: STORED.mapping_rules,
      auto_sync: true,
      last_sync: STORED.last_sync,
      ...CONNECTION,
      needs_reauth: false,
      auto_sync_error: null,
    });
  });

  test("so the first tick afterwards does not untick everything else", async () => {
    // The old callback stored the connection alone. The page then showed no
    // calendar ticked, and ticking one saved a one-calendar list.
    const { db, tables } = household();
    const merged = mergeReconnectedGoogleSettings(STORED, CONNECTION);
    const firstTick = [...(merged.enabled_calendars as string[]), FEIERTAGE];
    await reconcileGoogleCalendars(db, OURS, firstTick);
    expect(cal(tables, "cal-abfuhr").sync_enabled).toBe(true);
    expect(tables.events.some((e) => e.id === "e-abfuhr")).toBe(true);
  });

  test("a different Google account starts with nothing ticked, which reconcile leaves alone", async () => {
    const merged = mergeReconnectedGoogleSettings(STORED, { ...CONNECTION, email: "other@example.test" });
    expect(merged).not.toHaveProperty("enabled_calendars");
    expect(merged).toMatchObject({ mapping_rules: STORED.mapping_rules, auto_sync: true });
    const { db, tables } = household();
    const before = JSON.parse(JSON.stringify(tables));
    await reconcileGoogleCalendars(db, OURS, merged.enabled_calendars);
    expect(tables).toEqual(before);
  });

  test("the same account in different case is the same account", () => {
    const merged = mergeReconnectedGoogleSettings(STORED, { ...CONNECTION, email: "Familie@Example.test" });
    expect(merged.enabled_calendars).toEqual([FAMILIE, ABFUHR]);
  });

  test("a first connect has nothing to keep", () => {
    for (const nothing of [null, undefined, "x", []]) {
      expect(mergeReconnectedGoogleSettings(nothing, CONNECTION)).toEqual({
        ...CONNECTION, needs_reauth: false, auto_sync_error: null,
      });
    }
  });

  test("the callback merges into the stored setting rather than replacing it", () => {
    const s = codeOnly(readFileSync("src/app/api/google/callback/route.ts", "utf8"));
    const read = s.indexOf('.eq("key", "google_calendar")');
    const merge = s.indexOf("mergeReconnectedGoogleSettings(existing?.value,");
    const upsert = s.indexOf(".upsert(");
    expect(read, "the callback does not read the stored setting").toBeGreaterThan(0);
    expect(merge, "the callback does not merge").toBeGreaterThan(read);
    expect(upsert).toBeGreaterThan(merge);
  });
});

test.describe("school days", () => {
  test("an unticked Google holiday calendar no longer makes holidays", async () => {
    const { db } = household();
    const before = await fetchSchoolBreaks(OURS, "2026-10-01", "2026-10-31", "Europe/Berlin", db as SchoolDb);
    expect(before.map((b) => b.name)).toContain("Reformationstag");

    await reconcileGoogleCalendars(db, OURS, [FAMILIE, ABFUHR]);
    const after = await fetchSchoolBreaks(OURS, "2026-10-01", "2026-10-31", "Europe/Berlin", db as SchoolDb);
    expect(after.map((b) => b.name)).not.toContain("Reformationstag");
    expect(after.map((b) => b.name)).not.toContain("Tag der Deutschen Einheit");
    // Kept, but hidden with its calendar.
    expect(after.map((b) => b.name)).not.toContain("Schulfest");
    // The ICS holiday feed is still a holiday feed.
    expect(after.map((b) => b.name)).toContain("Herbstferien");
  });

  test("even before its events are deleted, a switched-off calendar decides nothing", async () => {
    // The window between the row going off and the delete finishing, or a
    // sync writing into it after the fact.
    const { db, tables } = household();
    cal(tables, "cal-feiertage").sync_enabled = false;
    const breaks = await fetchSchoolBreaks(OURS, "2026-10-01", "2026-10-31", "Europe/Berlin", db as SchoolDb);
    expect(breaks.map((b) => b.name)).not.toContain("Reformationstag");
    expect(breaks.map((b) => b.name)).toContain("Herbstferien");
  });
});

test.describe("it is wired in where the maintainer ruled", () => {
  const src = (p: string) => codeOnly(readFileSync(p, "utf8"));

  test("saving the ticked list reconciles right after the setting is written", () => {
    const s = src("src/app/api/google/calendars/route.ts");
    const save = s.indexOf("enabled_calendars,\n");
    const reconcile = s.indexOf("reconcileGoogleCalendars(supabase, family_id, enabled_calendars)");
    expect(save, "the settings update is not where it was").toBeGreaterThan(0);
    expect(reconcile, "POST /api/google/calendars does not reconcile").toBeGreaterThan(save);
  });

  test("a failed reconcile after a successful save is not reported as a failed save", () => {
    // The page reverts the checkbox on any non-2xx, over a setting that was saved.
    const s = src("src/app/api/google/calendars/route.ts");
    const failure = s.slice(s.indexOf("} catch (reconcileError) {"));
    expect(failure).toContain('warning: "reconcile_failed"');
    expect(failure.slice(0, failure.indexOf("\n  }\n"))).not.toMatch(/status:\s*5\d\d/);
  });

  for (const [route, family] of [
    ["src/app/api/google/sync/route.ts", "family_id"],
    ["src/app/api/cron/google-sync/route.ts", "familyId"],
  ] as const) {
    test(`${route} reconciles before its nothing-ticked early return`, () => {
      const s = src(route);
      const reconcile = s.indexOf(`reconcileGoogleCalendars(supabase, ${family}, settings.enabled_calendars)`);
      const early = s.indexOf("if (enabledCalendars.length === 0)");
      expect(reconcile, "the sync does not reconcile").toBeGreaterThan(0);
      expect(early).toBeGreaterThan(0);
      expect(reconcile, "reconcile runs after the early return, so unticking the last calendar leaves its events").toBeLessThan(early);
    });
  }

  // Every read of calendars or events that a screen, an assistant or the
  // school-day logic sees. The export (a backup, which keeps every row) and
  // the syncers themselves are deliberately not on it.
  const READ_PATHS: Array<[file: string, uses: number]> = [
    ["src/hooks/use-supabase-queries.ts", 3], // useCalendars, useEvents, useEventById
    ["src/lib/school-days.ts", 1],
    ["src/lib/attention/signals.ts", 1],
    ["src/app/api/integration/v1/calendars/route.ts", 1],
    // The listing's calendar read lives in lib/integration-event-search.ts
    // (familyCalendarIds), shared with the week summary; the create stays here.
    ["src/app/api/integration/v1/calendar/events/route.ts", 1],
    ["src/lib/integration-event-search.ts", 1],
    ["src/app/api/integration/v1/family/summary/route.ts", 2],
    ["src/app/api/calendar/feed/route.ts", 1],
    ["src/app/api/cron/schedule-event-reminders/route.ts", 1],
  ];
  for (const [file, uses] of READ_PATHS) {
    test(`${file} skips unticked Google calendars`, () => {
      const count = src(file).match(/\.or\(VISIBLE_CALENDARS\b/g)?.length ?? 0;
      expect(count, `${file} filters fewer reads than it should`).toBe(uses);
    });
  }

  test("an assistant cannot edit an event on an unticked calendar", () => {
    const s = src("src/lib/family-event-scope.ts");
    expect(s).toContain("sync_enabled");
    expect(s).toMatch(/if \(!isVisibleCalendar\(found\.calendar/);
  });

  test("screens already open drop the calendar and its events without a reload", () => {
    // Events deleted on the server reach open screens through the `events`
    // realtime subscription; a calendar switched off through `calendars`.
    const realtime = src("src/hooks/use-realtime.ts");
    const all = /const ALL_TABLES: TableName\[\] = \[([\s\S]*?)\]/.exec(realtime)![1];
    expect(all).toContain('"events"');
    expect(all, "calendars is not subscribed, so open screens keep a switched-off calendar").toContain('"calendars"');
    const handler = realtime.slice(realtime.indexOf('case "calendars":'), realtime.indexOf("break;", realtime.indexOf('case "calendars":')));
    expect(handler).toContain('queryKey: ["calendars", family.id]');
    expect(handler).toContain('queryKey: ["events", family.id]');

    // And the screen that did the unticking refetches straight away.
    const hook = src("src/hooks/use-google-calendar.ts");
    const mutation = hook.slice(hook.indexOf("export function useUpdateEnabledCalendars"), hook.indexOf("export function useGoogleCalendarSync"));
    expect(mutation).toContain('queryKey: ["events", family?.id]');
    expect(mutation).toContain('queryKey: ["calendars", family?.id]');
  });
});
