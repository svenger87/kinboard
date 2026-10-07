import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { matchesOr } from "./postgrest-or";
import { evaluateToken, hashIntegrationToken, requireIntegrationAuth } from "../src/lib/integration-auth";
import {
  countCompletions, parseSummaryRange, readWeekSummary, MAX_SUMMARY_DAYS, type WeekSummary,
} from "../src/lib/integration-week-summary";
import { GET as weekSummaryRoute } from "../src/app/api/integration/v1/week-summary/route";
import { codeOnly } from "./source-helpers";

/**
 * `GET /api/integration/v1/week-summary` ("How did our week go?"): what it
 * counts, from which rows, for which family, over which days. No stack: the
 * database is a fake that applies every filter it is given, so a query that
 * forgets the family, the bin or the window really does reach the wrong row.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const P = (n: number) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;
const T = (n: number) => `bbbbbbbb-bbbb-bbbb-bbbb-${String(n).padStart(12, "0")}`;
const CAL = (n: number) => `cccccccc-cccc-cccc-cccc-${String(n).padStart(12, "0")}`;
const TZ = "Europe/Berlin";
const NOW = new Date("2026-10-07T18:00:00.000Z"); // Wednesday, 20:00 in Berlin
const iso = (s: string) => new Date(s).toISOString();

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "in" | "isnull" | "lte" | "gte" | "lt" | "gt" | "or", column: string, value?: unknown];

function fakeDb(tables: Record<string, Row[]>) {
  const queries: Array<{ table: string; filters: Filter[] }> = [];
  const value = (row: Row, column: string): unknown => {
    if (column.includes(".")) {
      const [embed, col] = column.split(".");
      const nested = row[embed] as Row | null | undefined;
      return nested ? nested[col] ?? null : undefined;
    }
    return row[column] ?? null;
  };
  const matches = (filters: Filter[]) => (row: Row) =>
    filters.every(([op, column, v]) => {
      if (op === "or") return matchesOr(String(v), (c) => value(row, c));
      const actual = value(row, column);
      if (op === "isnull") return actual === null;
      if (op === "eq") return actual === v;
      if (op === "in") return (v as unknown[]).includes(actual);
      if (actual === null || actual === undefined) return false;
      if (op === "lte") return String(actual) <= String(v);
      if (op === "lt") return String(actual) < String(v);
      if (op === "gt") return String(actual) > String(v);
      return String(actual) >= String(v);
    });

  const db = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: Filter[] = [];
      const orders: string[] = [];
      let cap = Infinity;
      queries.push({ table, filters });
      const result = () => {
        let hit = rows.filter(matches(filters));
        for (const col of [...orders].reverse()) hit = [...hit].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
        return { data: hit.slice(0, cap).map((r) => ({ ...r })), error: null };
      };
      const chain = {
        select() { return chain; },
        eq(c: string, v: unknown) { filters.push(["eq", c, v]); return chain; },
        in(c: string, v: unknown[]) { filters.push(["in", c, v]); return chain; },
        is(c: string, v: unknown) {
          if (v !== null) throw new Error(`unsupported is(${c})`);
          filters.push(["isnull", c]); return chain;
        },
        gte(c: string, v: unknown) { filters.push(["gte", c, v]); return chain; },
        gt(c: string, v: unknown) { filters.push(["gt", c, v]); return chain; },
        lt(c: string, v: unknown) { filters.push(["lt", c, v]); return chain; },
        lte(c: string, v: unknown) { filters.push(["lte", c, v]); return chain; },
        or(expr: string) { filters.push(["or", "", expr]); return chain; },
        order(c: string) { orders.push(c); return chain; },
        limit(n: number) { cap = n; return chain; },
        async maybeSingle() { const r = result(); return { data: r.data[0] ?? null, error: null }; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return chain;
    },
    async rpc(name: string, args: { p_family_id: string; p_person_id: string }) {
      if (name !== "point_person_totals") throw new Error(`unexpected rpc ${name}`);
      const earned = (tables.todo_point_awards ?? [])
        .filter((a) => a.family_id === args.p_family_id && a.person_id === args.p_person_id)
        .reduce((n, a) => n + Number(a.points), 0);
      return { data: { earned, spent: 0, pending: 0, balance: earned, owed: 0 }, error: null };
    },
  };
  return { db: db as never, queries };
}

const completed = (todo: number, day: string | null, person: string | null, at: string, title: string, family = OURS, kind = "completed") =>
  ({ family_id: family, todo_id: T(todo), kind, at: iso(at), person_id: person, day, detail: { title, source: "device" } });

/**
 * Mira and Jonas are our children, Mama an adult, Lotte a child in the
 * recycle bin; Kim is another family's child. Mira's fox grows with points,
 * Jonas's cat with money.
 */
function household(extra: Partial<Record<string, Row[]>> = {}) {
  return fakeDb({
    people: [
      { id: P(1), family_id: OURS, name: "Mira", is_child: true, deleted_at: null, created_at: "2026-01-01" },
      { id: P(2), family_id: OURS, name: "Jonas", is_child: true, deleted_at: null, created_at: "2026-01-02" },
      { id: P(3), family_id: OURS, name: "Mama", is_child: false, deleted_at: null, created_at: "2026-01-03" },
      { id: P(4), family_id: OURS, name: "Lotte", is_child: true, deleted_at: "2026-09-01T00:00:00Z", created_at: "2026-01-04" },
      { id: P(9), family_id: THEIRS, name: "Kim", is_child: true, deleted_at: null, created_at: "2026-01-01" },
    ],
    todo_events: [
      // Washing up, with turns: Mira, Jonas, Mira.
      completed(1, "2026-10-02", P(1), "2026-10-02T17:00:00Z", "Washing up"),
      completed(1, "2026-10-03", P(2), "2026-10-03T17:00:00Z", "Washing up"),
      completed(1, "2026-10-04", P(1), "2026-10-04T17:00:00Z", "Washing up"),
      // Feed the cat: ticked and taken back the same day.
      completed(2, "2026-10-05", P(1), "2026-10-05T07:00:00Z", "Feed the cat"),
      completed(2, "2026-10-05", P(1), "2026-10-05T07:05:00Z", "Feed the cat", OURS, "uncompleted"),
      // A one-off: taken back and ticked again, counts once.
      completed(3, null, P(3), "2026-10-06T09:00:00Z", "Tax return"),
      completed(3, null, P(3), "2026-10-06T09:01:00Z", "Tax return", OURS, "uncompleted"),
      completed(3, null, P(3), "2026-10-06T10:00:00Z", "Tax return"),
      // For nobody, and for someone in the bin.
      completed(4, null, null, "2026-10-06T11:00:00Z", "Water the plants"),
      completed(5, null, P(4), "2026-10-03T11:00:00Z", "Old chore"),
      // Before the week: not counted.
      completed(1, "2026-09-29", P(1), "2026-09-29T17:00:00Z", "Washing up"),
      // Another family's.
      completed(9, null, P(9), "2026-10-05T17:00:00Z", "Their chore", THEIRS),
      // Not a tick at all.
      { family_id: OURS, todo_id: T(6), kind: "created", at: iso("2026-10-05T10:00:00Z"), person_id: P(1), day: null, detail: { title: "New" } },
    ],
    todo_occurrences: [
      { family_id: OURS, todo_id: T(1), day: "2026-10-01", person_id: P(2), status: "missed" },
      { family_id: OURS, todo_id: T(1), day: "2026-09-28", person_id: P(2), status: "missed" },
      { family_id: OURS, todo_id: T(1), day: "2026-10-02", person_id: P(1), status: "done" },
      { family_id: THEIRS, todo_id: T(9), day: "2026-10-02", person_id: P(9), status: "missed" },
    ],
    todo_point_awards: [
      { family_id: OURS, person_id: P(1), points: 20, created_at: iso("2026-09-20T10:00:00Z") },
      { family_id: OURS, person_id: P(1), points: 30, created_at: iso("2026-10-02T17:00:00Z") },
      { family_id: OURS, person_id: P(1), points: 5, created_at: iso("2026-10-04T17:00:00Z") },
      { family_id: OURS, person_id: P(2), points: 3, created_at: iso("2026-10-03T17:00:00Z") },
      { family_id: THEIRS, person_id: P(9), points: 99, created_at: iso("2026-10-03T17:00:00Z") },
    ],
    point_redemptions: [
      { family_id: OURS, person_id: P(1), cost_points: 4, status: "approved", decided_at: iso("2026-10-05T12:00:00Z") },
      { family_id: OURS, person_id: P(1), cost_points: 50, status: "pending", decided_at: null },
      { family_id: OURS, person_id: P(2), cost_points: 7, status: "denied", decided_at: iso("2026-10-05T12:00:00Z") },
      { family_id: OURS, person_id: P(1), cost_points: 9, status: "approved", decided_at: iso("2026-09-25T12:00:00Z") },
      { family_id: THEIRS, person_id: P(9), cost_points: 11, status: "approved", decided_at: iso("2026-10-05T12:00:00Z") },
    ],
    point_purchases: [
      { family_id: OURS, person_id: P(2), cost: 2, created_at: iso("2026-10-06T12:00:00Z") },
      { family_id: THEIRS, person_id: P(9), cost: 20, created_at: iso("2026-10-06T12:00:00Z") },
    ],
    creatures: [
      { family_id: OURS, person_id: P(1), species: "fox", grows_with: "points", best_tier: 1, enabled: true, look: { name: "Foxy" } },
      { family_id: OURS, person_id: P(2), species: "cat", grows_with: "money", best_tier: 2, enabled: true, look: { name: "Tom" } },
      { family_id: THEIRS, person_id: P(9), species: "owl", grows_with: "points", best_tier: 1, enabled: true },
    ],
    pocket_money_accounts: [
      { id: "acc-2", family_id: OURS, person_id: P(2), balance_cents: 200, currency: "EUR" },
      { id: "acc-9", family_id: THEIRS, person_id: P(9), balance_cents: 900, currency: "EUR" },
    ],
    pocket_money_transactions: [
      { account_id: "acc-2", amount_cents: 100, created_at: iso("2026-10-03T08:00:00Z") },
      { account_id: "acc-9", amount_cents: 900, created_at: iso("2026-10-03T08:00:00Z") },
    ],
    meal_plan_entries: [
      { id: "m1", date: "2026-10-02", meal_type: "dinner", recipe_id: "r1", note: null, servings: 4, deleted_at: null, recipe: { title: "Lasagne", deleted_at: null }, meal_plan: { family_id: OURS } },
      { id: "m2", date: "2026-10-04", meal_type: "lunch", recipe_id: null, note: "Leftovers", servings: null, deleted_at: null, recipe: null, meal_plan: { family_id: OURS } },
      { id: "m3", date: "2026-10-05", meal_type: "dinner", recipe_id: null, note: "Pizza", servings: null, deleted_at: "2026-10-04T00:00:00Z", recipe: null, meal_plan: { family_id: OURS } },
      { id: "m4", date: "2026-09-29", meal_type: "dinner", recipe_id: null, note: "Too early", servings: null, deleted_at: null, recipe: null, meal_plan: { family_id: OURS } },
      { id: "m9", date: "2026-10-03", meal_type: "dinner", recipe_id: null, note: "Theirs", servings: null, deleted_at: null, recipe: null, meal_plan: { family_id: THEIRS } },
    ],
    calendars: [
      { id: CAL(1), family_id: OURS, google_calendar_id: null, sync_enabled: null },
      { id: CAL(2), family_id: OURS, google_calendar_id: "g@x", sync_enabled: false },
      { id: CAL(9), family_id: THEIRS, google_calendar_id: null, sync_enabled: null },
    ],
    events: [
      { id: "e1", calendar_id: CAL(1), title: "Swimming", start_at: iso("2026-10-01T15:00:00Z"), end_at: iso("2026-10-01T16:00:00Z"), all_day: false },
      { id: "e2", calendar_id: CAL(1), title: "swimming", start_at: iso("2026-10-06T15:00:00Z"), end_at: iso("2026-10-06T16:00:00Z"), all_day: false },
      { id: "e3", calendar_id: CAL(1), title: "Grandma visits", start_at: iso("2026-10-04T12:00:00Z"), end_at: iso("2026-10-04T15:00:00Z"), all_day: false },
      { id: "e4", calendar_id: CAL(1), title: "School trip", start_at: iso("2026-09-29T22:00:00Z"), end_at: iso("2026-10-02T22:00:00Z"), all_day: true },
      { id: "e5", calendar_id: CAL(2), title: "Hidden Google", start_at: iso("2026-10-03T10:00:00Z"), end_at: iso("2026-10-03T11:00:00Z"), all_day: false },
      { id: "e6", calendar_id: CAL(9), title: "Their party", start_at: iso("2026-10-03T10:00:00Z"), end_at: iso("2026-10-03T11:00:00Z"), all_day: false },
      // Later today, after now: has not taken place yet.
      { id: "e7", calendar_id: CAL(1), title: "Choir", start_at: iso("2026-10-07T19:00:00Z"), end_at: iso("2026-10-07T20:00:00Z"), all_day: false },
      // Next week.
      { id: "n1", calendar_id: CAL(1), title: "Dentist", start_at: iso("2026-10-09T07:30:00Z"), end_at: iso("2026-10-09T08:00:00Z"), all_day: false },
      { id: "n2", calendar_id: CAL(1), title: "Autumn break", start_at: iso("2026-10-11T22:00:00Z"), end_at: iso("2026-10-23T22:00:00Z"), all_day: true },
      { id: "n3", calendar_id: CAL(1), title: "Far away", start_at: iso("2026-10-20T07:30:00Z"), end_at: iso("2026-10-20T08:00:00Z"), all_day: false },
      { id: "n4", calendar_id: CAL(9), title: "Their trip", start_at: iso("2026-10-09T07:30:00Z"), end_at: iso("2026-10-09T08:00:00Z"), all_day: false },
    ],
    birthdays: [
      { id: "b1", family_id: OURS, name: "Oma", date: "1950-10-10", person_id: null, notify_days_before: 7, deleted_at: null },
      { id: "b2", family_id: OURS, name: "Today", date: "1980-10-07", person_id: null, notify_days_before: 7, deleted_at: null },
      { id: "b3", family_id: OURS, name: "Later", date: "1990-10-30", person_id: null, notify_days_before: 7, deleted_at: null },
      { id: "b4", family_id: OURS, name: "Binned", date: "1990-10-09", person_id: null, notify_days_before: 7, deleted_at: "2026-09-01" },
      { id: "b9", family_id: THEIRS, name: "Theirs", date: "1990-10-09", person_id: null, notify_days_before: 7, deleted_at: null },
    ],
    settings: [
      { family_id: OURS, key: "countdowns", value: [
        { id: "c1", title: "Autumn break", date: "2026-10-12", icon: "🎉" },
        { id: "c2", title: "Christmas", date: "2026-12-24", icon: "🎄" },
      ], updated_at: "2026-10-01" },
      { family_id: THEIRS, key: "countdowns", value: [{ id: "c9", title: "Theirs", date: "2026-10-09", icon: "🎉" }], updated_at: "2026-10-01" },
      ...(extra.settings ?? []),
    ],
  });
}

async function summary(query: { start: string | null; end: string | null } = { start: null, end: null }, db = household().db) {
  const result = await readWeekSummary(OURS, query, { db, timeZone: TZ, locale: "en", now: NOW });
  expect(result.status).toBe(200);
  return result.body as WeekSummary;
}

const person = (s: WeekSummary, name: string) => s.people.find((p) => p.name === name)!;

// ── The days ─────────────────────────────────────────────────────────────

test.describe("which days", () => {
  test("without dates: the last 7 days, today included, on the family's calendar", async () => {
    const s = await summary();
    expect([s.start, s.end, s.time_zone]).toEqual(["2026-10-01", "2026-10-07", TZ]);
    expect([s.next_week.start, s.next_week.end]).toEqual(["2026-10-08", "2026-10-14"]);
  });

  test("a range is both dates, real ones, in order, up to today, at most 31 days", () => {
    const today = "2026-10-07";
    expect(parseSummaryRange("2026-09-21", "2026-09-27", today)).toEqual({ ok: true, start: "2026-09-21", end: "2026-09-27" });
    expect(parseSummaryRange("2026-09-07", "2026-10-07", today).ok).toBe(true);
    for (const [start, end] of [
      ["2026-09-21", null], [null, "2026-09-27"], ["2026-02-30", "2026-03-02"], ["27.09.2026", "2026-09-28"],
      ["2026-09-27", "2026-09-21"], ["2026-10-05", "2026-10-08"], ["2026-09-06", "2026-10-07"],
    ] as const) {
      const r = parseSummaryRange(start, end, today);
      expect(r.ok, `${start}..${end}`).toBe(false);
    }
    expect(MAX_SUMMARY_DAYS).toBe(31);
  });

  test("a refused range is a 400 in words, and reads nothing", async () => {
    const { db, queries } = household();
    const result = await readWeekSummary(OURS, { start: "2026-10-05", end: "2026-10-09" }, { db, timeZone: TZ, locale: "en", now: NOW });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "invalid_request" });
    expect((result.body as { error: string }).error).toContain("after today");
    expect(queries).toEqual([]);
  });
});

// ── Tasks ────────────────────────────────────────────────────────────────

test.describe("tasks", () => {
  test("each tick counts for whoever's turn it was, and only in the range", async () => {
    const s = await summary();
    expect(person(s, "Mira").tasks_completed).toBe(2);
    expect(person(s, "Mira").most_done).toEqual([{ title: "Washing up", times: 2 }]);
    expect(person(s, "Jonas").tasks_completed).toBe(1);
    expect(person(s, "Mama").tasks_completed).toBe(1);
  });

  test("a tick taken back does not count; taken back and ticked again counts once", async () => {
    const s = await summary();
    expect(person(s, "Mira").most_done.map((t) => t.title)).not.toContain("Feed the cat");
    expect(person(s, "Mama").most_done).toEqual([{ title: "Tax return", times: 1 }]);
    expect(countCompletions([
      { todo_id: T(1), kind: "uncompleted", at: iso("2026-10-02T18:00:00Z"), person_id: P(1), day: "2026-10-02", detail: { title: "x" } },
      { todo_id: T(1), kind: "completed", at: iso("2026-10-02T17:00:00Z"), person_id: P(1), day: "2026-10-02", detail: { title: "x" } },
    ])).toEqual([]);
  });

  test("ticks for nobody, or for someone in the recycle bin, are counted apart", async () => {
    const s = await summary();
    expect(s.unassigned_tasks_completed).toBe(2);
    expect(s.people.map((p) => p.name)).toEqual(["Mira", "Jonas", "Mama"]);
  });

  test("missed days are the written-down ones in the range", async () => {
    const s = await summary();
    expect(person(s, "Jonas").tasks_missed).toBe(1);
    expect(person(s, "Mira").tasks_missed).toBe(0);
  });

  test("task_log_complete is false only when the range reaches past what the task log keeps", async () => {
    expect((await summary()).task_log_complete).toBe(true);
    const short = household({ settings: [{ family_id: OURS, key: "task_log", value: { retentionDays: 30 } }] });
    expect((await summary({ start: "2026-09-06", end: "2026-09-30" }, short.db)).task_log_complete).toBe(false);
    const forever = household({ settings: [{ family_id: OURS, key: "task_log", value: { retentionDays: 0 } }] });
    expect((await summary({ start: "2026-09-06", end: "2026-09-30" }, forever.db)).task_log_complete).toBe(true);
  });
});

// ── Points and creatures ─────────────────────────────────────────────────

test.describe("points and creatures", () => {
  test("children get points earned and spent in the range; adults get none", async () => {
    const s = await summary();
    expect(person(s, "Mira").points).toEqual({ earned: 35, spent: 4 });
    // Denied rewards are not spent; shop purchases are.
    expect(person(s, "Jonas").points).toEqual({ earned: 3, spent: 2 });
    expect(person(s, "Mama").points).toBeUndefined();
  });

  test("each creature's stage at the start and the end, named in the family's language", async () => {
    const s = await summary();
    expect(s.creatures).toEqual([
      { person_id: P(1), name: "Mira", species: "fox", from_stage: 1, from_stage_name: "Leaf Pile", to_stage: 2, to_stage_name: "Kit" },
      // Grows with money: €1.00 at the start, €2.00 now.
      { person_id: P(2), name: "Jonas", species: "cat", from_stage: 2, from_stage_name: expect.any(String), to_stage: 3, to_stage_name: expect.any(String) },
    ]);
    expect(JSON.stringify(s)).not.toContain("Foxy");
  });

  test("a range that ends before today counts only up to its end", async () => {
    const s = await summary({ start: "2026-09-28", end: "2026-10-03" });
    expect(person(s, "Mira").points).toEqual({ earned: 30, spent: 0 });
    const fox = s.creatures.find((c) => c.species === "fox")!;
    expect([fox.from_stage, fox.to_stage]).toEqual([1, 2]);
  });

  test("the creature is read by named columns, never its look", async () => {
    const { db, queries } = household();
    const selects: string[] = [];
    const wrapped = new Proxy(db as Record<string, unknown>, {
      get(target, prop) {
        if (prop !== "from") return target[prop as string];
        return (table: string) => {
          const chain = (target.from as (t: string) => Record<string, (...a: unknown[]) => unknown>)(table);
          const select = chain.select;
          chain.select = (cols: unknown) => { if (table === "creatures") selects.push(String(cols)); return select(cols); };
          return chain;
        };
      },
    });
    await summary({ start: null, end: null }, wrapped as never);
    expect(selects).toEqual(["person_id, species, grows_with, best_tier"]);
    expect(queries.length).toBeGreaterThan(0);
  });
});

// ── Meals and events ─────────────────────────────────────────────────────

test.describe("meals and events", () => {
  test("planned meals in the range, recipe title or note; deleted ones left out", async () => {
    const s = await summary();
    expect(s.meals).toEqual({
      count: 2,
      planned: [
        { date: "2026-10-02", meal_type: "dinner", title: "Lasagne" },
        { date: "2026-10-04", meal_type: "lunch", title: "Leftovers" },
      ],
    });
  });

  test("events that took place are counted; those that happened once are notable", async () => {
    const s = await summary();
    // Swimming twice, Grandma, the school trip that began before the week;
    // not the hidden Google calendar, not another family's, not tonight's choir.
    expect(s.events.count).toBe(4);
    expect(s.events.notable).toEqual([
      { title: "School trip", date: "2026-10-01", all_day: true },
      { title: "Grandma visits", date: "2026-10-04", all_day: false },
    ]);
  });

  test("next week: events with their local time, birthdays and countdowns of the next 7 days", async () => {
    const s = await summary();
    expect(s.next_week.events).toEqual({
      count: 2,
      list: [
        { title: "Dentist", date: "2026-10-09", time: "09:30", all_day: false },
        { title: "Autumn break", date: "2026-10-12", time: null, all_day: true },
      ],
    });
    expect(s.next_week.birthdays).toEqual([{ name: "Oma", date: "2026-10-10", turns: 76 }]);
    expect(s.next_week.countdowns).toEqual([{ title: "Autumn break", date: "2026-10-12", days_until: 5 }]);
  });
});

// ── Family scoping ───────────────────────────────────────────────────────

test.describe("only this family", () => {
  test("nothing of another family's reaches the answer", async () => {
    const text = JSON.stringify(await summary());
    for (const theirs of ["Kim", "Their chore", "Theirs", "Their party", "Their trip", "owl", P(9)]) {
      expect(text, theirs).not.toContain(theirs);
    }
  });

  test("every table read is filtered by the family", async () => {
    const { db, queries } = household();
    await summary({ start: null, end: null }, db);
    const unscoped = queries.filter((q) => !q.filters.some(([op, column, v]) =>
      op === "eq" && (column === "family_id" || column === "meal_plan.family_id") && v === OURS));
    // Events are scoped through the family's calendar ids, and transactions
    // through its accounts' ids.
    expect(unscoped.map((q) => q.table).sort()).toEqual(["events", "events", "pocket_money_transactions"]);
    for (const q of unscoped) {
      const ids = q.filters.find(([op]) => op === "in")?.[2] as string[];
      expect(ids, q.table).toEqual(q.table === "events" ? [CAL(1)] : ["acc-2"]);
    }
  });
});

// ── The route ────────────────────────────────────────────────────────────

test.describe("auth and scope", () => {
  const route = () => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "week-summary", "route.ts"), "utf8"));

  test("no token is a 401 from the route itself", async () => {
    const res = await weekSummaryRoute(new NextRequest("https://kb.example.com/api/integration/v1/week-summary"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "not_authenticated" });
  });

  test("a token without family:read is refused; family:read is enough", async () => {
    const request = new NextRequest("https://kb.example.com/api/integration/v1/week-summary", {
      headers: { authorization: "Bearer kbi_example" },
    });
    const row = (scopes: string[]) => async () => ({
      id: "tok-1", family_id: "fam-1", name: "ChatGPT", scopes,
      token_hash: hashIntegrationToken("kbi_example"), expires_at: null, revoked_at: null,
      last_used_at: null, oauth_client_id: "client-1",
    }) as Parameters<typeof evaluateToken>[0];
    for (const scopes of [[], ["tasks:write"], ["announcements:write", "calendar:write"]]) {
      const refused = await requireIntegrationAuth(request, "family:read", row(scopes));
      expect(refused.ok, scopes.join(",")).toBe(false);
    }
    expect((await requireIntegrationAuth(request, "family:read", row(["family:read"]))).ok).toBe(true);
  });

  test("the route asks for family:read and takes the family only from the token", () => {
    const src = route();
    expect(src.match(/withIntegrationAuth\(/g)).toHaveLength(1);
    expect(src).toContain('withIntegrationAuth(request, "family:read"');
    expect(src).toContain("context.familyId");
    expect(src).not.toMatch(/params\.get\("family|request\.json/);
  });
});
