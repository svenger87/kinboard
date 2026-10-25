import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addOrMergeShoppingItems, shoppingStore } from "../src/lib/shopping-add";
import { codeOnly } from "./source-helpers";

/**
 * "Add to shopping list" on a recipe and "generate shopping list" on the meal
 * plan inserted their ingredients next to whatever was already on the list:
 * milk for Monday's recipe and milk already on the list made two milks, and
 * adding the same recipe twice doubled everything. The merge rules
 * (lib/shopping-merge.ts) existed, but only the assistants' adds used them.
 * Both pages now go through the same addOrMergeShoppingItems, with the
 * browser's Supabase client as the store.
 */

const FAMILY = "11111111-1111-1111-1111-111111111111";

/** Just enough of a Supabase client: records each call, answers from `open`. */
function fakeClient(open: Record<string, unknown>[]) {
  const calls: { op: string; args: unknown[] }[] = [];
  let nextId = 1;
  const builder = (result: () => { data: unknown; error: null }) => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq", "not", "order", "limit", "update"]) {
      b[op] = (...args: unknown[]) => {
        calls.push({ op, args });
        return b;
      };
    }
    b.insert = (rows: Record<string, unknown>[]) => {
      calls.push({ op: "insert", args: [rows] });
      return builder(() => ({ data: rows.map(() => ({ id: `new-${nextId++}` })), error: null }));
    };
    b.then = (resolve: (v: unknown) => unknown) => resolve(result());
    return b;
  };
  const client = {
    from: (table: string) => {
      calls.push({ op: "from", args: [table] });
      return builder(() => ({ data: open, error: null }));
    },
  };
  return { client, calls };
}

test("an ingredient already on the list is merged, a new one inserted", async () => {
  const { client, calls } = fakeClient([
    { id: "milk", name: "Milch", quantity: "1", unit: "L", notes: null, checked: false },
  ]);
  const out = await addOrMergeShoppingItems(
    FAMILY,
    [
      { name: "Milch", quantity: 0.5, unit: "L", notes: "Für 1 Rezept", recipe_id: "r1" },
      { name: "Zwiebeln", quantity: 2, unit: null, notes: null, recipe_id: "r1" },
    ],
    shoppingStore(client),
  );

  expect(out.outcomes.map((o) => o.merged)).toEqual([true, false]);
  expect(out.outcomes[0].item).toMatchObject({ id: "milk", quantity: 1.5, unit: "L" });

  const inserted = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>[];
  expect(inserted).toHaveLength(1);
  expect(inserted[0]).toMatchObject({ name: "Zwiebeln", family_id: FAMILY, checked: false, recipe_id: "r1" });
  expect(calls.some((c) => c.op === "update")).toBe(true);
});

test("the recipe and meal-plan pages merge instead of inserting", () => {
  for (const file of ["use-recipes.ts", "use-meal-planner.ts"]) {
    const source = codeOnly(readFileSync(join(__dirname, "..", "src", "hooks", file), "utf8"));
    expect(source, file).toContain("addOrMergeShoppingItems(requireFamilyId(family), shoppingItems, shoppingStore(supabase))");
    expect(source, file).not.toMatch(/\.from\("shopping_items"\)\s*\.insert\(/);
    // The shopping page's own query key, so it refreshes without waiting on realtime.
    expect(source, file).toContain("queryKey: queryKeys.shoppingItems(requireFamilyId(family))");
  }
});

test("lib/shopping-add.ts stays browser-safe", () => {
  const source = readFileSync(join(__dirname, "..", "src", "lib", "shopping-add.ts"), "utf8");
  expect(source).not.toMatch(/supabase\/server|integration-secrets|bring-server|node:/);
});
