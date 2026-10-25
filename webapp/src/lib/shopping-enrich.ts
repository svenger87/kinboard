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
import { addBringListItem, withBringAccess, type ServerBringSettings } from "@/lib/bring-server";
import { formatQuantity, type Quantity } from "@/lib/shopping-merge";
import {
  addOrMergeShoppingItems,
  shoppingStore,
  type ShoppingAddOutcome,
  type ShoppingStore,
} from "@/lib/shopping-add";

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
    const signal = AbortSignal.timeout(BRING_TIMEOUT_MS);
    await withTimeout(
      // Renews an expired access token once and retries.
      withBringAccess(familyId, settings, (token) =>
        add({
          accessToken: token,
          listId,
          itemName: item.name,
          specification,
          signal,
        }),
      ),
      BRING_TIMEOUT_MS,
      "Bring! push",
    );
    return "pushed";
  } catch (err) {
    console.error("[shopping-enrich] adding to Bring! failed; the Kinboard item stays:", err);
    return "failed";
  }
}

export {
  addOrMergeShoppingItems,
  type ShoppingAddOutcome,
  type ShoppingAddRow,
  type ShoppingStore,
  type StoredShoppingItem,
} from "@/lib/shopping-add";

/** The store the Integration API writes through: the service role's client. */
export function supabaseShoppingStore(db: ReturnType<typeof createAdminClient> = createAdminClient()): ShoppingStore {
  return shoppingStore(db);
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
