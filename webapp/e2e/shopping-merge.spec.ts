import { test, expect } from "@playwright/test";
import {
  findMergeTarget,
  formatQuantity,
  mergeQuantities,
  parseQuantityText,
  sameItemName,
  MAX_UNIT_LENGTH,
  type OpenShoppingItem,
} from "../src/lib/shopping-merge";
import {
  addOrMergeShoppingItems,
  addShoppingItemFromText,
  bringSpecification,
  type BringPushDeps,
  type ShoppingStore,
} from "../src/lib/shopping-enrich";

/**
 * Adding something that is already on the shopping list merges into it
 * (lib/shopping-merge.ts) — the rules, then the add that applies them.
 * No database, no network: the store and Bring! are fakes.
 */

const FAMILY = "11111111-1111-1111-1111-111111111111";
const q = (quantity: number | null, unit: string | null = null) => ({ quantity, unit });
const open = (over: Partial<OpenShoppingItem> & { name: string }): OpenShoppingItem => ({
  id: `id-${over.name}`, quantity: null, unit: null, checked: false, notes: null, ...over,
});

test.describe("the same item", () => {
  test("same name merges", () => {
    expect(sameItemName("Milch", "Milch")).toBe(true);
  });

  test("case and whitespace do not matter", () => {
    expect(sameItemName("milk", "  MILK ")).toBe(true);
    expect(sameItemName("oat  milk", "Oat milk")).toBe(true);
  });

  test("simple plurals, English and German", () => {
    expect(sameItemName("egg", "eggs")).toBe(true);
    expect(sameItemName("Eggs", "egg")).toBe(true);
    expect(sameItemName("tomato", "tomatoes")).toBe(true);
    expect(sameItemName("berry", "berries")).toBe(true);
    expect(sameItemName("Zwiebel", "Zwiebeln")).toBe(true);
    expect(sameItemName("Tomate", "Tomaten")).toBe(true);
  });

  test("nothing fuzzier", () => {
    expect(sameItemName("milk", "oat milk")).toBe(false);
    expect(sameItemName("Milch", "Milchreis")).toBe(false);
    // Too short to strip a plural from: egg and ice cream stay apart.
    expect(sameItemName("Ei", "Eis")).toBe(false);
    expect(sameItemName("Apfel", "Äpfel")).toBe(false);
    expect(sameItemName("", "")).toBe(false);
  });

  test("a checked item is not merged into; an unchecked or null-checked one is", () => {
    const items = [
      open({ id: "bought", name: "Milch", checked: true }),
      open({ id: "needed", name: "milch", checked: null }),
    ];
    expect(findMergeTarget(items, "Milch")?.id).toBe("needed");
    expect(findMergeTarget([items[0]], "Milch")).toBeNull();
  });

  test("the oldest match wins when the list already holds two", () => {
    const items = [open({ id: "first", name: "Brot" }), open({ id: "second", name: "Brot" })];
    expect(findMergeTarget(items, "brot")?.id).toBe("first");
  });
});

test.describe("quantities", () => {
  test("numbers in the same unit add up", () => {
    expect(mergeQuantities(q(500, "g"), q(250, "g"))).toEqual(q(750, "g"));
    expect(mergeQuantities(q(1.5, "kg"), q(0.25, "kg"))).toEqual(q(1.75, "kg"));
  });

  test("no unit and Stück are both a count", () => {
    expect(mergeQuantities(q(2), q(1, "Stück"))).toEqual(q(3, "Stück"));
    expect(mergeQuantities(q(2, "Stück"), q(1))).toEqual(q(3, "Stück"));
  });

  test("a different unit is appended, not converted", () => {
    expect(mergeQuantities(q(2), q(1, "Packung"))).toEqual(q(2, "+ 1 Packung"));
    expect(formatQuantity(q(2, "+ 1 Packung"))).toBe("2 + 1 Packung");
    expect(mergeQuantities(q(500, "g"), q(1, "kg"))).toEqual(q(500, "g + 1 kg"));
  });

  test("a later add in an appended unit adds to that part", () => {
    expect(mergeQuantities(q(2, "Stück + 1 Packung"), q(1, "Packung"))).toEqual(q(2, "Stück + 2 Packung"));
    expect(mergeQuantities(q(2, "+ 1 Packung"), q(3))).toEqual(q(5, "+ 1 Packung"));
  });

  test("no quantity is 'some': it adds nothing, and two of them stay without one", () => {
    expect(mergeQuantities(q(null), q(null))).toEqual(q(null));
    expect(mergeQuantities(q(2, "L"), q(null))).toEqual(q(2, "L"));
    expect(mergeQuantities(q(null), q(500, "g"))).toEqual(q(500, "g"));
  });

  test("spellings of one unit are one unit", () => {
    expect(mergeQuantities(q(500, "g"), q(250, "gramm"))).toEqual(q(750, "g"));
    expect(mergeQuantities(q(1, "Packung"), q(1, "pack"))).toEqual(q(2, "Packung"));
  });

  test("the unit stops growing at its limit", () => {
    let acc = q(1, "Stück");
    for (let i = 0; i < 40; i++) acc = mergeQuantities(acc, q(1, `unit${i}`));
    expect((acc.unit ?? "").length).toBeLessThanOrEqual(MAX_UNIT_LENGTH);
  });

  test("a caller's quantity text", () => {
    expect(parseQuantityText("2")).toEqual({ ok: true, value: q(2, "Stück") });
    expect(parseQuantityText("2x")).toEqual({ ok: true, value: q(2, "Stück") });
    expect(parseQuantityText("×3")).toEqual({ ok: true, value: q(3, "Stück") });
    expect(parseQuantityText("500 g")).toEqual({ ok: true, value: q(500, "g") });
    expect(parseQuantityText("500g")).toEqual({ ok: true, value: q(500, "g") });
    expect(parseQuantityText("1,5 kg")).toEqual({ ok: true, value: q(1.5, "kg") });
    expect(parseQuantityText("1 pack")).toEqual({ ok: true, value: q(1, "Packung") });
    expect(parseQuantityText("2 Becher")).toEqual({ ok: true, value: q(2, "Becher") });
    for (const bad of ["", "a pinch", "0", "1/2", "-1", "2".repeat(41), null, {}]) {
      expect(parseQuantityText(bad).ok, String(bad)).toBe(false);
    }
  });
});

test.describe("Bring! specification", () => {
  test("is the printed amount, whole; nothing without a quantity", () => {
    expect(bringSpecification(q(200, "g"))).toBe("200 g");
    expect(bringSpecification(q(2, "Stück + 1 Packung"))).toBe("2 Stück + 1 Packung");
    expect(bringSpecification(q(3))).toBe("3");
    expect(bringSpecification(q(null))).toBeUndefined();
  });
});

// ── the add ─────────────────────────────────────────────────────────────────

function fakeStore(items: OpenShoppingItem[]) {
  const rows: Record<string, unknown>[] = [];
  const updates: Array<{ id: string; patch: Parameters<ShoppingStore["update"]>[2] }> = [];
  const asked: string[] = [];
  let next = 1;
  const store: ShoppingStore = {
    openItems: async (familyId) => {
      asked.push(familyId);
      return items.filter((i) => i.checked !== true).map((i) => ({ ...i }));
    },
    insert: async (_familyId, newRows) => {
      rows.push(...newRows);
      return newRows.map(() => `new-${next++}`);
    },
    update: async (_familyId, id, patch) => { updates.push({ id, patch }); },
  };
  return { store, rows, updates, asked };
}

const row = (name: string, quantity: number | null = null, unit: string | null = null) =>
  ({ name, quantity, unit, notes: null });

test.describe("addOrMergeShoppingItems", () => {
  test("a new name is inserted", async () => {
    const f = fakeStore([]);
    const out = await addOrMergeShoppingItems(FAMILY, [row("Milch", 1, "L")], f.store);
    expect(out.outcomes).toEqual([{ merged: false, item: { id: "new-1", name: "Milch", quantity: 1, unit: "L", amount: "1 L" } }]);
    expect(f.rows).toHaveLength(1);
    expect(f.updates).toEqual([]);
    expect(f.asked).toEqual([FAMILY]);
  });

  test("the same name merges into the item already there, keeping its name", async () => {
    const f = fakeStore([open({ id: "milk", name: "milk", quantity: 1 })]);
    const out = await addOrMergeShoppingItems(FAMILY, [row("Milk", 1)], f.store);
    expect(out.outcomes).toEqual([{ merged: true, item: { id: "milk", name: "milk", quantity: 2, unit: null, amount: "2" } }]);
    expect(f.rows).toEqual([]);
    expect(f.updates).toEqual([{ id: "milk", patch: { quantity: 2, unit: null, notes: null } }]);
    expect(out.changed.map((c) => c.id)).toEqual(["milk"]);
  });

  test("a ticked item is not merged into: a new one is added", async () => {
    const f = fakeStore([open({ id: "bought", name: "Milch", quantity: 1, checked: true })]);
    const out = await addOrMergeShoppingItems(FAMILY, [row("Milch", 1)], f.store);
    expect(out.outcomes[0].merged).toBe(false);
    expect(f.rows).toHaveLength(1);
    expect(f.updates).toEqual([]);
  });

  test("the same thing twice in one call is one item", async () => {
    const f = fakeStore([]);
    const out = await addOrMergeShoppingItems(FAMILY, [row("Zwiebel", 1), row("Zwiebeln", 2)], f.store);
    expect(f.rows).toEqual([expect.objectContaining({ name: "Zwiebel", quantity: 3 })]);
    expect(out.outcomes.map((o) => [o.merged, o.item.id, o.item.quantity])).toEqual([[false, "new-1", 3], [true, "new-1", 3]]);
  });

  test("a merge that changes nothing writes nothing and tells Bring! nothing", async () => {
    const f = fakeStore([open({ id: "salt", name: "Salz" })]);
    const out = await addOrMergeShoppingItems(FAMILY, [row("Salz")], f.store);
    expect(out.outcomes[0].merged).toBe(true);
    expect(f.updates).toEqual([]);
    expect(out.changed).toEqual([]);
  });
});

test.describe("addShoppingItemFromText with a quantity", () => {
  const search = async () => ({ results: [] });
  const connected = { credentials: { accessToken: "t" }, selectedListId: "list-1", twoWaySync: true };
  function bring() {
    const adds: Parameters<BringPushDeps["add"]>[0][] = [];
    return { adds, deps: { loadSettings: async () => connected, add: async (a: Parameters<BringPushDeps["add"]>[0]) => { adds.push(a); } } };
  }

  test("an explicit quantity wins over the one in the text", async () => {
    const f = fakeStore([]);
    const out = await addShoppingItemFromText(FAMILY, { text: "2 kg Bananen", quantity: q(3, "Stück") }, { search, store: f.store, bring: bring().deps });
    expect(out.item).toMatchObject({ name: "Bananen", quantity: 3, unit: "Stück" });
  });

  test("merging puts the existing name and the combined amount on Bring!, so Bring! updates its item", async () => {
    const f = fakeStore([open({ id: "eggs", name: "Eier", quantity: 6, unit: "Stück" })]);
    const b = bring();
    const out = await addShoppingItemFromText(FAMILY, { text: "Eier", quantity: q(4, "Stück") }, { search, store: f.store, bring: b.deps });
    expect(out).toMatchObject({ merged: true, bring: "pushed", item: { id: "eggs", quantity: 10, amount: "10 Stück" } });
    expect(b.adds.map((a) => [a.itemName, a.specification])).toEqual([["Eier", "10 Stück"]]);
  });

  test("a merge with nothing new does not touch Bring!", async () => {
    const f = fakeStore([open({ id: "salt", name: "Salz" })]);
    const b = bring();
    const out = await addShoppingItemFromText(FAMILY, { text: "salz" }, { search, store: f.store, bring: b.deps });
    expect(out).toMatchObject({ merged: true, bring: "unchanged" });
    expect(b.adds).toEqual([]);
  });
});
