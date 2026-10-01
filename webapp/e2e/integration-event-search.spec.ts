import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SEARCH_COLUMNS,
  SEARCH_LIMIT,
  defaultSearchWindow,
  literalPattern,
  parseSearchQuery,
  searchEvents,
  type SearchDb,
} from "../src/lib/integration-event-search";
import { parseEventInput, parseEventPatch } from "../src/lib/integration-event-input";
import { familyPersonId, type TaskDb } from "../src/lib/integration-tasks";
import {
  googlePersonProperty,
  syncUpdatedCalendarEvent,
  type GoogleEventsApi,
  type StoredCalendarEvent,
  type WritableCalendar,
  type WriteThroughDeps,
} from "../src/lib/calendar-write-through";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 5: finding an appointment by name, and saying who it is for.
 *
 * The search is tested against a fake client that really applies the
 * filters it is given — `in`, the overlap, and `imatch` evaluated as a
 * case-insensitive regular expression — so an unescaped pattern really does
 * match too much here, and a filter the code forgets really does let a row
 * through. The fake has no `.or()`: a search that built one would throw.
 */

const BERLIN = "Europe/Berlin";
const CAL = "f1563352-af89-41e6-9173-cf9f616fbeb2";
const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const MIA = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const OTHER_CHILD = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001";

type Row = Record<string, unknown>;

function fakeEvents(rows: Row[]) {
  const calls: Array<Array<[string, ...unknown[]]>> = [];
  const db = {
    from(table: string) {
      expect(table).toBe("events");
      const ops: Array<[string, ...unknown[]]> = [];
      calls.push(ops);
      let limit = Infinity;
      const chain = {
        select(columns: string) { ops.push(["select", columns]); return chain; },
        in(column: string, values: string[]) { ops.push(["in", column, values]); return chain; },
        lt(column: string, value: string) { ops.push(["lt", column, value]); return chain; },
        gt(column: string, value: string) { ops.push(["gt", column, value]); return chain; },
        regexIMatch(column: string, pattern: string) { ops.push(["imatch", column, pattern]); return chain; },
        order(column: string, options: { ascending: boolean }) { ops.push(["order", column, options]); return chain; },
        limit(count: number) { ops.push(["limit", count]); limit = count; return chain; },
        then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
          const keep = (row: Row) => ops.every(([op, column, value]) => {
            const cell = row[column as string];
            if (op === "in") return (value as string[]).includes(cell as string);
            if (op === "lt") return Date.parse(cell as string) < Date.parse(value as string);
            if (op === "gt") return Date.parse(cell as string) > Date.parse(value as string);
            if (op === "imatch") return typeof cell === "string" && new RegExp(value as string, "i").test(cell);
            return true;
          });
          // Only the orders the code asks for, in its order; rows tied on
          // all of them stay in storage order, which a real database does
          // not promise either.
          const orders = ops.filter(([op]) => op === "order").map(([, column]) => column as string);
          const compare = (a: Row, b: Row) => {
            for (const column of orders) {
              const x = a[column] as string, y = b[column] as string;
              const d = column.endsWith("_at") ? Date.parse(x) - Date.parse(y) : x < y ? -1 : x > y ? 1 : 0;
              if (d !== 0) return d;
            }
            return 0;
          };
          const data = rows.filter(keep).sort(compare).slice(0, limit);
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as SearchDb, calls };
}

const WINDOW = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2027-10-01T00:00:00Z") };
let n = 0;
function ev(title: string, extra: Row = {}): Row {
  n += 1;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  return {
    id, calendar_id: CAL, title, description: null, location: null,
    start_at: "2026-10-05T08:00:00.000Z", end_at: "2026-10-05T09:00:00.000Z", all_day: false, person_id: null,
    ...extra,
  };
}

test.describe("the query is text, never filter syntax", () => {
  test("every ASCII punctuation character is escaped, letters and other scripts are not", () => {
    expect(literalPattern("Dentist")).toBe("Dentist");
    expect(literalPattern("Zahnärztin Müller")).toBe("Zahnärztin Müller");
    expect(literalPattern("50% off")).toBe("50\\% off");
    expect(literalPattern("a_b*c\\d")).toBe("a\\_b\\*c\\\\d");
    expect(literalPattern("x),id.not.is.null")).toBe("x\\)\\,id\\.not\\.is\\.null");
    for (let code = 0x21; code <= 0x7e; code++) {
      const c = String.fromCharCode(code);
      if (/[A-Za-z0-9]/.test(c)) continue;
      expect(literalPattern(c), c).toBe(`\\${c}`);
    }
  });

  test("a hostile query matches only itself, in every column", async () => {
    const hostile = [
      "x),id.not.is.null,title.imatch.(",
      "%", "_", "*", ".*", "\\", "(", ")", ",", "a|b", "[a-z]", "^", "$",
    ];
    const rows = [ev("Dentist"), ev("Swimming", { location: "Pool" }), ev("Piano", { description: "bring notes" })];
    for (const q of hostile) {
      const { db } = fakeEvents(rows);
      expect(await searchEvents(db, [CAL], q, WINDOW.start, WINDOW.end), q).toEqual([]);
    }
    const literal = ev("Sale: 50% off (a_b*) x),id.not.is.null \\ [a-z] a|b");
    const { db } = fakeEvents([...rows, literal]);
    for (const q of hostile.filter((h) => !["x),id.not.is.null,title.imatch.(", ".*", "^", "$"].includes(h))) {
      expect((await searchEvents(db, [CAL], q, WINDOW.start, WINDOW.end)).map((e) => e.id), q).toEqual([literal.id]);
    }
  });

  test("one imatch per column, each a single filter value, no .or()", async () => {
    const { db, calls } = fakeEvents([]);
    await searchEvents(db, [CAL], "a,b", WINDOW.start, WINDOW.end);
    expect(calls).toHaveLength(SEARCH_COLUMNS.length);
    expect(calls.map((ops) => ops.find(([op]) => op === "imatch"))).toEqual(
      SEARCH_COLUMNS.map((column) => ["imatch", column, "a\\,b"]),
    );
    for (const ops of calls) {
      expect(ops).toContainEqual(["in", "calendar_id", [CAL]]);
      expect(ops).toContainEqual(["lt", "start_at", WINDOW.end.toISOString()]);
      expect(ops).toContainEqual(["gt", "end_at", WINDOW.start.toISOString()]);
      expect(ops).toContainEqual(["limit", SEARCH_LIMIT]);
    }
  });

  test("blank, over-long and control-character queries are refused", () => {
    expect(parseSearchQuery("  dentist ")).toEqual({ ok: true, value: "dentist" });
    for (const bad of ["", "   ", "x".repeat(201), "a\nb", "a\u0000b"]) {
      expect(parseSearchQuery(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

test.describe("what a search finds", () => {
  test("title, location or description, ignoring case, inside the family's calendars and window", async () => {
    const byTitle = ev("Dentist Mia");
    const byLocation = ev("Check-up", { location: "DENTIST Dr. Weber", start_at: "2026-10-04T08:00:00.000Z", end_at: "2026-10-04T09:00:00.000Z" });
    const byDescription = ev("Appointment", { description: "the dentist again" });
    const elsewhere = ev("Dentist", { calendar_id: "other-family-calendar" });
    const tooLate = ev("Dentist", { start_at: "2028-01-01T08:00:00.000Z", end_at: "2028-01-01T09:00:00.000Z" });
    const unrelated = ev("Swimming");
    const { db } = fakeEvents([byTitle, byLocation, byDescription, elsewhere, tooLate, unrelated]);
    const found = await searchEvents(db, [CAL], "dentist", WINDOW.start, WINDOW.end);
    // byLocation starts a day earlier; the other two start together and
    // fall back to id order.
    expect(found.map((e) => e.id)).toEqual([byLocation.id, byTitle.id, byDescription.id]);
  });

  test("an event matching in two columns comes once; at most 100, earliest first", async () => {
    const both = ev("Dentist", { location: "Dentist practice" });
    const many = Array.from({ length: 150 }, (_, i) => ev(`Dentist ${i}`, {
      start_at: new Date(Date.UTC(2026, 10, 1) + i * 3_600_000).toISOString(),
      end_at: new Date(Date.UTC(2026, 10, 1) + i * 3_600_000 + 1_800_000).toISOString(),
    }));
    const { db } = fakeEvents([...many.slice().reverse(), both]);
    const found = await searchEvents(db, [CAL], "dentist", WINDOW.start, WINDOW.end);
    expect(found).toHaveLength(SEARCH_LIMIT);
    expect(found.filter((e) => e.id === both.id)).toHaveLength(1);
    expect(found[0].id).toBe(both.id);
    expect(found[1].id).toBe(many[0].id);
    expect(found[99].id).toBe(many[98].id);
  });

  test("ties at the cut are decided by id, in each request as in the merge", async () => {
    const tied = Array.from({ length: 150 }, (_, i) => ev(`Dentist ${i}`, {
      start_at: "2026-11-01T08:00:00.000Z", end_at: "2026-11-01T09:00:00.000Z",
    }));
    // Stored newest id first, so storage order is the wrong answer.
    const { db, calls } = fakeEvents(tied.slice().reverse());
    const found = await searchEvents(db, [CAL], "dentist", WINDOW.start, WINDOW.end);
    expect(found.map((e) => e.id)).toEqual(tied.slice(0, SEARCH_LIMIT).map((e) => e.id));
    for (const ops of calls) {
      expect(ops.filter(([op]) => op === "order")).toEqual([
        ["order", "start_at", { ascending: true }],
        ["order", "id", { ascending: true }],
      ]);
    }
  });

  test("the length cap counts characters, not UTF-16 units", () => {
    expect(parseSearchQuery("🦷".repeat(200)).ok).toBe(true);
    expect(parseSearchQuery("🦷".repeat(201)).ok).toBe(false);
  });

  test("no calendars, no query", async () => {
    const { db, calls } = fakeEvents([ev("Dentist")]);
    expect(await searchEvents(db, [], "dentist", WINDOW.start, WINDOW.end)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

test.describe("the default window is today and 365 days on, in the family's zone", () => {
  test("just after midnight in Berlin, today is already the new day", () => {
    // 00:30 on 2 Oct in Berlin (CEST) is still 1 Oct in UTC.
    const w = defaultSearchWindow(new Date("2026-10-01T22:30:00Z"), BERLIN);
    expect(w.start.toISOString()).toBe("2026-10-01T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2027-10-01T22:00:00.000Z");
  });

  test("across a zone change the end is local midnight too", () => {
    const w = defaultSearchWindow(new Date("2026-03-01T12:00:00Z"), BERLIN);
    expect(w.start.toISOString()).toBe("2026-02-28T23:00:00.000Z");
    expect(w.end.toISOString()).toBe("2027-02-28T23:00:00.000Z");
    const ny = defaultSearchWindow(new Date("2026-10-01T03:00:00Z"), "America/New_York");
    expect(ny.start.toISOString()).toBe("2026-09-30T04:00:00.000Z");
  });

  test("the route uses it only for a search with neither bound, and the given bounds unchanged otherwise", () => {
    const route = codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "calendar", "events", "route.ts"), "utf8"));
    expect(route).toMatch(/query && startRaw === null && endRaw === null\s*\?\s*\{ ok: true, \.\.\.defaultSearchWindow\(new Date\(\), await familyTimeZone\(context\.familyId\)\) \}\s*:\s*parseRange\(startRaw, endRaw\)/);
    expect(route).toContain("searchEvents(");
  });
});

// ---------------------------------------------------------------------------
// person_id on create and edit
// ---------------------------------------------------------------------------

test.describe("person_id is shape-checked by the parsers", () => {
  const TIMED = { start_at: "2026-10-03T07:00:00.000Z", end_at: "2026-10-03T08:00:00.000Z", all_day: false };
  const base = { calendar_id: CAL, title: "Dentist", start_at: "2026-10-03T09:00:00+02:00", end_at: "2026-10-03T10:00:00+02:00" };

  test("create takes a uuid or null, and leaves it out when absent", () => {
    const withPerson = parseEventInput({ ...base, person_id: MIA }, BERLIN);
    expect(withPerson.ok && withPerson.value.personId).toBe(MIA);
    const nobody = parseEventInput({ ...base, person_id: null }, BERLIN);
    expect(nobody.ok && nobody.value.personId).toBeNull();
    const absent = parseEventInput(base, BERLIN);
    expect(absent.ok && "personId" in absent.value).toBe(false);
    for (const bad of ["mia", 7, "", {}]) {
      expect(parseEventInput({ ...base, person_id: bad }, BERLIN)).toEqual({ ok: false, error: "`person_id` must be a uuid or null" });
    }
  });

  test("a patch may change only the person, or clear it", () => {
    expect(parseEventPatch({ person_id: MIA }, TIMED, BERLIN)).toEqual({ ok: true, value: { columns: { person_id: MIA } } });
    expect(parseEventPatch({ person_id: null }, TIMED, BERLIN)).toEqual({ ok: true, value: { columns: { person_id: null } } });
    expect(parseEventPatch({ person_id: "mia" }, TIMED, BERLIN)).toEqual({ ok: false, error: "`person_id` must be a uuid or null" });
  });
});

test.describe("person_id names a person of this family", () => {
  function peopleDb() {
    const people = [
      { id: MIA, family_id: OURS, deleted_at: null },
      { id: OTHER_CHILD, family_id: THEIRS, deleted_at: null },
    ];
    return {
      from() {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          select: () => chain,
          eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
          is: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
          maybeSingle: async () => ({
            data: people.find((p) => filters.every(([c, v]) => ((p as Row)[c] ?? null) === v)) ?? null,
            error: null,
          }),
        };
        return chain;
      },
    } as unknown as TaskDb;
  }

  test("ours is accepted; another family's is refused like a missing one", async () => {
    expect(await familyPersonId(peopleDb(), OURS, MIA)).toEqual({ ok: true, value: MIA });
    expect(await familyPersonId(peopleDb(), OURS, OTHER_CHILD)).toEqual({ ok: false, error: "no such person in this family" });
  });

  test("both routes check the person before writing the row", () => {
    const read = (...p: string[]) => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "calendar", "events", ...p), "utf8"));
    const post = read("route.ts");
    const check = post.indexOf("familyPersonId(supabase, context.familyId, event.personId)");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(post.indexOf(".insert("));
    const patch = read("[id]", "route.ts");
    const patchCheck = patch.indexOf("familyPersonId(createAdminClient(), context.familyId, columns.person_id)");
    expect(patchCheck).toBeGreaterThan(-1);
    expect(patchCheck).toBeLessThan(patch.indexOf(".update(columns)"));
  });
});

test.describe("Google keeps the assignee, so its next sync does not undo it", () => {
  const GOOGLE_CAL: WritableCalendar = {
    id: "cal-1", google_calendar_id: "family@group.calendar.google.com", ics_url: null, caldav_url: null, caldav_server_url: null, caldav_read_only: null,
  };
  const row = (extra: Partial<StoredCalendarEvent> = {}): StoredCalendarEvent => ({
    id: "ev-1", calendar_id: "cal-1", title: "Dentist", description: null, location: null,
    start_at: "2026-10-03T07:00:00.000Z", end_at: "2026-10-03T08:00:00.000Z", all_day: false,
    google_event_id: "g-1", caldav_href: null, caldav_etag: null, ...extra,
  });
  function google() {
    const patches: Array<{ requestBody: Record<string, unknown> }> = [];
    const api: GoogleEventsApi = {
      async patch(params) { patches.push(params as never); },
      async delete() {},
    };
    const deps: WriteThroughDeps = {
      googleEvents: async () => api,
      caldavEvents: async () => null,
      saveCaldavEtag: async () => {},
      saveCaldavLink: async () => {},
    };
    return { patches, deps };
  }

  test("an edit that sets the person writes it to the private extended property the sync reads", async () => {
    const g = google();
    await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, row({ person_id: MIA }), undefined, BERLIN, g.deps);
    expect(g.patches[0].requestBody.extendedProperties).toEqual({ private: { person_id: MIA } });
  });

  test("clearing writes an empty one, as the screens do; an edit that did not touch it leaves it alone", async () => {
    const cleared = google();
    await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, row({ person_id: null }), undefined, BERLIN, cleared.deps);
    expect(cleared.patches[0].requestBody.extendedProperties).toEqual({ private: { person_id: "" } });
    const untouched = google();
    await syncUpdatedCalendarEvent("fam", GOOGLE_CAL, row(), undefined, BERLIN, untouched.deps);
    expect(untouched.patches[0].requestBody).not.toHaveProperty("extendedProperties");
  });

  test("the property is the one google/sync reads, and create sends it only for a person", () => {
    expect(googlePersonProperty(MIA)).toEqual({ private: { person_id: MIA } });
    const sync = readFileSync(join(__dirname, "..", "src", "app", "api", "google", "sync", "route.ts"), "utf8");
    expect(sync).toContain("event.extendedProperties?.private?.person_id");
    const writeThrough = codeOnly(readFileSync(join(__dirname, "..", "src", "lib", "calendar-write-through.ts"), "utf8"));
    expect(writeThrough).toContain("...(event.person_id ? { extendedProperties: googlePersonProperty(event.person_id) } : {})");
  });

  test("PATCH hands the assignee to the provider only when the edit set it", () => {
    const patch = codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "calendar", "events", "[id]", "route.ts"), "utf8"));
    expect(patch).toContain('"person_id" in columns ? { ...stored, person_id: assignee ?? null } : stored');
  });
});
