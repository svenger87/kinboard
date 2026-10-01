import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addCountdown,
  changeCountdowns,
  COUNTDOWN_ICONS,
  deleteCountdown,
  listCountdowns,
  MAX_COUNTDOWN_RETRIES,
  parseCountdown,
  visibleCountdowns,
  type CountdownDb,
} from "../src/lib/countdowns";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 11: GET/POST /countdowns and DELETE /countdowns/{id}, on the
 * `countdowns` settings row the countdown widget keeps.
 *
 * The fake settings table applies the `.eq`/`.is` filters it is given,
 * enforces the unique (family_id, key) constraint with 23505, and bumps
 * `updated_at` on every update the way the table's trigger does. Every call
 * yields to the event loop first, so two writes started together really do
 * interleave: both read, then both write.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const C_SUMMER = "cccccccc-cccc-4ccc-8ccc-000000000001";
const C_XMAS = "cccccccc-cccc-4ccc-8ccc-000000000002";
const C_PAST = "cccccccc-cccc-4ccc-8ccc-000000000003";
const C_FOREIGN = "cccccccc-cccc-4ccc-8ccc-000000000004";
const TODAY = "2026-10-01";

type Row = Record<string, unknown>;
type Filter = [column: string, value: unknown];

function fakeDb(opts: { rows?: Row[]; beforeUpdate?: (rows: Row[]) => void } = {}) {
  let clock = 0;
  const stamp = () => `2026-10-01T12:00:00.${String(++clock).padStart(6, "0")}+00:00`;
  const rows: Row[] = opts.rows ?? [
    {
      id: "s-ours", family_id: OURS, key: "countdowns", updated_at: stamp(),
      value: [
        { id: C_XMAS, title: "Weihnachten", date: "2026-12-24", icon: "🎄" },
        { id: C_SUMMER, title: "Herbstferien", date: "2026-10-12", icon: "🏖️", note: "kept as is" },
        { id: C_PAST, title: "Gone", date: "2026-09-30", icon: "🎉" },
      ],
    },
    { id: "s-ours-locale", family_id: OURS, key: "locale", updated_at: stamp(), value: "de" },
    {
      id: "s-theirs", family_id: THEIRS, key: "countdowns", updated_at: stamp(),
      value: [{ id: C_FOREIGN, title: "Foreign", date: "2026-11-01", icon: "🎉" }],
    },
  ];
  const stats = { reads: 0, updates: 0, lostUpdates: 0, inserts: 0 };
  const matches = (filters: Filter[]) => (row: Row) => filters.every(([c, v]) => (row[c] ?? null) === v);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  const db = {
    from(table: string) {
      expect(table).toBe("settings");
      const filters: Filter[] = [];
      let mode: "select" | "update" = "select";
      let patch: Row = {};
      const run = async () => {
        await tick();
        if (mode === "update") {
          opts.beforeUpdate?.(rows);
          stats.updates++;
          const hit = rows.filter(matches(filters));
          if (hit.length === 0) stats.lostUpdates++;
          for (const r of hit) Object.assign(r, clone(patch), { updated_at: stamp() });
          return hit.map((r) => ({ id: r.id }));
        }
        stats.reads++;
        return rows.filter(matches(filters)).map((r) => clone({ value: r.value, updated_at: r.updated_at }));
      };
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
        is(column: string, value: unknown) { filters.push([column, value]); return chain; },
        update(p: Row) { mode = "update"; patch = p; return chain; },
        async maybeSingle() {
          const hit = await run();
          if (hit.length > 1) return { data: null, error: { message: "more than one row" } };
          return { data: hit[0] ?? null, error: null };
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          run().then((data) => resolve({ data, error: null }), reject);
        },
        async insert(row: Row) {
          await tick();
          stats.inserts++;
          if (rows.some((r) => r.family_id === row.family_id && r.key === row.key)) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          rows.push({ id: `s-${rows.length + 1}`, updated_at: stamp(), ...clone(row) });
          return { error: null };
        },
      };
      return chain;
    },
  };
  const countdownsOf = (familyId: string) =>
    (rows.find((r) => r.family_id === familyId && r.key === "countdowns")?.value ?? null) as Row[] | null;
  return { db: db as unknown as CountdownDb, rows, stats, countdownsOf };
}

test.describe("reading", () => {
  test("lists the family's countdowns from today on, soonest first, with days_until", async () => {
    const { db } = fakeDb();
    expect(await listCountdowns(OURS, TODAY, db)).toEqual([
      { id: C_SUMMER, title: "Herbstferien", date: "2026-10-12", icon: "🏖️", days_until: 11 },
      { id: C_XMAS, title: "Weihnachten", date: "2026-12-24", icon: "🎄", days_until: 84 },
    ]);
  });

  test("another family's countdowns are never listed", async () => {
    const { db } = fakeDb();
    const text = JSON.stringify(await listCountdowns(OURS, TODAY, db));
    expect(text).not.toContain(C_FOREIGN);
    expect(await listCountdowns(THEIRS, TODAY, db)).toHaveLength(1);
  });

  test("today counts as 0, and a family with no row or a broken value has none", async () => {
    expect(visibleCountdowns([{ id: C_XMAS, title: "Now", date: TODAY, icon: "⭐" }], TODAY)[0].days_until).toBe(0);
    expect(visibleCountdowns(null, TODAY)).toEqual([]);
    expect(visibleCountdowns({ not: "a list" }, TODAY)).toEqual([]);
    expect(visibleCountdowns([1, "x", null, { id: C_XMAS, title: "No date" }], TODAY)).toEqual([]);
    const { db } = fakeDb({ rows: [] });
    expect(await listCountdowns(OURS, TODAY, db)).toEqual([]);
  });
});

test.describe("parsing a new countdown", () => {
  const id = () => "new-id";
  test("title, date and icon as the widget takes them", () => {
    expect(parseCountdown({ title: "  Urlaub ", date: "2026-10-01" }, TODAY, id)).toEqual({
      ok: true, value: { id: "new-id", title: "Urlaub", date: "2026-10-01", icon: "🎉" },
    });
    expect(parseCountdown({ title: "Ski", date: "2027-02-01", icon: "⭐" }, TODAY, id)).toMatchObject({ ok: true, value: { icon: "⭐" } });
  });

  test("refuses what the widget could not have saved", () => {
    for (const body of [
      {}, { title: "", date: "2026-12-01" }, { title: "x".repeat(61), date: "2026-12-01" },
      { title: "X" }, { title: "X", date: "2026-02-30" }, { title: "X", date: "01.12.2026" },
      { title: "X", date: "2026-09-30" }, { title: "X", date: "2026-12-01", icon: "💣" }, { title: "X", date: "2026-12-01", icon: 3 },
    ]) {
      expect(parseCountdown(body, TODAY, id).ok, JSON.stringify(body)).toBe(false);
    }
    expect(parseCountdown({ title: "x".repeat(60), date: "2026-12-01" }, TODAY, id).ok).toBe(true);
  });

  test("the icons are the widget's seven, and the widget takes them from the same list", () => {
    expect([...COUNTDOWN_ICONS]).toEqual(["🎉", "🎄", "🎂", "🏖️", "🎒", "🚗", "⭐"]);
    const widget = codeOnly(readFileSync(join(__dirname, "../src/components/widgets/countdown-widget.tsx"), "utf8"));
    expect(widget).toContain('from "@/lib/countdown-icons"');
    expect(widget).not.toContain('"🎄"');
  });
});

test.describe("adding", () => {
  test("appends in the widget's shape and keeps every other entry untouched", async () => {
    const { db, countdownsOf } = fakeDb();
    const result = await addCountdown(OURS, { title: "Oma kommt", date: "2026-11-20", icon: "🚗" }, TODAY, db);
    expect(result.status).toBe(201);
    const added = (result.response.countdown as { id: string });
    expect(added).toMatchObject({ title: "Oma kommt", date: "2026-11-20", icon: "🚗", days_until: 50 });
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = countdownsOf(OURS)!;
    expect(stored).toHaveLength(4);
    expect(stored[3]).toEqual({ id: added.id, title: "Oma kommt", date: "2026-11-20", icon: "🚗" });
    expect(stored[1]).toEqual({ id: C_SUMMER, title: "Herbstferien", date: "2026-10-12", icon: "🏖️", note: "kept as is" });
    expect(countdownsOf(THEIRS)).toHaveLength(1);
  });

  test("a family without a row gets one, and the other family's row is not touched", async () => {
    const { db, countdownsOf, rows } = fakeDb({ rows: [] });
    rows.push({ id: "s-theirs", family_id: THEIRS, key: "countdowns", updated_at: "t0", value: [{ id: C_FOREIGN, title: "F", date: "2026-11-01", icon: "🎉" }] });
    expect((await addCountdown(OURS, { title: "Erster", date: "2026-10-05" }, TODAY, db)).status).toBe(201);
    expect(countdownsOf(OURS)).toHaveLength(1);
    expect(countdownsOf(THEIRS)).toHaveLength(1);
  });

  test("the write is scoped to the family even where another family's row has the same updated_at", async () => {
    const same = "2026-10-01T12:00:00.000001+00:00";
    const { db, countdownsOf } = fakeDb({ rows: [
      { id: "s-ours", family_id: OURS, key: "countdowns", updated_at: same, value: [] },
      { id: "s-theirs", family_id: THEIRS, key: "countdowns", updated_at: same, value: [{ id: C_FOREIGN, title: "Foreign", date: "2026-11-01", icon: "🎉" }] },
    ] });
    expect((await addCountdown(OURS, { title: "Ours", date: "2026-11-01" }, TODAY, db)).status).toBe(201);
    expect(countdownsOf(THEIRS)).toEqual([{ id: C_FOREIGN, title: "Foreign", date: "2026-11-01", icon: "🎉" }]);
    expect(countdownsOf(OURS)!.map((c) => c.title)).toEqual(["Ours"]);
  });

  test("a refusal writes nothing", async () => {
    const { db, stats } = fakeDb();
    expect((await addCountdown(OURS, { title: "X", date: "2025-01-01" }, TODAY, db)).status).toBe(400);
    expect(stats.updates + stats.inserts).toBe(0);
  });

  test("two adds at the same moment both survive", async () => {
    const { db, countdownsOf, stats } = fakeDb();
    const [a, b] = await Promise.all([
      addCountdown(OURS, { title: "A", date: "2026-11-01" }, TODAY, db),
      addCountdown(OURS, { title: "B", date: "2026-11-02" }, TODAY, db),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(stats.lostUpdates).toBeGreaterThan(0); // they really did collide
    expect(countdownsOf(OURS)!.map((c) => c.title).sort()).toEqual(["A", "B", "Gone", "Herbstferien", "Weihnachten"]);
  });

  test("two first adds for a family without a row both survive", async () => {
    const { db, countdownsOf, stats } = fakeDb({ rows: [] });
    const results = await Promise.all(["A", "B", "C"].map((title) => addCountdown(OURS, { title, date: "2026-11-01" }, TODAY, db)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(stats.inserts).toBeGreaterThan(1);
    expect(countdownsOf(OURS)!.map((c) => c.title).sort()).toEqual(["A", "B", "C"]);
  });

  test("a write that keeps losing gives up with 409 after the retries, having written nothing", async () => {
    // Somebody else writes the row just before every one of our updates.
    const { db, stats, countdownsOf } = fakeDb({
      beforeUpdate: (rows) => { const r = rows.find((x) => x.family_id === OURS && x.key === "countdowns")!; r.updated_at = `other-${Math.random()}`; },
    });
    const result = await addCountdown(OURS, { title: "Never", date: "2026-11-01" }, TODAY, db);
    expect(result).toEqual({ status: 409, response: expect.objectContaining({ code: "conflict" }) });
    expect(stats.updates).toBe(MAX_COUNTDOWN_RETRIES + 1);
    expect(countdownsOf(OURS)!.map((c) => c.title)).not.toContain("Never");
  });
});

test.describe("deleting", () => {
  test("takes out only that entry", async () => {
    const { db, countdownsOf } = fakeDb();
    expect(await deleteCountdown(OURS, C_XMAS, db)).toEqual({ status: 200, response: { ok: true, id: C_XMAS } });
    expect(countdownsOf(OURS)!.map((c) => c.id)).toEqual([C_SUMMER, C_PAST]);
  });

  test("another family's countdown, an unknown id or a non-uuid is 404, and nothing is written", async () => {
    const { db, countdownsOf, stats } = fakeDb();
    for (const id of [C_FOREIGN, "dddddddd-dddd-4ddd-8ddd-000000000001", "not-a-uuid"]) {
      expect((await deleteCountdown(OURS, id, db)).status, id).toBe(404);
    }
    expect(stats.updates + stats.inserts).toBe(0);
    expect(countdownsOf(THEIRS)).toHaveLength(1);
  });

  test("a delete racing an add keeps the add", async () => {
    const { db, countdownsOf } = fakeDb();
    const [added, deleted] = await Promise.all([
      addCountdown(OURS, { title: "New", date: "2026-11-01" }, TODAY, db),
      deleteCountdown(OURS, C_XMAS, db),
    ]);
    expect([added.status, deleted.status]).toEqual([201, 200]);
    expect(countdownsOf(OURS)!.map((c) => c.title).sort()).toEqual(["Gone", "Herbstferien", "New"]);
  });

  test("changeCountdowns never writes when the change refuses", async () => {
    const { db, stats } = fakeDb();
    const refused = { status: 404, response: { code: "not_found" } };
    expect(await changeCountdowns(OURS, () => refused, db)).toBe(refused);
    expect(stats.updates + stats.inserts).toBe(0);
  });
});

test.describe("routes", () => {
  const root = join(__dirname, "../src/app/api/integration/v1/countdowns");
  const list = codeOnly(readFileSync(join(root, "route.ts"), "utf8"));
  const one = codeOnly(readFileSync(join(root, "[id]/route.ts"), "utf8"));

  test("scopes: family:read to read, calendar:write to add and delete", () => {
    expect(list).toContain('withIntegrationAuth(request, "family:read"');
    expect(list).toContain('withIntegrationAuth(request, "calendar:write"');
    expect(one).toContain('withIntegrationAuth(request, "calendar:write"');
  });

  test("the family comes from the token, today from the family's time zone, and neither route makes a client", () => {
    for (const src of [list, one]) {
      expect(src).not.toContain("createAdminClient");
      expect(src).toContain("context.familyId");
    }
    expect(list).toContain("familyDateKey(new Date(), await familyTimeZone(context.familyId))");
  });

  test("adding needs an Idempotency-Key, and a refusal is not remembered", () => {
    expect(list).toContain('validateIdempotencyKey(request.headers.get("idempotency-key"))');
    expect(list).toContain("if (result.status < 400)");
  });
});
