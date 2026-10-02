import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  addDays,
  lastDayCovered,
  dayOfWeekOf,
  fetchSchoolBreaks,
  loadTimetables,
  normalizeSlots,
  schoolDayStatus,
  schoolOn,
  schoolTomorrowSensor,
  type SchoolDb,
} from "../src/lib/school-days";
import { familyDays } from "../src/lib/family-time";
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
type Filter = [op: "eq" | "in" | "isnull" | "lte" | "gte", column: string, value?: unknown];

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
      if (op === "in") return (v as unknown[]).includes(actual);
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
        in(column: string, v: unknown[]) { filters.push(["in", column, v]); return chain; },
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
      // An ordinary all-day event on our normal calendar is not a holiday
      // (the app's own format: local midnight to local 23:59:59.999).
      { calendar_id: CAL(2), title: "Ausflug", all_day: true, start_at: "2026-10-04T22:00:00.000Z", end_at: "2026-10-05T21:59:59.999Z" },
      // Another family's holiday calendar (the ICS format: noon UTC, inclusive).
      { calendar_id: CAL(9), title: "Their ICS break", all_day: true, start_at: "2026-10-05T12:00:00.000Z", end_at: "2026-10-06T12:00:00.000Z" },
      ...(extra.events ?? []),
    ],
    settings: [...(extra.settings ?? [])],
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

  /*
   * The stored formats, as every writer produces them today — checked against
   * the local stack and prod: ICS/CalDAV imports (allDayEndAnchor) and Google
   * sync store noon UTC of the first and of the LAST day; the app's calendar
   * and the Integration API store local midnight to local 23:59:59.999 of the
   * last day. Both are inclusive. The legacy exclusive form (DTEND verbatim,
   * local midnight of the day after) still reads right.
   */
  const holidayCases: Array<[label: string, start: string, end: string, off: string[], on: string[]]> = [
    ["ICS/Google, two days", "2026-10-05T12:00:00.000Z", "2026-10-06T12:00:00.000Z", [MONDAY, TUESDAY], ["2026-10-02", "2026-10-07"]],
    ["ICS/Google, one day", "2026-10-07T12:00:00.000Z", "2026-10-07T12:00:00.000Z", ["2026-10-07"], [TUESDAY, "2026-10-08"]],
    ["app, two days", "2026-10-04T22:00:00.000Z", "2026-10-06T21:59:59.999Z", [MONDAY, TUESDAY], ["2026-10-02", "2026-10-07"]],
    ["app, one day", "2026-10-06T22:00:00.000Z", "2026-10-07T21:59:59.999Z", ["2026-10-07"], [TUESDAY, "2026-10-08"]],
    ["legacy exclusive, two days", "2026-10-04T22:00:00.000Z", "2026-10-06T22:00:00.000Z", [MONDAY, TUESDAY], ["2026-10-02", "2026-10-07"]],
    ["legacy exclusive, one day", "2026-10-06T22:00:00.000Z", "2026-10-07T22:00:00.000Z", ["2026-10-07"], [TUESDAY, "2026-10-08"]],
  ];
  for (const [label, start_at, end_at, off, on] of holidayCases) {
    test(`an all-day holiday stored as ${label} covers exactly its days`, async () => {
      const { db } = household({
        events: [{ calendar_id: CAL(1), title: "Herbstferien (ICS)", all_day: true, start_at, end_at }],
      });
      for (const d of off) {
        expect(await schoolDayStatus(OURS, d, TZ, db), d).toMatchObject({ school_day: false, reason: "holiday", holiday: "Herbstferien (ICS)" });
      }
      for (const d of on) {
        expect((await schoolDayStatus(OURS, d, TZ, db)).school_day, d).toBe(true);
      }
    });
  }

  test("lastDayCovered reads an inclusive end as it is, and a midnight end as the day before", () => {
    const last = (start_at: string, end_at: string) => lastDayCovered({ start_at, end_at }, TZ);
    expect(last("2026-10-07T12:00:00.000Z", "2026-10-07T12:00:00.000Z")).toBe("2026-10-07");
    expect(last("2026-10-06T22:00:00.000Z", "2026-10-07T21:59:59.999Z")).toBe("2026-10-07");
    expect(last("2026-10-06T22:00:00.000Z", "2026-10-07T22:00:00.000Z")).toBe("2026-10-07");
    // A zero-length event at midnight keeps its day.
    expect(last("2026-10-06T22:00:00.000Z", "2026-10-06T22:00:00.000Z")).toBe("2026-10-07");
    // An evening event ending at midnight does not reach the next day.
    expect(last("2026-10-06T20:00:00.000Z", "2026-10-06T22:00:00.000Z")).toBe("2026-10-06");
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

  test("the family summary's school_tomorrow reads the shared helper, for the same tomorrow as everything else", () => {
    const summary = read("src/app/api/integration/v1/family/summary/route.ts");
    expect(summary).toContain('from "@/lib/school-days"');
    expect(summary).toContain("schoolOn(familyId, tomorrow, zone)");
    expect(summary).toContain("school_tomorrow: schoolTomorrowSensor(school)");
    // One zone, one today/tomorrow pair: no server-local day, no second zone lookup.
    expect(summary).toContain("familyDays(now, zone)");
    expect(summary).not.toContain("todayKey(");
    expect(summary).not.toContain('.eq("key", "timezone")');
    expect(summary).not.toContain('from("schedules")');
    expect(summary).toMatch(/\.eq\("date", tomorrow\)/);
    expect(summary).toMatch(/\.eq\("date", today\)/);
  });

  test("the Heute-Motor's lessons come from the same live children", () => {
    const signals = read("src/lib/attention/signals.ts");
    expect(signals).toContain("loadTimetables(familyId)");
    expect(signals).not.toContain('from("schedules")');
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

test.describe("the summary's days and sensor", () => {
  test("today and tomorrow are the family's, whatever the server's zone", () => {
    // 23:30 in Berlin on Monday is 21:30 UTC, and still Monday in New York.
    const now = new Date("2026-10-05T21:30:00.000Z");
    expect(familyDays(now, "Europe/Berlin")).toEqual({ today: MONDAY, tomorrow: TUESDAY });
    // 00:30 in Berlin on Tuesday: tomorrow is Wednesday, in UTC it is still Monday.
    expect(familyDays(new Date("2026-10-05T22:30:00.000Z"), "Europe/Berlin")).toEqual({ today: TUESDAY, tomorrow: "2026-10-07" });
    expect(familyDays(new Date("2026-10-05T22:30:00.000Z"), "UTC")).toEqual({ today: MONDAY, tomorrow: TUESDAY });
    expect(familyDays(new Date("2026-10-31T23:30:00.000Z"), "Europe/Berlin")).toEqual({ today: "2026-11-01", tomorrow: "2026-11-02" });
  });

  test("a term day names the children and the first child's first lesson", async () => {
    const { db } = household();
    expect(schoolTomorrowSensor(await schoolOn(OURS, MONDAY, TZ, {}, db))).toEqual({
      state: "Mara, Enno", children: ["Mara", "Enno"], count: 2, first_lesson: "Mathe",
      date: MONDAY, school_day: true, reason: null,
    });
  });

  test("a holiday and a weekend name nobody and say why; a failed read says nothing", async () => {
    const { db } = household({
      school_holidays: [{ family_id: OURS, name: "Herbstferien", starts_on: MONDAY, ends_on: MONDAY }],
    });
    expect(schoolTomorrowSensor(await schoolOn(OURS, MONDAY, TZ, {}, db))).toEqual({
      state: null, children: [], count: 0, first_lesson: null, date: MONDAY, school_day: false, reason: "holiday",
    });
    expect(schoolTomorrowSensor(await schoolOn(OURS, SATURDAY, TZ, {}, db))).toMatchObject({ count: 0, school_day: false, reason: "weekend" });
    expect(schoolTomorrowSensor(null)).toEqual({
      state: null, children: [], count: 0, first_lesson: null, date: null, school_day: null, reason: null,
    });
  });
});

test.describe("OpenAPI", () => {
  test("a weekly body and a one-day body each match exactly one /schedule shape", async () => {
    const spec = yaml.load(readFileSync(join(__dirname, "..", "openapi", "integration-v1.yaml"), "utf8")) as {
      components: { schemas: Record<string, { required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean }> };
    };
    const weekly = spec.components.schemas.WeeklySchedule;
    const oneDay = spec.components.schemas.SchoolDay;
    expect(weekly.additionalProperties).toBe(false);
    const fitsWeekly = (body: Record<string, unknown>) =>
      (weekly.required ?? []).every((k) => k in body) && Object.keys(body).every((k) => k in (weekly.properties ?? {}));
    const fitsDay = (body: Record<string, unknown>) => (oneDay.required ?? []).every((k) => k in body);

    const { db } = household();
    const week = (await readSchedule(OURS, { personId: null, day: null }, TZ, db)).body;
    const weekend = (await readSchedule(OURS, { personId: null, day: SATURDAY }, TZ, db)).body;
    expect([fitsWeekly(week), fitsDay(week)]).toEqual([true, false]);
    expect([fitsWeekly(weekend), fitsDay(weekend)]).toEqual([false, true]);
  });
});

test.describe("holiday sources (RFC-014 §5, §6)", () => {
  const region = (code: string) => ({ family_id: OURS, key: "holiday_region", value: { code, chosen: false } });
  const locale = (l: string) => ({ family_id: OURS, key: "locale", value: l });
  const theirs = { family_id: THEIRS, key: "holiday_region", value: { code: "DE-NI", chosen: true } };

  test("a weekday public holiday in the family's region is no school day, named in the family's language", async () => {
    const { db } = household({ settings: [region("DE-NI"), locale("de")] });
    // Friday 25 December 2026.
    expect(await schoolOn(OURS, "2026-12-25", TZ, {}, db)).toMatchObject({
      school_day: false, reason: "holiday", holiday: "1. Weihnachtstag", children: [],
    });
    expect((await schoolOn(OURS, "2026-12-23", TZ, {}, db)).school_day).toBe(true);
  });

  test("a family with no region, or another family's region, reads exactly as before", async () => {
    for (const settings of [[], [theirs]]) {
      const { db } = household({ settings });
      expect((await schoolOn(OURS, "2026-12-25", TZ, {}, db)).school_day).toBe(true);
    }
  });

  test("the US keeps school open on federal holidays", async () => {
    const { db } = household({ settings: [region("US"), locale("en")] });
    // Monday 12 October 2026, Columbus Day.
    const day = await schoolOn(OURS, "2026-10-12", TZ, {}, db);
    expect(day).toMatchObject({ school_day: true, reason: null, holiday: null });
    expect(day.children.map((c) => c.name)).toEqual(["Mara", "Enno"]);
  });

  test("a substitute day and a school-only day are no school days too", async () => {
    const gb = household({ settings: [region("GB-ENG"), locale("en")] });
    expect(await schoolOn(OURS, "2027-12-27", TZ, {}, gb.db)).toMatchObject({ school_day: false, holiday: "Christmas Day" });
    // A `school` day in Bavaria, not a day off: only the school rule closes it.
    const by = household({ settings: [region("DE-BY"), locale("de")] });
    expect(await schoolOn(OURS, "2026-11-18", TZ, {}, by.db)).toMatchObject({ school_day: false, holiday: "Buß- und Bettag" });
    const ni = household({ settings: [region("DE-NI"), locale("de")] });
    expect((await schoolOn(OURS, "2026-11-18", TZ, {}, ni.db)).school_day).toBe(true);
  });

  test("the family's own entry names the day before a public holiday does (§6.2)", async () => {
    const { db } = household({
      settings: [region("DE-NI"), locale("de")],
      school_holidays: [{ family_id: OURS, name: "Weihnachtsferien", starts_on: "2026-12-21", ends_on: "2027-01-06" }],
    });
    expect((await schoolOn(OURS, "2026-12-25", TZ, {}, db)).holiday).toBe("Weihnachtsferien");
  });

  test("a holidays calendar names the day before a public holiday does (§6.2)", async () => {
    const { db } = household({
      settings: [region("DE-NI"), locale("de")],
      events: [{ calendar_id: CAL(1), title: "Ferien (ICS)", all_day: true, start_at: "2026-12-24T12:00:00.000Z", end_at: "2026-12-26T12:00:00.000Z" }],
    });
    expect((await schoolOn(OURS, "2026-12-25", TZ, {}, db)).holiday).toBe("Ferien (ICS)");
  });

  test("a family with no saved language gets English names, not German", async () => {
    const { db } = household({ settings: [region("GB-ENG")] });
    expect(await schoolOn(OURS, "2026-12-25", TZ, {}, db)).toMatchObject({ school_day: false, holiday: "Christmas Day" });
    const de = household({ settings: [region("DE-NI")] });
    expect((await schoolOn(OURS, "2026-12-25", TZ, {}, de.db)).holiday).toBe("Christmas Day");
  });

  test("an unreadable region is an error, not a school day", async () => {
    const h = household({ settings: [region("DE-NI")] });
    h.failOn("settings");
    await expect(schoolDayStatus(OURS, "2026-12-25", TZ, h.db)).rejects.toBeTruthy();
  });

  test("the summary's sensor says holiday on a public holiday", async () => {
    const { db } = household({ settings: [region("DE-NI"), locale("en")] });
    expect(schoolTomorrowSensor(await schoolOn(OURS, "2026-12-25", TZ, {}, db))).toMatchObject({
      count: 0, school_day: false, reason: "holiday",
    });
  });
  test("a synced row is a break, named after the family's own entry and calendars, before a public holiday", async () => {
    const synced = { family_id: OURS, name: "Weihnachtsferien NI", starts_on: "2026-12-23", ends_on: "2027-01-06", source: "openholidays", hidden: false };
    const own = household({ settings: [region("DE-NI"), locale("de")], school_holidays: [synced] });
    expect((await schoolOn(OURS, "2026-12-25", TZ, {}, own.db)).holiday).toBe("Weihnachtsferien NI");
    const both = household({
      settings: [region("DE-NI"), locale("de")],
      school_holidays: [synced, { family_id: OURS, name: "Unsere Ferien", starts_on: "2026-12-24", ends_on: "2026-12-31" }],
    });
    expect((await schoolOn(OURS, "2026-12-25", TZ, {}, both.db)).holiday).toBe("Unsere Ferien");
  });

  test("a hidden synced row is no break", async () => {
    const { db } = household({
      school_holidays: [{ family_id: OURS, name: "Herbstferien", starts_on: MONDAY, ends_on: TUESDAY, source: "openholidays", hidden: true }],
    });
    expect((await schoolOn(OURS, MONDAY, TZ, {}, db)).school_day).toBe(true);
  });

  test("breaks come in precedence order: manual, calendar, openholidays, public holiday", async () => {
    const { db } = household({
      settings: [region("DE-NI"), locale("en")],
      school_holidays: [
        { family_id: OURS, name: "synced", starts_on: "2026-12-25", ends_on: "2026-12-25", source: "openholidays", hidden: false },
        { family_id: OURS, name: "mine", starts_on: "2026-12-25", ends_on: "2026-12-25" },
      ],
      events: [{ calendar_id: CAL(1), title: "calendar", all_day: true, start_at: "2026-12-25T12:00:00.000Z", end_at: "2026-12-25T12:00:00.000Z" }],
    });
    const sources = (await fetchSchoolBreaks(OURS, "2026-12-25", "2026-12-25", TZ, db)).map((b) => b.source);
    expect(sources).toEqual(["manual", "calendar", "openholidays", "public_holiday"]);
  });
});
