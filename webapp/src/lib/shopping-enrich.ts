/**
 * A shopping item added through the Integration API, made into the same row
 * the shopping page would have made from the same words.
 *
 * Typing "2 kg Bananen" into the shopping page parses out the quantity and
 * unit, files the item under fruit and vegetables, picks up the picture the
 * family's catalogue has for bananas, and — when Bring! two-way sync is on —
 * puts it on the Bring! list too. An assistant adding the same words through
 * the API used to get none of that: a bare name in the default category, no
 * picture, and nothing on Bring!. This file is that free-text path, server
 * side (src/app/shopping/page.tsx handleAddItem is the reference).
 *
 * Two things here must never fail an add: the catalogue lookup (it reaches
 * out to the Bring! public catalogue) and the Bring! push. Each falls back to
 * "no picture" / "not on Bring!" and logs.
 *
 * Everything that touches the network or the database is a parameter with a
 * production default, so the rules are tested without either.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { parseShoppingInput } from "@/lib/shopping-input";
import { detectCategory } from "@/lib/shopping-categories";
import { searchCatalog, type CatalogSearchParams, type CatalogSearchResult } from "@/lib/catalog-search";
import { getMergedSetting } from "@/lib/integration-secrets";
import { addBringListItem, type ServerBringSettings } from "@/lib/bring-server";
import {
  findMergeTarget,
  formatQuantity,
  mergeQuantities,
  type OpenShoppingItem,
  type Quantity,
} from "@/lib/shopping-merge";

export interface EnrichedShoppingItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  category: string;
  image_url: string | null;
  catalog_item_id: string | null;
}

export type CatalogSearchFn = (params: CatalogSearchParams) => Promise<{ results: CatalogSearchResult[] }>;

/** How long the catalogue may take before the item is added without a picture. */
const CATALOG_TIMEOUT_MS = 4_000;
/** How long Bring! may take before the add answers without waiting for it. */
const BRING_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The shopping page's fuzzy match, verbatim: the first catalogue result that
 * has a picture and whose name equals, contains or is contained in the
 * item's name. Results come in suggestion order, so the family's own
 * pictured items win.
 */
export function matchCatalogImage(
  itemName: string,
  results: CatalogSearchResult[],
): { image_url: string; catalog_item_id: string | null } | null {
  const normalizedName = itemName.toLowerCase().trim();
  const match = results.find((result) => {
    if (!result.thumbnail_url && !result.image_url) return false;
    const resultName = result.name.toLowerCase().trim();
    return resultName === normalizedName ||
      normalizedName.includes(resultName) ||
      resultName.includes(normalizedName);
  });
  if (!match) return null;
  return { image_url: (match.thumbnail_url || match.image_url) as string, catalog_item_id: match.id };
}

/**
 * Parse, categorise and find a picture for free text, as the shopping page
 * does for a typed item with nothing picked from the suggestions.
 *
 * One deliberate difference: the page searches the catalogue for what is in
 * the input box as typed ("2 kg Bananen"), because that is what it has while
 * the person is still typing; this searches for the parsed name ("Bananen"),
 * which is what the match is then made against. Searching the raw text would
 * find nothing for any input with a quantity in it.
 *
 * Only `familyId`'s catalogue (plus the global rows) is read; the caller is
 * responsible for that being the authenticated family.
 */
export async function enrichShoppingItem(
  familyId: string,
  rawText: string,
  deps: { search?: CatalogSearchFn } = {},
): Promise<EnrichedShoppingItem> {
  const search = deps.search ?? searchCatalog;
  const parsed = parseShoppingInput(rawText);
  const name = parsed.name || rawText.trim();

  let results: CatalogSearchResult[] = [];
  // The page only searches from two characters on, and so does the route.
  if (name.length >= 2) {
    try {
      ({ results } = await withTimeout(
        search({ query: name, familyId, limit: 20 }),
        CATALOG_TIMEOUT_MS,
        "catalogue search",
      ));
    } catch (err) {
      console.error("[shopping-enrich] catalogue search failed, adding without a picture:", err);
      results = [];
    }
  }

  const image = matchCatalogImage(name, results);
  return {
    name,
    quantity: parsed.quantity,
    unit: parsed.unit,
    notes: parsed.notes,
    category: detectCategory(name),
    image_url: image?.image_url ?? null,
    catalog_item_id: image?.catalog_item_id ?? null,
  };
}

/**
 * The Bring! "specification" for an item: "<quantity> <unit>" as the
 * shopping page sends it — so a merged "2 Stück + 1 Packung" goes across
 * whole — and a bare number on its own. Nothing without a quantity.
 */
export function bringSpecification(item: Quantity): string | undefined {
  return formatQuantity(item) ?? undefined;
}

export interface BringPushDeps {
  loadSettings: (familyId: string) => Promise<ServerBringSettings | null>;
  add: typeof addBringListItem;
}

const defaultBringDeps: BringPushDeps = {
  loadSettings: (familyId) => getMergedSetting<ServerBringSettings>(familyId, "bring_settings"),
  add: addBringListItem,
};

export type BringPushOutcome = "pushed" | "skipped" | "failed";

/**
 * Put the item on the family's selected Bring! list when the shopping page
 * would have: Bring! connected (a token and a selected list) and two-way
 * sync not switched off — the page treats a missing `twoWaySync` as on, and
 * so does this. Same item name and the same "<quantity> <unit>"
 * specification the page sends. Never throws.
 */
export async function pushToBring(
  familyId: string,
  item: Pick<EnrichedShoppingItem, "name" | "quantity" | "unit">,
  deps: Partial<BringPushDeps> = {},
): Promise<BringPushOutcome> {
  const { loadSettings, add } = { ...defaultBringDeps, ...deps };
  try {
    const settings = await loadSettings(familyId);
    const accessToken = settings?.credentials?.accessToken;
    const listId = settings?.selectedListId;
    if (!accessToken || !listId || settings?.twoWaySync === false) return "skipped";

    const specification = bringSpecification(item);
    await withTimeout(
      add({
        accessToken,
        listId,
        itemName: item.name,
        specification,
        signal: AbortSignal.timeout(BRING_TIMEOUT_MS),
      }),
      BRING_TIMEOUT_MS,
      "Bring! push",
    );
    return "pushed";
  } catch (err) {
    console.error("[shopping-enrich] adding to Bring! failed; the Kinboard item stays:", err);
    return "failed";
  }
}

/**
 * The three things an add does to `shopping_items`, as a seam: production
 * talks to Supabase (`supabaseShoppingStore`), the specs to an array.
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

export function supabaseShoppingStore(db: ReturnType<typeof createAdminClient> = createAdminClient()): ShoppingStore {
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

/**
 * Enrich, then add or merge, then tell Bring! — the whole add, for both
 * Integration API writers (POST /lists/shopping and the add_shopping_item
 * service). `quantity`, when given, replaces whatever quantity the text
 * itself carried. Throws only if the database does; the catalogue and Bring!
 * cannot fail it.
 *
 * A merge keeps the existing item's name, and that is the name Bring! gets:
 * Bring! keys its list by name, so putting "Eier" with the new
 * specification updates the "Eier" already there, where "Ei" would be a
 * second entry.
 */
export async function addShoppingItemFromText(
  familyId: string,
  input: { text: string; quantity?: Quantity | null },
  deps: { search?: CatalogSearchFn; store?: ShoppingStore; bring?: Partial<BringPushDeps> } = {},
): Promise<ShoppingAddOutcome & { bring: BringPushOutcome | "unchanged" }> {
  const item = await enrichShoppingItem(familyId, input.text, { search: deps.search });
  if (input.quantity) {
    item.quantity = input.quantity.quantity;
    item.unit = input.quantity.unit;
  }
  const store = deps.store ?? supabaseShoppingStore();
  const { outcomes, changed } = await addOrMergeShoppingItems(familyId, [{ ...item }], store);
  const outcome = outcomes[0];
  const bring = changed.length > 0 ? await pushToBring(familyId, changed[0], deps.bring) : "unchanged";
  return { ...outcome, bring };
}
