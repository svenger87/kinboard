import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasScope } from "../src/lib/integration-auth";
import { resolveServerWeekStartsOn, weekStartForDate } from "../src/lib/meal-plan-week";
import { parseMealEntryInput, toMealEntry, MAX_MEAL_NOTE, MAX_SERVINGS } from "../src/lib/integration-meal-input";
import { parseMealRange, MAX_MEAL_RANGE_DAYS } from "../src/app/api/integration/v1/meals/route";
import { TOOL_SCOPES } from "../src/lib/mcp/server";

/**
 * Task 5 (RFC-011 §3): reading and adding to the meal plan. Pure logic only
 * — week-start computation, input validation, tool scope mapping — the same
 * split `integration-assistant-routes.spec.ts` and `calendar-range.spec.ts`
 * use for the routes before this one.
 */

test.describe("server-side week start", () => {
  test("an explicit sunday setting resolves to 0, everything else to 1", () => {
    expect(resolveServerWeekStartsOn("sunday")).toBe(0);
    expect(resolveServerWeekStartsOn("monday")).toBe(1);
    // `locale` means "ask the browser", and the server has no browser to ask
    // — see meal-plan-week.ts for why Monday is the only sound default here.
    expect(resolveServerWeekStartsOn("locale")).toBe(1);
    expect(resolveServerWeekStartsOn(undefined)).toBe(1);
    expect(resolveServerWeekStartsOn(null)).toBe(1);
    expect(resolveServerWeekStartsOn("tuesday")).toBe(1);
  });

  test("a monday-start week containing a sunday steps back into the previous month", () => {
    // 2026-03-01 is a Sunday; its Monday-start week began 2026-02-23.
    expect(weekStartForDate("2026-03-01", 1)).toBe("2026-02-23");
  });

  test("a sunday-start week containing an early-week date steps back into the previous month", () => {
    // 2026-12-01 is a Tuesday; its Sunday-start week began 2026-11-29.
    expect(weekStartForDate("2026-12-01", 0)).toBe("2026-11-29");
  });

  test("a date that is already the week's first day is its own week start", () => {
    // 2026-11-01 is a Sunday.
    expect(weekStartForDate("2026-11-01", 0)).toBe("2026-11-01");
    // 2026-11-02 is a Monday.
    expect(weekStartForDate("2026-11-02", 1)).toBe("2026-11-02");
  });

  test("a year boundary is just another month boundary", () => {
    // 2027-01-01 is a Friday; its Sunday-start week began 2026-12-27.
    expect(weekStartForDate("2027-01-01", 0)).toBe("2026-12-27");
  });
});

test.describe("adding a meal: input validation", () => {
  const base = { date: "2026-10-03", meal_type: "dinner", note: "Pizza" };

  test("accepts a minimal note entry and a minimal recipe entry", () => {
    expect(parseMealEntryInput(base)).toMatchObject({ ok: true, value: { note: "Pizza" } });
    const { note: _note, ...rest } = base;
    expect(parseMealEntryInput({ ...rest, recipe_id: "11111111-1111-1111-1111-111111111111" }))
      .toMatchObject({ ok: true, value: { recipeId: "11111111-1111-1111-1111-111111111111" } });
  });

  test("refuses a bad, missing, or unreal date", () => {
    expect(parseMealEntryInput({ ...base, date: "2026/10/03" }).ok).toBe(false);
    expect(parseMealEntryInput({ ...base, date: "2026-02-30" }).ok).toBe(false);
    const { date: _date, ...rest } = base;
    expect(parseMealEntryInput(rest).ok).toBe(false);
  });

  test("refuses an unknown meal_type", () => {
    expect(parseMealEntryInput({ ...base, meal_type: "brunch" }).ok).toBe(false);
  });

  test("requires exactly one of recipe_id or note — neither and both are both refused", () => {
    const { note: _note, ...withoutNote } = base;
    expect(parseMealEntryInput(withoutNote)).toMatchObject({ ok: false, error: expect.stringContaining("exactly one") });
    expect(parseMealEntryInput({ ...base, recipe_id: "11111111-1111-1111-1111-111111111111" }))
      .toMatchObject({ ok: false, error: expect.stringContaining("exactly one") });
  });

  test("a note is trimmed and bounded", () => {
    expect(parseMealEntryInput({ ...base, note: "  Tacos  " })).toMatchObject({ ok: true, value: { note: "Tacos" } });
    expect(parseMealEntryInput({ ...base, note: "   " }).ok).toBe(false);
    expect(parseMealEntryInput({ ...base, note: "x".repeat(MAX_MEAL_NOTE + 1) }).ok).toBe(false);
    expect(parseMealEntryInput({ ...base, note: "x".repeat(MAX_MEAL_NOTE) }).ok).toBe(true);
  });

  test("recipe_id must look like a recipe ID", () => {
    const { note: _note, ...rest } = base;
    expect(parseMealEntryInput({ ...rest, recipe_id: "not-a-uuid" }).ok).toBe(false);
  });

  test("servings, when sent, is a bounded whole number", () => {
    expect(parseMealEntryInput({ ...base, servings: 4 })).toMatchObject({ ok: true, value: { servings: 4 } });
    expect(parseMealEntryInput({ ...base, servings: 0 }).ok).toBe(false);
    expect(parseMealEntryInput({ ...base, servings: 2.5 }).ok).toBe(false);
    expect(parseMealEntryInput({ ...base, servings: MAX_SERVINGS + 1 }).ok).toBe(false);
    expect(parseMealEntryInput({ ...base, servings: MAX_SERVINGS }).ok).toBe(true);
  });
});

test.describe("reading the meal plan: range validation", () => {
  test("both ends are required", () => {
    expect(parseMealRange(null, "2026-10-10")).toMatchObject({ ok: false, reason: "missing" });
    expect(parseMealRange("2026-10-01", null)).toMatchObject({ ok: false, reason: "missing" });
  });

  test("timestamps and unreal dates are refused, not truncated", () => {
    expect(parseMealRange("2026-10-01T00:00:00Z", "2026-10-10").ok).toBe(false);
    expect(parseMealRange("2026-10-01", "2026-13-45")).toMatchObject({ ok: false, reason: "unparseable" });
  });

  test("end before start is refused", () => {
    expect(parseMealRange("2026-10-10", "2026-10-01")).toMatchObject({ ok: false, reason: "reversed" });
  });

  test("a single day is fine; a range over the bound is refused", () => {
    expect(parseMealRange("2026-10-01", "2026-10-01")).toMatchObject({ ok: true });
    const start = new Date("2026-01-01T00:00:00Z");
    const justUnder = new Date(start.getTime() + (MAX_MEAL_RANGE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    const justOver = new Date(start.getTime() + MAX_MEAL_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(parseMealRange("2026-01-01", justUnder)).toMatchObject({ ok: true });
    expect(parseMealRange("2026-01-01", justOver)).toMatchObject({ ok: false, reason: "too_wide" });
  });
});

test.describe("tool mapping", () => {
  test("get_meal_plan, add_meal and remove_meal carry the right scopes", () => {
    expect(TOOL_SCOPES.get_meal_plan).toBe("family:read");
    expect(TOOL_SCOPES.add_meal).toBe("meals:write");
    expect(TOOL_SCOPES.remove_meal).toBe("meals:write");
  });

  test("meals:write does not grant family:read, and vice versa", () => {
    expect(hasScope(["meals:write"], "family:read")).toBe(false);
    expect(hasScope(["family:read"], "meals:write")).toBe(false);
  });
});

test.describe("each meals route demands its own scope", () => {
  const dir = join(__dirname, "../src/app/api/integration/v1");

  test("reading needs family:read, adding needs meals:write", () => {
    const src = readFileSync(join(dir, "meals/route.ts"), "utf8");
    expect(src.match(/withIntegrationAuth\(request, "([a-z:]+)"/g)).toEqual([
      'withIntegrationAuth(request, "family:read"',
      'withIntegrationAuth(request, "meals:write"',
    ]);
  });

  test("removing needs meals:write", () => {
    const src = readFileSync(join(dir, "meals/[id]/route.ts"), "utf8");
    expect(src).toContain('withIntegrationAuth(request, "meals:write"');
  });
});

test.describe("recipes in the recycle bin", () => {
  const row = {
    id: "e1", date: "2026-10-02", meal_type: "dinner", recipe_id: "r1", note: null, servings: 4,
    recipe: { title: "Lasagne", deleted_at: null as string | null },
  };

  test("an entry shows its live recipe", () => {
    expect(toMealEntry(row)).toEqual({
      id: "e1", date: "2026-10-02", meal_type: "dinner", recipe_id: "r1", recipe_title: "Lasagne", note: null, servings: 4,
    });
  });

  test("an entry whose recipe is binned carries no recipe — neither its title nor its id", () => {
    const binned = toMealEntry({ ...row, recipe: { title: "Lasagne", deleted_at: "2026-10-01T10:00:00Z" } });
    expect([binned.recipe_id, binned.recipe_title]).toEqual([null, null]);
    expect(toMealEntry({ ...row, recipe: null }).recipe_title).toBeNull();
  });

  test("the route asks for deleted_at in the join, and filters it on both recipe lookups", () => {
    const source = readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "meals", "route.ts"), "utf8");
    expect(source).toContain("recipe:recipes(title, deleted_at)");
    expect(source).toContain(".map(toMealEntry)");
    const lookups = source.split('.from("recipes")').length - 1;
    const filtered = source.split('.from("recipes")').slice(1)
      .filter((after) => after.slice(0, after.indexOf("maybeSingle")).includes('.is("deleted_at", null)')).length;
    expect(lookups).toBe(2);
    expect(filtered).toBe(lookups);
  });
});
