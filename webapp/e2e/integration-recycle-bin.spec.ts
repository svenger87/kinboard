import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_DELETED_ITEMS,
  RESTORE_TYPES,
  RESTORE_TYPE_NAMES,
  isRestoreType,
  listDeletedItems,
  restoreDeletedItem,
  type RecycleDb,
} from "../src/lib/integration-recycle-bin";
import { RECYCLABLE } from "../src/lib/recycle-bin";
import { hasScope } from "../src/lib/integration-auth";
import { TOOL_SCOPES } from "../src/lib/mcp/server";
import { codeOnly } from "./source-helpers";
import yaml from "js-yaml";

/**
 * RFC-012 task 3: the recycle bin for assistants — list the family's binned
 * tasks, notes, meal entries and birthdays, and restore one; never purge.
 *
 * The fake client applies every `.eq` and `.not(col, "is", null)` filter it
 * is given to selects and updates alike, resolves `meal_plan.family_id`
 * through the `meal_plans` table the way the `!inner` join does, and honours
 * `order(deleted_at)` and `limit`. So a query that forgets the family or the
 * "is deleted" guard really does reach the foreign or live row here.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const R = (n: number) => `bbbbbbbb-bbbb-bbbb-bbbb-${String(n).padStart(12, "0")}`;
const PLAN_OURS = "cccccccc-cccc-cccc-cccc-000000000001";
const PLAN_THEIRS = "cccccccc-cccc-cccc-cccc-000000000002";
const at = (minute: number) => `2026-10-01T10:${String(minute).padStart(2, "0")}:00.000Z`;

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "notnull", column: string, value?: unknown];

function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; filters: Filter[]; payload: Row }> = [];
  let failOn: string | null = null;

  const value = (row: Row, column: string) => {
    if (column === "meal_plan.family_id") {
      return (tables.meal_plans ?? []).find((p) => p.id === row.meal_plan_id)?.family_id;
    }
    return row[column] ?? null;
  };
  const matches = (filters: Filter[]) => (row: Row) =>
    filters.every(([op, column, v]) => (op === "notnull" ? value(row, column) !== null : value(row, column) === v));

  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Filter[] = [];
      let patch: Row | null = null;
      let descending: string | null = null;
      let cap = Infinity;

      const result = () => {
        if (failOn === table) return { data: null, error: { message: `${table} failed` } };
        let hit = rows.filter(matches(filters));
        if (patch) {
          writes.push({ table, filters: [...filters], payload: patch });
          for (const row of hit) Object.assign(row, patch);
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        if (descending) hit = [...hit].sort((a, b) => String(b[descending!]).localeCompare(String(a[descending!])));
        // The recipes(...) embed on a meal entry: the linked row whatever its
        // family or bin state, as PostgREST returns it; the lib must filter.
        const embed = (r: Row) => table === "meal_plan_entries"
          ? { ...r, recipe: (tables.recipes ?? []).find((x) => x.id === r.recipe_id) ?? null }
          : { ...r };
        return { data: hit.slice(0, cap).map(embed), error: null };
      };

      const chain = {
        select() { return chain; },
        eq(column: string, v: unknown) { filters.push(["eq", column, v]); return chain; },
        not(column: string, op: string, v: unknown) {
          if (op !== "is" || v !== null) throw new Error(`unsupported not(${column}, ${op}, ${String(v)})`);
          filters.push(["notnull", column]);
          return chain;
        },
        order(column: string, opts?: { ascending?: boolean }) { if (opts?.ascending === false) descending = column; return chain; },
        limit(n: number) { cap = n; return chain; },
        update(values: Row) { patch = values; return chain; },
        async maybeSingle() { const r = result(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as RecycleDb, tables, writes, failOn(table: string) { failOn = table; } };
}

/** A bin with one deleted and one live row of each type in each family. */
function household() {
  return fakeDb({
    todos: [
      { id: R(1), family_id: OURS, title: "Clean the car", deleted_at: at(1) },
      { id: R(2), family_id: OURS, title: "Live task", deleted_at: null },
      { id: R(3), family_id: THEIRS, title: "Their task", deleted_at: at(9) },
    ],
    notes: [
      { id: R(11), family_id: OURS, content: "x".repeat(300), deleted_at: at(2) },
      { id: R(12), family_id: OURS, content: "", deleted_at: at(5) },
      { id: R(13), family_id: THEIRS, content: "Their note", deleted_at: at(9) },
    ],
    meal_plans: [
      { id: PLAN_OURS, family_id: OURS },
      { id: PLAN_THEIRS, family_id: THEIRS },
    ],
    meal_plan_entries: [
      { id: R(21), meal_plan_id: PLAN_OURS, date: "2026-10-02", meal_type: "dinner", deleted_at: at(3) },
      { id: R(22), meal_plan_id: PLAN_OURS, date: "2026-10-03", meal_type: "lunch", deleted_at: null },
      { id: R(23), meal_plan_id: PLAN_THEIRS, date: "2026-10-02", meal_type: "dinner", deleted_at: at(9) },
    ],
    birthdays: [
      { id: R(31), family_id: OURS, name: "Oma", date: "1950-04-12", deleted_at: at(4) },
      { id: R(32), family_id: THEIRS, name: "Their Oma", date: "1950-04-12", deleted_at: at(9) },
    ],
    // Reachable in the Settings bin, never here.
    recipes: [{ id: R(41), family_id: OURS, title: "Binned recipe", deleted_at: at(8) }],
  });
}

test.describe("types", () => {
  test("only tasks, notes, meal entries and birthdays, each with its own write scope", () => {
    expect([...RESTORE_TYPE_NAMES]).toEqual(["task", "note", "meal", "birthday"]);
    expect(RESTORE_TYPES).toEqual({
      task: { table: "todos", scope: "tasks:write" },
      note: { table: "notes", scope: "notes:write" },
      meal: { table: "meal_plan_entries", scope: "meals:write" },
      birthday: { table: "birthdays", scope: "birthdays:write" },
    });
    for (const t of Object.values(RESTORE_TYPES)) expect(RECYCLABLE).toHaveProperty(t.table);
    for (const other of ["recipe", "person", "todos", "subject", "__proto__", ""]) {
      expect(isRestoreType(other), other).toBe(false);
    }
  });
});

test.describe("listing", () => {
  test("this family's deleted rows of every type, newest deletion first, with the bin's titles", async () => {
    const f = household();
    const items = await listDeletedItems(OURS, null, f.db);
    expect(items).toEqual([
      { id: R(12), type: "note", title: "—", subtitle: null, detail: null, deleted_at: at(5) },
      { id: R(31), type: "birthday", title: "Oma", subtitle: "1950-04-12", detail: null, deleted_at: at(4) },
      { id: R(21), type: "meal", title: "2026-10-02", subtitle: "dinner", detail: null, deleted_at: at(3) },
      { id: R(11), type: "note", title: "x".repeat(120), subtitle: null, detail: null, deleted_at: at(2) },
      { id: R(1), type: "task", title: "Clean the car", subtitle: null, detail: null, deleted_at: at(1) },
    ]);
  });

  test("type narrows it to one kind", async () => {
    const f = household();
    expect((await listDeletedItems(OURS, "meal", f.db)).map((i) => i.id)).toEqual([R(21)]);
    expect((await listDeletedItems(OURS, "task", f.db)).map((i) => i.id)).toEqual([R(1)]);
    expect((await listDeletedItems(THEIRS, "birthday", f.db)).map((i) => i.id)).toEqual([R(32)]);
  });

  test(`at most ${MAX_DELETED_ITEMS} across all types, the newest kept`, async () => {
    const f = fakeDb({
      todos: Array.from({ length: 40 }, (_, i) => ({ id: R(100 + i), family_id: OURS, title: `t${i}`, deleted_at: `2026-09-01T00:00:${String(i).padStart(2, "0")}.000Z` })),
      notes: Array.from({ length: 40 }, (_, i) => ({ id: R(200 + i), family_id: OURS, content: `n${i}`, deleted_at: `2026-09-02T00:00:${String(i).padStart(2, "0")}.000Z` })),
    });
    const items = await listDeletedItems(OURS, null, f.db);
    expect(items).toHaveLength(MAX_DELETED_ITEMS);
    expect(items.filter((i) => i.type === "note")).toHaveLength(40);
    expect(items.at(-1)).toMatchObject({ type: "task", title: "t30" });
  });

  test("binned meals on one day are told apart by recipe and note; a binned or foreign recipe's title is not shown", async () => {
    const meal = (n: number, extra: Row) => ({
      id: R(n), meal_plan_id: PLAN_OURS, date: "2026-10-02", meal_type: "dinner", note: null, recipe_id: null, deleted_at: at(n), ...extra,
    });
    const f = fakeDb({
      meal_plans: [{ id: PLAN_OURS, family_id: OURS }],
      recipes: [
        { id: R(51), family_id: OURS, title: "Lasagne", deleted_at: null },
        { id: R(52), family_id: OURS, title: "Tiramisu", deleted_at: null },
        { id: R(53), family_id: OURS, title: "Binned curry", deleted_at: at(1) },
        { id: R(54), family_id: THEIRS, title: "Their stew", deleted_at: null },
      ],
      meal_plan_entries: [
        meal(1, { recipe_id: R(51) }),
        meal(2, { recipe_id: R(52), note: "  for the guests " }),
        meal(3, { recipe_id: R(53), note: "with rice" }),
        meal(4, { recipe_id: R(54) }),
        meal(5, { note: "y".repeat(200) }),
        meal(6, {}),
      ],
    });
    const detail = Object.fromEntries((await listDeletedItems(OURS, "meal", f.db)).map((i) => [i.id, i.detail]));
    expect(detail).toEqual({
      [R(1)]: "Lasagne",
      [R(2)]: "Tiramisu — for the guests",
      [R(3)]: "with rice",
      [R(4)]: null,
      [R(5)]: "y".repeat(120),
      [R(6)]: null,
    });
  });

  test("a failing read is an error, not an empty bin", async () => {
    const f = household();
    f.failOn("notes");
    await expect(listDeletedItems(OURS, null, f.db)).rejects.toBeTruthy();
  });
});

test.describe("restoring", () => {
  test("clears deleted_at on this family's binned row of each type, and nothing else", async () => {
    const f = household();
    for (const [type, id] of [["task", R(1)], ["note", R(11)], ["meal", R(21)], ["birthday", R(31)]] as const) {
      expect(await restoreDeletedItem(OURS, type, id, f.db), type).toBe(true);
    }
    expect(f.tables.todos[0]).toEqual({ id: R(1), family_id: OURS, title: "Clean the car", deleted_at: null });
    expect(f.tables.notes[0].deleted_at).toBeNull();
    expect(f.tables.meal_plan_entries[0].deleted_at).toBeNull();
    expect(f.tables.birthdays[0].deleted_at).toBeNull();
    expect(f.writes.every((w) => JSON.stringify(w.payload) === '{"deleted_at":null}')).toBe(true);
    // Their rows stay binned.
    expect(f.tables.todos[2].deleted_at).toBe(at(9));
    expect(f.tables.meal_plan_entries[2].deleted_at).toBe(at(9));
    expect(f.tables.birthdays[1].deleted_at).toBe(at(9));
  });

  test("another family's binned row is not found and stays in their bin", async () => {
    const f = household();
    expect(await restoreDeletedItem(OURS, "task", R(3), f.db)).toBe(false);
    expect(await restoreDeletedItem(OURS, "note", R(13), f.db)).toBe(false);
    expect(await restoreDeletedItem(OURS, "meal", R(23), f.db)).toBe(false);
    expect(await restoreDeletedItem(OURS, "birthday", R(32), f.db)).toBe(false);
    expect(f.tables.todos[2].deleted_at).toBe(at(9));
    expect(f.tables.notes[2].deleted_at).toBe(at(9));
    expect(f.tables.meal_plan_entries[2].deleted_at).toBe(at(9));
    expect(f.tables.birthdays[1].deleted_at).toBe(at(9));
  });

  test("the update itself carries the family and the 'is deleted' guard", async () => {
    const f = household();
    await restoreDeletedItem(OURS, "task", R(1), f.db);
    await restoreDeletedItem(OURS, "meal", R(21), f.db);
    const [task, meal] = f.writes;
    expect(task.filters).toEqual(expect.arrayContaining([["eq", "id", R(1)], ["eq", "family_id", OURS], ["notnull", "deleted_at"]]));
    expect(meal.filters).toEqual(expect.arrayContaining([["eq", "id", R(21)], ["eq", "meal_plan_id", PLAN_OURS], ["notnull", "deleted_at"]]));
  });

  test("a live row, a missing one, or the wrong type is not found, and nothing is written over", async () => {
    const f = household();
    expect(await restoreDeletedItem(OURS, "task", R(2), f.db)).toBe(false);
    expect(await restoreDeletedItem(OURS, "meal", R(22), f.db)).toBe(false);
    expect(await restoreDeletedItem(OURS, "task", R(99), f.db)).toBe(false);
    expect(await restoreDeletedItem(OURS, "note", R(1), f.db)).toBe(false);
    expect(f.tables.todos[0].deleted_at).toBe(at(1));
    expect(f.tables.todos[1].deleted_at).toBeNull();
    // No meal write at all: the family check comes first.
    expect(f.writes.filter((w) => w.table === "meal_plan_entries")).toEqual([]);
  });

  test("restoring twice: the second finds nothing in the bin", async () => {
    const f = household();
    expect(await restoreDeletedItem(OURS, "birthday", R(31), f.db)).toBe(true);
    expect(await restoreDeletedItem(OURS, "birthday", R(31), f.db)).toBe(false);
  });

  test("a failing write is an error, not 'not found'", async () => {
    const f = household();
    f.failOn("todos");
    await expect(restoreDeletedItem(OURS, "task", R(1), f.db)).rejects.toBeTruthy();
  });
});

test.describe("routes", () => {
  const read = (...p: string[]) => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", ...p), "utf8"));
  const list = () => read("integration", "v1", "recycle-bin", "route.ts");
  const restore = () => read("integration", "v1", "recycle-bin", "[type]", "[id]", "restore", "route.ts");

  test("the listing needs family:read and refuses an unknown type", () => {
    expect(list()).toContain('withIntegrationAuth(request, "family:read"');
    expect(list()).toContain("isRestoreType(type)");
    expect(list()).toContain('code: "invalid_request"');
    expect(list()).toContain("listDeletedItems(context.familyId, type)");
  });

  test("the restore asks for the type's own scope, authenticates an unknown type too, and checks the id", () => {
    const src = restore();
    expect(src).toContain('const scope = isRestoreType(type) ? RESTORE_TYPES[type].scope : "family:read"');
    expect(src).toContain("withIntegrationAuth(request, scope");
    expect(src).toContain("UUID_RE.test(id)");
    expect(src).toContain("restoreDeletedItem(context.familyId, type, id)");
    expect(src).toContain('code: "not_found"');
  });

  test("restore never purges, and is not counted against the destructive budget", () => {
    const src = restore();
    const lib = codeOnly(readFileSync(join(__dirname, "..", "src", "lib", "integration-recycle-bin.ts"), "utf8"));
    for (const code of [src, lib]) {
      expect(code).not.toContain("purge_deleted");
      expect(code).not.toContain(".delete(");
      expect(code).not.toContain("hard_delete");
    }
    expect(src).not.toContain("destructiveLimitResponse");
    expect(src).not.toContain("export async function DELETE");
  });

  test("the tools carry the same scopes as the route", () => {
    expect(TOOL_SCOPES.list_deleted_items).toBe("family:read");
    expect(TOOL_SCOPES.restore_task).toBe(RESTORE_TYPES.task.scope);
    expect(TOOL_SCOPES.restore_note).toBe(RESTORE_TYPES.note.scope);
    expect(TOOL_SCOPES.restore_meal).toBe(RESTORE_TYPES.meal.scope);
    expect(TOOL_SCOPES.restore_birthday).toBe(RESTORE_TYPES.birthday.scope);
    expect(hasScope(["notes:write"], "tasks:write")).toBe(false);
  });

  test("the OpenAPI RestoreType lists exactly these types", () => {
    const spec = yaml.load(readFileSync(join(__dirname, "..", "openapi", "integration-v1.yaml"), "utf8")) as {
      components: { schemas: Record<string, { enum?: string[] }> };
    };
    expect(spec.components.schemas.RestoreType.enum).toEqual([...RESTORE_TYPE_NAMES]);
  });
});
