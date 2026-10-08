import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { matchesOr } from "./postgrest-or";
import { evaluateToken, hashIntegrationToken, requireIntegrationAuth } from "../src/lib/integration-auth";
import { holidayList, parseHolidayRange, readHolidays, MAX_HOLIDAY_DAYS, type HolidaysView } from "../src/lib/integration-holidays";
import { schoolDayStatus } from "../src/lib/school-days";
import { GET as holidaysRoute } from "../src/app/api/integration/v1/holidays/route";
import { codeOnly } from "./source-helpers";

/**
 * `GET /api/integration/v1/holidays` and `list_school_holidays`: the family's
 * school holidays and its region's public holidays over a range, from the
 * same read the timetable decides "school or not" with. No stack: the fake
 * database applies every filter, resolves `calendars.<column>` through the
 * event's calendar the way `calendars!inner` does, and evaluates `or`.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const CAL = (n: number) => `cccccccc-cccc-cccc-cccc-${String(n).padStart(12, "0")}`;
const TZ = "Europe/Berlin";
const NOW = new Date("2026-10-07T10:00:00Z");

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "in" | "isnull" | "lte" | "gte" | "or", column: string, value?: unknown];

function fakeDb(tables: Record<string, Row[]>) {
  const queries: Array<{ table: string; filters: Filter[] }> = [];
  const value = (table: string, row: Row, column: string) => {
    if (table === "events" && column.startsWith("calendars.")) {
      const cal = (tables.calendars ?? []).find((c) => c.id === row.calendar_id);
      return cal ? cal[column.slice("calendars.".length)] ?? null : undefined;
    }
    return row[column] ?? null;
  };
  const matches = (table: string, filters: Filter[]) => (row: Row) =>
    filters.every(([op, column, v]) => {
      if (op === "or") return matchesOr(String(v), (c) => value(table, row, `${column}${c}`));
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
      queries.push({ table, filters });
      const result = () => ({ data: rows.filter(matches(table, filters)).map((r) => ({ ...r })), error: null });
      const chain = {
        select() { return chain; },
        eq(c: string, v: unknown) { filters.push(["eq", c, v]); return chain; },
        in(c: string, v: unknown[]) { filters.push(["in", c, v]); return chain; },
        or(expr: string, opts?: { referencedTable?: string }) {
          filters.push(["or", opts?.referencedTable ? `${opts.referencedTable}.` : "", expr]); return chain;
        },
        is(c: string, v: unknown) { if (v !== null) throw new Error("unsupported is"); filters.push(["isnull", c]); return chain; },
        lte(c: string, v: unknown) { filters.push(["lte", c, v]); return chain; },
        gte(c: string, v: unknown) { filters.push(["gte", c, v]); return chain; },
        order() { return chain; },
        async maybeSingle() { const r = result(); return { data: r.data[0] ?? null, error: null }; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as never, queries };
}

const setting = (key: string, value: unknown, family = OURS) => ({ family_id: family, key, value });

function household(over: { settings?: Row[] } = {}) {
  return fakeDb({
    school_holidays: [
      // Typed in, and the same break synced: listed once, in the family's words.
      { family_id: OURS, name: "Herbstferien", starts_on: "2026-10-12", ends_on: "2026-10-23", source: "manual", hidden: false },
      { family_id: OURS, name: "herbstferien", starts_on: "2026-10-12", ends_on: "2026-10-23", source: "openholidays", hidden: false },
      // Under way when the range starts.
      { family_id: OURS, name: "Projektwoche", starts_on: "2026-09-28", ends_on: "2026-10-02", source: "openholidays", hidden: false },
      // Hidden by the family; outside the range; another family's.
      { family_id: OURS, name: "Hidden break", starts_on: "2026-10-05", ends_on: "2026-10-06", source: "openholidays", hidden: true },
      { family_id: OURS, name: "Weihnachtsferien", starts_on: "2026-12-23", ends_on: "2027-01-09", source: "openholidays", hidden: false },
      { family_id: THEIRS, name: "Their break", starts_on: "2026-10-01", ends_on: "2026-10-31", source: "manual", hidden: false },
    ],
    calendars: [
      { id: CAL(1), family_id: OURS, is_holidays: true, google_calendar_id: null, sync_enabled: null },
      { id: CAL(2), family_id: OURS, is_holidays: false, google_calendar_id: null, sync_enabled: null },
      { id: CAL(3), family_id: OURS, is_holidays: true, google_calendar_id: "g@x", sync_enabled: false },
      { id: CAL(9), family_id: THEIRS, is_holidays: true, google_calendar_id: null, sync_enabled: null },
    ],
    events: [
      { calendar_id: CAL(1), title: "Brückentag", all_day: true, start_at: "2026-10-29T23:00:00.000Z", end_at: "2026-10-30T22:59:59.999Z" },
      { calendar_id: CAL(2), title: "Ausflug", all_day: true, start_at: "2026-10-04T22:00:00.000Z", end_at: "2026-10-05T21:59:59.999Z" },
      { calendar_id: CAL(3), title: "Unticked Google", all_day: true, start_at: "2026-10-08T22:00:00.000Z", end_at: "2026-10-09T21:59:59.999Z" },
      { calendar_id: CAL(9), title: "Their ICS break", all_day: true, start_at: "2026-10-05T12:00:00.000Z", end_at: "2026-10-06T12:00:00.000Z" },
    ],
    settings: over.settings ?? [
      setting("holiday_region", { code: "DE-NI", chosen: true }),
      setting("locale", "en"),
      setting("holiday_region", { code: "US-CA", chosen: true }, THEIRS),
    ],
  });
}

async function read(query: { start: string | null; end: string | null }, db = household().db) {
  const result = await readHolidays(OURS, query, { db, timeZone: TZ, now: NOW });
  expect(result.status).toBe(200);
  return result.body as HolidaysView;
}

const OCTOBER = { start: "2026-10-01", end: "2026-10-31" };

test.describe("which days", () => {
  test("without dates: today and the next 12 months, in the family's calendar", async () => {
    const s = await read({ start: null, end: null });
    expect([s.start, s.end, s.time_zone]).toEqual(["2026-10-07", "2027-10-07", TZ]);
    expect(s.holidays.map((h) => h.name)).toContain("Weihnachtsferien");
  });

  test("a range is both dates, real ones, in order, at most 400 days", () => {
    const today = "2026-10-07";
    expect(parseHolidayRange("2026-10-01", "2026-10-31", today)).toEqual({ ok: true, start: "2026-10-01", end: "2026-10-31" });
    // Past ranges are fine: "when were the autumn holidays last year?"
    expect(parseHolidayRange("2025-10-01", "2025-10-31", today).ok).toBe(true);
    for (const [start, end] of [
      ["2026-10-01", null], [null, "2026-10-31"], ["2026-02-30", "2026-03-02"], ["2026-10-31", "2026-10-01"], ["2026-01-01", "2027-02-05"],
    ] as const) expect(parseHolidayRange(start, end, today).ok, `${start}..${end}`).toBe(false);
    expect(MAX_HOLIDAY_DAYS).toBe(400);
  });

  test("a refused range is a 400 in words, and reads nothing", async () => {
    const { db, queries } = household();
    const result = await readHolidays(OURS, { start: "2026-10-01", end: null }, { db, timeZone: TZ, now: NOW });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "invalid_request" });
    expect((result.body as { error: string }).error).toContain("send both `start` and `end`, or neither");
    expect(queries).toEqual([]);
  });
});

test.describe("what it lists", () => {
  test("school breaks from every source and the region's public holidays, each once, in order", async () => {
    const s = await read(OCTOBER);
    expect(s.region).toBe("DE-NI");
    const rows = s.holidays.map((h) => [h.name, h.start_date, h.end_date, h.kind, h.source]);
    expect(rows).toContainEqual(["Projektwoche", "2026-09-28", "2026-10-02", "school", "openholidays"]);
    expect(rows).toContainEqual(["Herbstferien", "2026-10-12", "2026-10-23", "school", "manual"]);
    expect(rows).toContainEqual(["Brückentag", "2026-10-30", "2026-10-30", "school", "calendar"]);
    expect(s.holidays.filter((h) => /herbstferien/i.test(h.name))).toHaveLength(1);
    // German Unity Day and Reformation Day (a holiday in Lower Saxony).
    const pub = s.holidays.filter((h) => h.kind === "public");
    expect(pub.map((h) => h.start_date)).toEqual(["2026-10-03", "2026-10-31"]);
    expect(pub.every((h) => h.source === "public_holiday" && h.days === 1)).toBe(true);
    expect(s.holidays.find((h) => h.name === "Herbstferien")!.days).toBe(12);
    const starts = s.holidays.map((h) => h.start_date);
    expect([...starts].sort()).toEqual(starts);
  });

  test("public holidays are named in the family's language", async () => {
    const en = await read(OCTOBER);
    const de = await read(OCTOBER, household({ settings: [setting("holiday_region", { code: "DE-NI", chosen: true }), setting("locale", "de")] }).db);
    const unity = (s: HolidaysView) => s.holidays.find((h) => h.start_date === "2026-10-03")!.name;
    expect(unity(de)).toMatch(/Einheit/);
    expect(unity(en)).not.toBe(unity(de));
  });

  test("hidden rows, ordinary calendars, unticked Google calendars and other families are left out", async () => {
    const text = JSON.stringify(await read(OCTOBER));
    for (const name of ["Hidden break", "Ausflug", "Unticked Google", "Their break", "Their ICS break"]) expect(text, name).not.toContain(name);
  });

  test("no region chosen: school breaks only, region null", async () => {
    const s = await read(OCTOBER, household({ settings: [] }).db);
    expect(s.region).toBeNull();
    expect(s.holidays.filter((h) => h.kind === "public")).toEqual([]);
    expect(s.holidays.some((h) => h.name === "Herbstferien")).toBe(true);
  });

  test("the same days get_school_timetable calls no school", async () => {
    const { db } = household();
    const s = await read(OCTOBER, db);
    for (const h of s.holidays) {
      const status = await schoolDayStatus(OURS, h.start_date, TZ, db);
      expect(status.school_day, `${h.name} ${h.start_date}`).toBe(false);
    }
  });

  test("holidayList keeps the first name a break has and drops empty ones", () => {
    expect(holidayList([
      { name: "Sommerferien", startsOn: "2026-07-02", endsOn: "2026-08-12", source: "manual" },
      { name: "SOMMERFERIEN.", startsOn: "2026-07-02", endsOn: "2026-08-12", source: "openholidays" },
      { name: "  ", startsOn: "2026-07-01", endsOn: "2026-07-01", source: "manual" },
    ])).toEqual([{ name: "Sommerferien", start_date: "2026-07-02", end_date: "2026-08-12", days: 42, kind: "school", source: "manual" }]);
  });

  test("every query is this family's", async () => {
    const { db, queries } = household();
    await read(OCTOBER, db);
    for (const q of queries) {
      expect(q.filters.some(([op, c, v]) => op === "eq" && (c === "family_id" || c === "calendars.family_id") && v === OURS), q.table).toBe(true);
    }
  });
});

test.describe("auth and scope", () => {
  test("no token is a 401 from the route itself", async () => {
    const res = await holidaysRoute(new NextRequest("https://kb.example.com/api/integration/v1/holidays"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "not_authenticated" });
  });

  test("a token without family:read is refused; family:read is enough", async () => {
    const request = new NextRequest("https://kb.example.com/api/integration/v1/holidays", { headers: { authorization: "Bearer kbi_example" } });
    const row = (scopes: string[]) => async () => ({
      id: "tok-1", family_id: "fam-1", name: "ChatGPT", scopes,
      token_hash: hashIntegrationToken("kbi_example"), expires_at: null, revoked_at: null,
      last_used_at: null, oauth_client_id: "client-1",
    }) as Parameters<typeof evaluateToken>[0];
    for (const scopes of [[], ["calendar:write"], ["tasks:write", "home:read"]]) {
      expect((await requireIntegrationAuth(request, "family:read", row(scopes))).ok, scopes.join(",")).toBe(false);
    }
    expect((await requireIntegrationAuth(request, "family:read", row(["family:read"]))).ok).toBe(true);
  });

  test("the route asks for family:read and takes the family only from the token", () => {
    const src = codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "holidays", "route.ts"), "utf8"));
    expect(src.match(/withIntegrationAuth\(/g)).toHaveLength(1);
    expect(src).toContain('withIntegrationAuth(request, "family:read"');
    expect(src).toContain("context.familyId");
    expect(src).not.toMatch(/params\.get\("family|request\.json/);
  });
});
