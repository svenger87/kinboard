import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDays,
  dayOfWeekOf,
  fetchSchoolBreaks,
  loadTimetables,
  normalizeSlots,
  schoolDayStatus,
  schoolOn,
  type SchoolDb,
} from "../src/lib/school-days";
import { readSchedule } from "../src/lib/integration-schedule";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 6: the school timetable for assistants, and the summary's
 * `school_tomorrow` reading the same helper.
 *
 * The fake client applies every eq / is-null / lte / gte filter it is given,
 * resolves `calendars.<column>` through the event's calendar the way the
 * `calendars!inner` join does, and honours `order`. So a query that forgets
 * the family, the bin, or the holiday window really does reach the wrong row.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const P = (n: number) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;
const CAL = (n: number) => `cccccccc-cccc-cccc-cccc-${String(n).padStart(12, "0")}`;
const TZ = "Europe/Berlin";

// 2026-10-05 is a Monday.
const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const SATURDAY = "2026-10-10";

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "isnull" | "lte" | "gte", column: string, value?: unknown];

function fakeDb(tables: Record<string, Row[]>) {
  const queries: Array<{ table: string; filters: Filter[] }> = [];
  let failOn: string | null = null;

  const value = (table: string, row: Row, column: string) => {
    if (table === "events" && column.startsWith("calendars.")) {
      const cal = (tables.calendars ?? []).find((c) => c.id === row.calendar_id);
      return cal ? cal[column.slice("calendars.".length)] ?? null : undefined;
    }
    return row[column] ?? null;
  };
  const matches = (table: string, filters: Filter[]) => (row: Row) =>
    filters.every(([op, column, v]) => {
      const actual = value(table, row, column);
      if (op === "isnull") return actual === null;
      if (op === "eq") return actual === v;
      if (op === "lte") return String(actual) <= String(v);
      return String(actual) >= String(v);
    });

  const db = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: Filter[] = [];
      let orderBy: string | null = null;
      queries.push({ table, filters });

      const result = () => {
        if (failOn === table) return { data: null, error: { message: `${table} failed` } };
        let hit = rows.filter(matches(table, filters));
        if (orderBy) hit = [...hit].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
        return { data: hit.map((r) => ({ ...r })), error: null };
      };

      const chain = {
        select() { return chain; },
        eq(column: string, v: unknown) { filters.push(["eq", column, v]); return chain; },
        is(column: string, v: unknown) {
          if (v !== null) throw new Error(`unsupported is(${column}, ${String(v)})`);
          filters.push(["isnull", column]);
          return chain;
        },
        lte(column: string, v: unknown) { filters.push(["lte", column, v]); return chain; },
        gte(column: string, v: unknown) { filters.push(["gte", column, v]); return chain; },
        order(column: string) { orderBy = column; return chain; },
        async maybeSingle() { const r = result(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as SchoolDb, queries, failOn(table: string) { failOn = table; } };
}

const lesson = (period: number, start: string, end: string, subject: string, room?: string) =>
  ({ period, start, end, subject, ...(room ? { room } : {}) });

/**
 * Mara and Enno are our children. Opa is an adult with a stray schedule row,
 * Lotte is in the recycle bin with her timetable still behind, Ida has a
 * schedule row with no lessons left in it. Kim is another family's child.
 */
function household(extra: Partial<Record<string, Row[]>> = {}) {
  return fakeDb({
    people: [
      { id: P(1), family_id: OURS, name: "Mara", is_child: true, deleted_at: null, created_at: "2026-01-01" },
      { id: P(2), family_id: OURS, name: "Enno", is_child: true, deleted_at: null, created_at: "2026-01-02" },
      { id: P(3), family_id: OURS, name: "Opa", is_child: false, deleted_at: null, created_at: "2026-01-03" },
      { id: P(4), family_id: OURS, name: "Lotte", is_child: true, deleted_at: "2026-09-30T10:00:00Z", created_at: "2026-01-04" },
      { id: P(5), family_id: OURS, name: "Ida", is_child: true, deleted_at: null, created_at: "2026-01-05" },
      { id: P(9), family_id: THEIRS, name: "Kim", is_child: true, deleted_at: null, created_at: "2026-01-01" },
      ...(extra.people ?? []),
    ],
    schedules: [
      // Out of time order on purpose, and Tuesday before Monday.
      { family_id: OURS, person_id: P(1), day_of_week: 2, time_slots: [lesson(1, "08:00", "08:45", "Deutsch")] },
      { family_id: OURS, person_id: P(1), day_of_week: 1, time_slots: [
        lesson(2, "08:50", "09:35", "Sport", "Halle"),
        lesson(1, "08:00", "08:45", "Mathe", "  "),
        { period: 3, start: "09:50", end: "10:35", subject: "" },
      ] },
      { family_id: OURS, person_id: P(2), day_of_week: 1, time_slots: [lesson(1, "08:00", "08:45", "Kunst", "R12")] },
      { family_id: OURS, person_id: P(3), day_of_week: 1, time_slots: [lesson(1, "08:00", "08:45", "Bridge")] },
      { family_id: OURS, person_id: P(4), day_of_week: 1, time_slots: [lesson(1, "08:00", "08:45", "Binned")] },
      { family_id: OURS, person_id: P(5), day_of_week: 1, time_slots: [] },
      { family_id: THEIRS, person_id: P(9), day_of_week: 1, time_slots: [lesson(1, "08:00", "08:45", "Foreign")] },
      ...(extra.schedules ?? []),
    ],
    school_holidays: [
      { family_id: THEIRS, name: "Their break", starts_on: "2026-10-01", ends_on: "2026-10-31" },
      ...(extra.school_holidays ?? []),
    ],
    calendars: [
      { id: CAL(1), family_id: OURS, is_holidays: true },
      { id: CAL(2), family_id: OURS, is_holidays: false },
      { id: CAL(9), family_id: THEIRS, is_holidays: true },
      ...(extra.calendars ?? []),
    ],
    events: [
      // An ordinary all-day event on our normal calendar is not a holiday.
      { calendar_id: CAL(2), title: "Ausflug", all_day: true, start_at: "2026-10-04T22:00:00Z", end_at: "2026-10-05T22:00:00Z" },
      // Another family's holiday calendar.
      { calendar_id: CAL(9), title: "Their ICS break", all_day: true, start_at: "2026-10-04T22:00:00Z", end_at: "2026-10-06T22:00:00Z" },
      ...(extra.events ?? []),
    ],
  });
}

test.describe("the weekly timetable", () => {
  test("lists our children with lessons, Monday first, lessons in time order", async () => {
    const { db } = household();
    const children = await loadTimetables(OURS, {}, db);
    expect(children.map((c) => c.name)).toEqual(["Mara", "Enno"]);
    const mara = children[0];
    expect(mara.person_id).toBe(P(1));
    expect(mara.days.map((d) => d.weekday)).toEqual(["monday", "tuesday"]);
    expect(mara.days[0]).toEqual({
      day_of_week: 1,
      weekday: "monday",
      slots: [
        { period: 1, start: "08:00", end: "08:45", subject: "Mathe", room: null },
        { period: 2, start: "08:50", end: "09:35", subject: "Sport", room: "Halle" },
      ],
    });
  });

  test("leaves out a binned child, an adult, a child with no lessons and another family's child", async () => {
    const { db } = household();
    const names = (await loadTimetables(OURS, {}, db)).map((c) => c.name);
    for (const absent of ["Lotte", "Opa", "Ida", "Kim"]) expect(names).not.toContain(absent);
  });

  test("a schedule row only counts when both it and its person are this family's", async () => {
    // Inconsistent rows on purpose: each family filter is the only thing
    // keeping one of them out.
    const { db } = household({
      schedules: [
        { family_id: OURS, person_id: P(9), day_of_week: 3, time_slots: [lesson(1, "08:00", "08:45", "Leak A")] },
        { family_id: THEIRS, person_id: P(2), day_of_week: 3, time_slots: [lesson(1, "08:00", "08:45", "Leak B")] },
      ],
    });
    const all = JSON.stringify(await loadTimetables(OURS, {}, db));
    expect(all).not.toContain("Leak");
    expect(all).not.toContain("Kim");
  });

  test("person_id narrows to one child; bad, foreign and binned ids are refused", async () => {
    const { db } = household();
    const one = await readSchedule(OURS, { personId: P(2), day: null }, TZ, db);
    expect(one.status).toBe(200);
    expect(((one.body as Record<string, unknown>).children as { name: string }[]).map((c) => c.name)).toEqual(["Enno"]);

    expect((await readSchedule(OURS, { personId: "nope", day: null }, TZ, db)).status).toBe(400);
    for (const id of [P(9), P(4), P(77)]) {
      const r = await readSchedule(OURS, { personId: id, day: null }, TZ, db);
      expect(r, id).toEqual({ status: 404, body: { error: "no such person in this family", code: "not_found" } });
    }
  });

  test("day must be a real YYYY-MM-DD date", async () => {
    const { db } = household();
    for (const day of ["2026-02-30", "tomorrow", "2026-10-5"]) {
      const r = await readSchedule(OURS, { personId: null, day }, TZ, db);
      expect(r.status, day).toBe(400);
      expect(r.body).toMatchObject({ code: "invalid_request" });
    }
  });

  test("normalizeSlots drops non-lessons and nulls malformed fields", () => {
    expect(normalizeSlots(null)).toEqual([]);
    expect(normalizeSlots([null, "x", { subject: "  " }, { subject: "Bio", period: "2", start: 800, room: 5 }]))
      .toEqual([{ period: null, start: null, end: null, subject: "Bio", room: null }]);
  });
});

test.describe("one day", () => {
  test("a weekday in term lists who has which lessons", async () => {
    const { db } = household();
    const day = await schoolOn(OURS, MONDAY, TZ, {}, db);
    expect(day).toMatchObject({ date: MONDAY, weekday: "monday", school_day: true, reason: null, holiday: null });
    expect(day.children.map((c) => [c.name, c.slots.map((s) => s.subject)])).toEqual([
      ["Mara", ["Mathe", "Sport"]],
      ["Enno", ["Kunst"]],
    ]);
    const tuesday = await schoolOn(OURS, TUESDAY, TZ, {}, db);
    expect(tuesday.children.map((c) => c.name)).toEqual(["Mara"]);
  });

  test("a Saturday is no school day, with reason weekend, and lists nobody", async () => {
    const { db } = household({
      // Even a stray Saturday lesson does not make it a school day.
      schedules: [{ family_id: OURS, person_id: P(1), day_of_week: 6, time_slots: [lesson(1, "08:00", "08:45", "AG")] }],
    });
    expect(await schoolOn(OURS, SATURDAY, TZ, {}, db)).toEqual({
      date: SATURDAY, weekday: "saturday", school_day: false, reason: "weekend", holiday: null, children: [],
    });
    expect((await schoolDayStatus(OURS, "2026-10-11", TZ, db)).reason).toBe("weekend");
  });

  test("a holiday typed in by hand covers its first and last day, not the day after", async () => {
    const { db } = household({
      school_holidays: [{ family_id: OURS, name: "Herbstferien", starts_on: "2026-10-05", ends_on: "2026-10-06" }],
    });
    for (const d of [MONDAY, TUESDAY]) {
      expect(await schoolOn(OURS, d, TZ, {}, db)).toMatchObject({ school_day: false, reason: "holiday", holiday: "Herbstferien", children: [] });
    }
    expect((await schoolOn(OURS, "2026-10-07", TZ, {}, db)).school_day).toBe(true);
    expect((await schoolOn(OURS, "2026-10-02", TZ, {}, db)).school_day).toBe(true);
  });

  test("an all-day event on a holidays calendar counts, its exclusive end does not", async () => {
    const { db } = household({
      // Monday and Tuesday, ending (exclusive) at Wednesday's local midnight.
      events: [{ calendar_id: CAL(1), title: "Herbstferien (ICS)", all_day: true, start_at: "2026-10-04T22:00:00Z", end_at: "2026-10-06T22:00:00Z" }],
    });
    expect(await schoolDayStatus(OURS, MONDAY, TZ, db)).toMatchObject({ school_day: false, reason: "holiday", holiday: "Herbstferien (ICS)" });
    expect((await schoolDayStatus(OURS, TUESDAY, TZ, db)).reason).toBe("holiday");
    expect((await schoolDayStatus(OURS, "2026-10-07", TZ, db)).school_day).toBe(true);
  });

  test("another family's holidays and an ordinary calendar's all-day event change nothing", async () => {
    const { db } = household();
    // household() has THEIRS's manual break and ICS break over Monday, and
    // an all-day "Ausflug" on our non-holiday calendar.
    expect(await schoolDayStatus(OURS, MONDAY, TZ, db)).toMatchObject({ school_day: true, reason: null });
  });

  test("a holiday on a weekend says holiday, with its name", async () => {
    const { db } = household({
      school_holidays: [{ family_id: OURS, name: "Herbstferien", starts_on: "2026-10-10", ends_on: "2026-10-18" }],
    });
    expect(await schoolDayStatus(OURS, SATURDAY, TZ, db)).toMatchObject({ school_day: false, reason: "holiday", holiday: "Herbstferien" });
  });

  test("an evening holiday event west of UTC is found on its local day", async () => {
    // 21:00 in New York on Monday is 01:00 UTC on Tuesday: outside a window
    // that ended at Monday 23:59:59Z, so the window has to be padded.
    const { db } = household({
      events: [{ calendar_id: CAL(1), title: "Teacher day", all_day: false, start_at: "2026-10-06T01:00:00Z", end_at: "2026-10-06T02:00:00Z" }],
    });
    expect(await schoolDayStatus(OURS, MONDAY, "America/New_York", db)).toMatchObject({ reason: "holiday", holiday: "Teacher day" });
  });

  test("with person_id, only that child", async () => {
    const { db } = household();
    const r = await readSchedule(OURS, { personId: P(2), day: MONDAY }, TZ, db);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ school_day: true, children: [{ person_id: P(2), name: "Enno" }] });
  });

  test("a failed holiday query is an error, not a school day", async () => {
    const h = household();
    h.failOn("school_holidays");
    await expect(schoolDayStatus(OURS, MONDAY, TZ, h.db)).rejects.toBeTruthy();
    const e = household();
    e.failOn("events");
    await expect(fetchSchoolBreaks(OURS, MONDAY, MONDAY, TZ, e.db)).rejects.toBeTruthy();
  });

  test("date helpers are plain calendar arithmetic", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-29", -1)).toBe("2026-03-28");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(dayOfWeekOf(MONDAY)).toBe(1);
    expect(dayOfWeekOf("2026-10-11")).toBe(0);
  });
});

test.describe("one copy of the rules", () => {
  const read = (p: string) => codeOnly(readFileSync(join(__dirname, "..", p), "utf8"));

  test("the family summary's school_tomorrow reads the shared helper for the family's tomorrow", () => {
    const summary = read("src/app/api/integration/v1/family/summary/route.ts");
    expect(summary).toMatch(/schoolOn\(familyId, addDays\(familyDateKey\(now, zone\), 1\), zone\)/);
    // The weekday-only query it replaced is gone.
    expect(summary).not.toContain('from("schedules")');
    expect(summary).toMatch(/school_day: school \? school\.school_day : null/);
  });

  test("the Heute-Motor reads holidays through the same reader", () => {
    const signals = read("src/lib/attention/signals.ts");
    expect(signals).toContain('from "@/lib/school-days"');
    expect(signals).not.toContain('from("school_holidays")');
  });

  test("the route is family:read and takes its family only from the token", () => {
    const route = read("src/app/api/integration/v1/schedule/route.ts");
    expect(route).toContain('withIntegrationAuth(request, "family:read"');
    expect(route).toContain("readSchedule(\n        context.familyId,");
    expect(route).toContain("familyTimeZone(context.familyId)");
  });
});
