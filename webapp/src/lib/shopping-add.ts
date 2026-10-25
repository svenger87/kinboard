/**
 * Adding to the shopping list without duplicating what is already on it:
 * `addOrMergeShoppingItems` plans with lib/shopping-merge.ts and writes the
 * plan through a `ShoppingStore`.
 *
 * Kept apart from lib/shopping-enrich.ts, which reaches the server (catalogue,
 * Bring!, the service role), so the shopping pages can use the same rules from
 * the browser: `shoppingStore` takes either Supabase client — the browser's,
 * under the family's row-level security, or the server's admin one.
 */

import {
  findMergeTarget,
  formatQuantity,
  mergeQuantities,
  type OpenShoppingItem,
  type Quantity,
} from "@/lib/shopping-merge";

/**
 * The three things an add does to `shopping_items`, as a seam: production
 * talks to Supabase (`shoppingStore`), the specs to an array.
 */
export interface ShoppingStore {
  /** This family's items that are not ticked, oldest first. */
  openItems(familyId: string): Promise<OpenShoppingItem[]>;
  /** Insert rows (family_id and checked are filled in); ids in the same order. */
  insert(familyId: string, rows: Record<string, unknown>[]): Promise<string[]>;
  /** Write a merged item's new quantity, unit and notes. */
  update(familyId: string, id: string, patch: Quantity & { notes: string | null }): Promise<void>;
}

/** Enough for a household's list; an add looks for a match among at most this many. */
const MAX_OPEN_ITEMS = 500;

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function shoppingStore(db: unknown): ShoppingStore {
  const client = db as any;
  return {
    async openItems(familyId) {
      // `checked` is nullable: NOT (checked IS TRUE) keeps the nulls, which are unticked.
      const { data, error } = await client
        .from("shopping_items")
        .select("id, name, quantity, unit, notes, checked")
        .eq("family_id", familyId)
        .not("checked", "is", true)
        .order("created_at", { ascending: true })
        .limit(MAX_OPEN_ITEMS);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        quantity: toNumber(row.quantity),
        unit: (row.unit as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        checked: (row.checked as boolean | null) ?? null,
      }));
    },
    async insert(familyId, rows) {
      if (rows.length === 0) return [];
      const { data, error } = await client
        .from("shopping_items")
        .insert(rows.map((row) => ({ ...row, family_id: familyId, checked: false })))
        .select("id");
      if (error) throw error;
      return ((data ?? []) as Array<{ id: unknown }>).map((row) => String(row.id));
    },
    async update(familyId, id, patch) {
      const { error } = await client
        .from("shopping_items")
        .update(patch)
        .eq("id", id)
        .eq("family_id", familyId);
      if (error) throw error;
    },
  };
}

/** One item as it now stands on the list, after an add. */
export interface StoredShoppingItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  /** quantity and unit as the shopping page prints them ("2 Stück + 1 Packung"), or null. */
  amount: string | null;
}

export interface ShoppingAddOutcome {
  /** True when the add went into an item already on the list instead of making a new one. */
  merged: boolean;
  item: StoredShoppingItem;
}

/** A row to add: the columns of a new item, of which name/quantity/unit/notes also drive a merge. */
export type ShoppingAddRow = Quantity & { name: string; notes: string | null } & Record<string, unknown>;

interface Candidate extends OpenShoppingItem {
  /** Where the id comes from: a row already there, or the n-th insert of this add. */
  ref: { existing: string } | { insert: number };
  /** Needs writing: new, or a merge changed its quantity, unit or notes. */
  dirty: boolean;
  /** New, or its quantity/unit changed — what Bring! is told about. A notes-only change is not. */
  amountChanged: boolean;
  row?: ShoppingAddRow;
}

/**
 * Add rows to the list, merging each into an unchecked item with the same
 * name (lib/shopping-merge.ts) — one already there, or one an earlier row of
 * the same call is adding, so a recipe that lists salt twice adds one salt.
 *
 * Returns one outcome per row, in order, and the items that are new or
 * whose quantity changed — what Bring! needs to hear about. An item merged
 * without a new amount (a second "Salz" with no quantity, even one that
 * brings a note) is not in that list: it is on Bring! already, and a push
 * would only wipe a specification set there.
 *
 * New rows go in with one insert, first; merged items are updated after it.
 * Throws if reading, inserting or updating fails.
 */
export async function addOrMergeShoppingItems(
  familyId: string,
  rows: ShoppingAddRow[],
  store: ShoppingStore,
): Promise<{ outcomes: ShoppingAddOutcome[]; changed: StoredShoppingItem[] }> {
  if (rows.length === 0) return { outcomes: [], changed: [] };
  const candidates: Candidate[] = (await store.openItems(familyId)).map((item) => ({
    ...item, ref: { existing: item.id }, dirty: false, amountChanged: false,
  }));

  const inserts: ShoppingAddRow[] = [];
  const touched: Array<{ candidate: Candidate; merged: boolean }> = [];
  for (const row of rows) {
    const target = findMergeTarget(candidates, row.name);
    if (target) {
      const next = mergeQuantities(target, row);
      const notes = target.notes || row.notes || null;
      const amountChanged = next.quantity !== target.quantity || next.unit !== target.unit;
      if (amountChanged || notes !== (target.notes ?? null)) {
        target.amountChanged ||= amountChanged;
        target.quantity = next.quantity;
        target.unit = next.unit;
        target.notes = notes;
        target.dirty = true;
        if (target.row) Object.assign(target.row, { quantity: next.quantity, unit: next.unit, notes });
      }
      touched.push({ candidate: target, merged: true });
    } else {
      const own = { ...row };
      inserts.push(own);
      const candidate: Candidate = {
        id: "", name: own.name, quantity: own.quantity, unit: own.unit, notes: own.notes, checked: false,
        ref: { insert: inserts.length - 1 }, dirty: true, amountChanged: true, row: own,
      };
      candidates.push(candidate);
      touched.push({ candidate, merged: false });
    }
  }

  const ids = await store.insert(familyId, inserts);
  for (const c of candidates) {
    if ("insert" in c.ref) c.id = ids[c.ref.insert];
  }
  for (const c of candidates) {
    if ("existing" in c.ref && c.dirty) {
      await store.update(familyId, c.id, { quantity: c.quantity, unit: c.unit, notes: c.notes ?? null });
    }
  }

  const stored = (c: Candidate): StoredShoppingItem => ({
    id: c.id, name: c.name, quantity: c.quantity, unit: c.unit, amount: formatQuantity(c),
  });
  const outcomes = touched.map(({ candidate, merged }) => ({ merged, item: stored(candidate) }));
  const changed = [...new Set(touched.map((t) => t.candidate))]
    .filter((c) => c.amountChanged)
    .map(stored);
  return { outcomes, changed };
}
