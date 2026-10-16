/**
 * The Bring! → Kinboard half of the sync (#407), and the repair of the other.
 *
 * Kinboard only ever pushed: adding, ticking and deleting an item on the
 * shopping page told Bring!, and nothing read Bring! back. An item somebody
 * put on the list in the Bring! app never reached Kinboard, and one bought
 * there stayed open on the kitchen wall.
 *
 * A sync reads the selected Bring! list and reconciles `shopping_items` with
 * it. Two columns carry what a comparison of the two lists cannot:
 *
 *   - `bring_item_id`, the link: the Bring! key of the item (for a catalogue
 *     item the German catalogue name, "Milch", whatever language the family
 *     uses), set once an item has been seen on, or put on, the Bring! list.
 *     An open item that is linked and gone from Bring! was bought there; one
 *     that was never linked never got there.
 *   - `bring_list_id`, the Bring! list the link belongs to. A link to another
 *     list — the family picked a different one, or signed in to another
 *     account — counts as no link, or every linked open item would look
 *     bought on the new list and be ticked off.
 *   - `bring_checked`, the ticked state last agreed with Bring!. A row whose
 *     `checked` differs from it was ticked or unticked in Kinboard since —
 *     by the shop mode, an assistant, the offline queue, any path — and
 *     Kinboard's change is pushed; otherwise a difference is Bring!'s and
 *     Kinboard takes it.
 *
 * And `bring_removals` (a trigger fills it) lists open, linked items deleted
 * in Kinboard, so they are taken off Bring! instead of being read back in.
 *
 * With two-way sync off Kinboard mirrors Bring!: nothing is pushed, and on a
 * disagreement Bring! wins.
 *
 * The plan is a pure function of the two lists (`planBringSync`); applying
 * it (`syncBringFamily`) is the only part that touches the network and the
 * database, and both are parameters, so the rules are tested without either.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { getFamilyLocale } from "@/lib/family-locale";
import { LOCALES } from "@/i18n/locales";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { detectCategory } from "@/lib/shopping-categories";
import { getBringCatalog, mapBringSectionToCategory } from "@/lib/catalog-search";
import { formatQuantity, parseQuantityText, type Quantity } from "@/lib/shopping-merge";
import {
  addBringListItem,
  getBringList,
  removeBringListItem,
  withBringAccess,
  type BringListItem,
  type ServerBringSettings,
} from "@/lib/bring-server";

/** A `shopping_items` row, as much of it as the sync reads. */
export interface SyncShoppingRow extends Quantity {
  id: string;
  name: string;
  checked: boolean | null;
  bring_item_id: string | null;
  bring_checked: boolean | null;
  /** The list `bring_item_id` belongs to; the sync drops a link to another list. */
  bring_list_id?: string | null;
}

export interface BringSyncInsert extends Quantity {
  /** What Kinboard shows: the family-language catalogue name, else the Bring! key. */
  name: string;
  bring_item_id: string;
  notes: string | null;
}

export interface BringSyncPatch {
  checked?: boolean;
  bring_item_id?: string;
  bring_checked?: boolean;
  bring_list_id?: string;
}

export interface BringSyncPlan {
  /** On Bring!, not in Kinboard: new rows. */
  inserts: BringSyncInsert[];
  /** Open in Kinboard, not on Bring!: put on the list there (two-way sync only). */
  bringAdd: { name: string; specification?: string }[];
  /** Ticked or deleted in Kinboard, still open on Bring!: tick off there (two-way sync only). */
  bringRemove: string[];
  /** Row changes, applied once the Bring! side is done. */
  updates: { id: string; patch: BringSyncPatch }[];
}

const norm = (s: string) => s.trim().toLocaleLowerCase("de-DE");

/**
 * Work out what a sync changes.
 *
 * `translations` maps a Bring! key to the family's language ("Milch" →
 * "Milk"); an empty map keeps the keys as they are. `removed` are the keys
 * of open, linked items deleted in Kinboard since the last sync. `rows`
 * should come oldest first: of two ticked "Milch" rows the newer comes back.
 */
export function planBringSync({
  purchase,
  rows,
  translations = new Map(),
  removed = [],
  push,
}: {
  purchase: BringListItem[];
  rows: SyncShoppingRow[];
  translations?: Map<string, string>;
  removed?: string[];
  push: boolean;
}): BringSyncPlan {
  const plan: BringSyncPlan = { inserts: [], bringAdd: [], bringRemove: [], updates: [] };

  // A row typed in the family's language ("Milk") is the catalogue item
  // Bring! keeps as "Milch"; this finds the key for it.
  const keyForName = new Map<string, string>();
  for (const [key, local] of translations) {
    if (!keyForName.has(norm(local))) keyForName.set(norm(local), key);
  }
  const bringKeyOf = (row: SyncShoppingRow) =>
    row.bring_item_id || keyForName.get(norm(row.name)) || row.name.trim();

  const groups = new Map<string, { key: string; rows: SyncShoppingRow[]; bring?: BringListItem }>();
  const groupFor = (key: string) => {
    const k = norm(key);
    let group = groups.get(k);
    if (!group) groups.set(k, (group = { key, rows: [] }));
    return group;
  };
  for (const row of rows) {
    const key = bringKeyOf(row);
    if (key) groupFor(key).rows.push(row);
  }
  for (const item of purchase) {
    // "Milk" typed on an English Kinboard reaches Bring! as a custom item
    // named "Milk"; it is still the family's milk, not a second item.
    const group = groupFor(keyForName.get(norm(item.name)) || item.name);
    group.bring ??= item;
  }
  const removedKeys = new Set(removed.map(norm));

  const update = (row: SyncShoppingRow, patch: BringSyncPatch) => {
    const changed = (Object.keys(patch) as (keyof BringSyncPatch)[]).filter((k) => patch[k] !== row[k]);
    if (changed.length === 0) return;
    plan.updates.push({ id: row.id, patch: Object.fromEntries(changed.map((k) => [k, patch[k]])) });
  };

  for (const [k, { key, rows: group, bring }] of groups) {
    const open = group.filter((row) => !row.checked);
    const ticked = group.filter((row) => row.checked);
    // Changed in Kinboard since Bring! last agreed.
    const tickedHere = ticked.filter((row) => row.bring_item_id && row.bring_checked === false);
    const untickedHere = open.filter((row) => row.bring_item_id && row.bring_checked === true);
    const neverOnBring = open.filter((row) => !row.bring_item_id);

    if (bring) {
      const linkedKey = bring.name;
      if (open.length > 0) {
        // Wanted on both sides.
        for (const row of open) update(row, { bring_item_id: linkedKey, bring_checked: false });
        for (const row of ticked) if (row.bring_item_id) update(row, { bring_checked: true });
      } else if (push && (tickedHere.length > 0 || removedKeys.has(k))) {
        // Bought or deleted in Kinboard, Bring! not told yet.
        plan.bringRemove.push(linkedKey);
        for (const row of ticked) if (row.bring_item_id) update(row, { bring_checked: true });
      } else if (ticked.length > 0) {
        // Put back on the list in the Bring! app (or Bring! wins, one-way).
        const latest = ticked[ticked.length - 1];
        update(latest, { checked: false, bring_item_id: linkedKey, bring_checked: false });
        for (const row of ticked) if (row !== latest && row.bring_item_id) update(row, { bring_checked: true });
      } else {
        // Added in the Bring! app.
        const spec = bring.specification.trim();
        const parsed = spec ? parseQuantityText(spec) : null;
        plan.inserts.push({
          name: translations.get(linkedKey) || linkedKey,
          bring_item_id: linkedKey,
          quantity: parsed?.ok ? parsed.value.quantity : null,
          unit: parsed?.ok ? parsed.value.unit : null,
          notes: spec && !parsed?.ok ? spec : null,
        });
      }
      continue;
    }

    // Not (or no longer) open on Bring!.
    if (push && (neverOnBring.length > 0 || untickedHere.length > 0)) {
      // Added or unticked in Kinboard: put it on the list.
      const source = neverOnBring[0] ?? untickedHere[0];
      plan.bringAdd.push({ name: key, specification: formatQuantity(source) ?? undefined });
      for (const row of open) update(row, { bring_item_id: key, bring_checked: false });
    } else {
      // Bought (or removed) in the Bring! app. A never-linked row is a
      // Kinboard-only item in one-way mode and stays as it is.
      for (const row of open) if (row.bring_item_id) update(row, { checked: true, bring_checked: true });
    }
    for (const row of ticked) if (row.bring_item_id) update(row, { bring_checked: true });
  }

  return plan;
}

export type BringSyncOutcome =
  | { status: "skipped"; reason: "not_connected" | "no_list" }
  | { status: "synced"; added: number; updated: number; pushed: number; removed: number };

/** Everything a sync reaches outside itself. */
export interface BringSyncDeps {
  loadSettings: (familyId: string) => Promise<ServerBringSettings | null>;
  /** Runs `call` with a working access token (renewing it once on a 401). */
  withAccess: <T>(familyId: string, settings: ServerBringSettings | null, call: (accessToken: string) => Promise<T>) => Promise<T>;
  getList: typeof getBringList;
  add: typeof addBringListItem;
  remove: typeof removeBringListItem;
  /** Bring! key → the family's word for it. Empty for German or when the catalogue is unreachable. */
  translations: (familyId: string) => Promise<Map<string, string>>;
  /** The Kinboard category for a new item. */
  category: (bringKey: string, name: string, useBringCategories: boolean) => Promise<string>;
  rows: (familyId: string) => Promise<SyncShoppingRow[]>;
  /** Deletions the trigger recorded: their ids (to clear afterwards), keys and lists. */
  removals: (familyId: string) => Promise<{ id: number; bring_item_id: string; bring_list_id?: string | null }[]>;
  clearRemovals: (familyId: string, ids: number[]) => Promise<void>;
  insert: (familyId: string, rows: Array<BringSyncInsert & { category: string; bring_list_id: string }>) => Promise<void>;
  update: (familyId: string, id: string, patch: BringSyncPatch) => Promise<void>;
}

/**
 * Open items a sync reads at most, and ticked ones (newest first). More open
 * items than this and the sync refuses rather than plan from part of the
 * list: an open item it did not read would be added again on every run.
 */
const MAX_ROWS = 1000;
const BRING_TIMEOUT_MS = 10_000;

// Two syncs of one family at once (the cron and an open shopping page) would
// both see a new Bring! item as missing and both insert it. The webapp is one
// Node process, so a per-family queue here is enough.
const running = new Map<string, Promise<unknown>>();

/**
 * Sync one family's selected Bring! list with its shopping list. Throws when
 * Bring! or the database fails; a BringAuthError means signing in again.
 */
export async function syncBringFamily(familyId: string, deps: BringSyncDeps = liveBringSyncDeps()): Promise<BringSyncOutcome> {
  const previous = running.get(familyId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => syncOnce(familyId, deps));
  running.set(familyId, run);
  try {
    return await run;
  } finally {
    if (running.get(familyId) === run) running.delete(familyId);
  }
}

async function syncOnce(familyId: string, deps: BringSyncDeps): Promise<BringSyncOutcome> {
  const settings = await deps.loadSettings(familyId);
  if (!settings?.credentials?.accessToken) return { status: "skipped", reason: "not_connected" };
  const listId = settings.selectedListId;
  if (!listId) return { status: "skipped", reason: "no_list" };

  const push = settings.twoWaySync !== false;
  const useBringCategories = settings.syncCategories !== false;

  return deps.withAccess(familyId, settings, async (accessToken) => {
    const signal = () => AbortSignal.timeout(BRING_TIMEOUT_MS);
    const [list, storedRows, translations, removals] = await Promise.all([
      deps.getList({ accessToken, listId, signal: signal() }),
      deps.rows(familyId),
      deps.translations(familyId),
      deps.removals(familyId),
    ]);
    // A link made with another list says nothing about this one.
    const rows = storedRows.map((row) =>
      row.bring_item_id && row.bring_list_id !== listId ? { ...row, bring_item_id: null, bring_checked: null } : row,
    );
    const plan = planBringSync({
      purchase: list.purchase,
      rows,
      translations,
      removed: removals.filter((r) => r.bring_list_id === listId).map((r) => r.bring_item_id),
      push,
    });

    // Bring! first: the rows only record agreement once Bring! has it, so a
    // push that fails is simply worked out and tried again next time.
    for (const item of plan.bringAdd) {
      await deps.add({ accessToken, listId, itemName: item.name, specification: item.specification, signal: signal() });
    }
    for (const name of plan.bringRemove) {
      await deps.remove({ accessToken, listId, itemName: name, signal: signal() });
    }

    if (plan.inserts.length > 0) {
      const withCategories = await Promise.all(
        plan.inserts.map(async (row) => ({
          ...row,
          category: await deps.category(row.bring_item_id, row.name, useBringCategories),
          bring_list_id: listId,
        })),
      );
      await deps.insert(familyId, withCategories);
    }
    for (const { id, patch } of plan.updates) {
      await deps.update(familyId, id, patch.bring_item_id ? { ...patch, bring_list_id: listId } : patch);
    }
    if (removals.length > 0) await deps.clearRemovals(familyId, removals.map((r) => r.id));

    return {
      status: "synced",
      added: plan.inserts.length,
      updated: plan.updates.length,
      pushed: plan.bringAdd.length,
      removed: plan.bringRemove.length,
    };
  });
}

// --- production wiring ---------------------------------------------------

const TRANSLATION_TTL_MS = 24 * 60 * 60 * 1000;
const translationCache = new Map<string, { at: number; names: Map<string, string> }>();

/**
 * Bring! key → name in one of Bring!'s catalogue languages. The catalogue's
 * `itemId` is the key a list stores; its `name` is the translation.
 */
async function catalogTranslations(bcp47: string): Promise<Map<string, string>> {
  const cached = translationCache.get(bcp47);
  if (cached && Date.now() - cached.at < TRANSLATION_TTL_MS) return cached.names;
  try {
    const response = await fetch(`https://web.getbring.com/locale/catalog.${bcp47}.json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(BRING_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`catalog.${bcp47}.json: ${response.status}`);
    const data = await response.json();
    const names = new Map<string, string>();
    for (const section of data?.catalog?.sections ?? []) {
      for (const item of section?.items ?? []) {
        if (typeof item?.itemId === "string" && typeof item?.name === "string" && item.name) {
          names.set(item.itemId, item.name);
        }
      }
    }
    translationCache.set(bcp47, { at: Date.now(), names });
    return names;
  } catch (err) {
    console.error("[bring-sync] the Bring! catalogue could not be read; items keep their Bring! names:", err);
    return cached?.names ?? new Map();
  }
}

export function liveBringSyncDeps(db: ReturnType<typeof createAdminClient> = createAdminClient()): BringSyncDeps {
  const client = db as any;
  return {
    loadSettings: (familyId) => getMergedSetting<ServerBringSettings>(familyId, SETTINGS_KEYS.bringSettings),
    withAccess: withBringAccess,
    getList: getBringList,
    add: addBringListItem,
    remove: removeBringListItem,
    async translations(familyId) {
      const locale = await getFamilyLocale(familyId, db);
      const bcp47 = LOCALES.find((l) => l.code === locale)?.bcp47 ?? "de-DE";
      // The keys are the German catalogue names already.
      if (bcp47 === "de-DE") return new Map();
      return catalogTranslations(bcp47);
    },
    async category(bringKey, name, useBringCategories) {
      const catalog = await getBringCatalog();
      const entry = catalog.find((item) => item.itemId === bringKey);
      return entry ? mapBringSectionToCategory(entry.sectionName, name, useBringCategories) : detectCategory(name);
    },
    async rows(familyId) {
      // Every open item, and the newest ticked ones: a household that never
      // clears its bought items still has all its open ones read.
      const columns = "id, name, checked, bring_item_id, bring_checked, bring_list_id, quantity, unit, created_at";
      const [open, ticked] = await Promise.all([
        client
          .from("shopping_items")
          .select(columns)
          .eq("family_id", familyId)
          .or("checked.is.null,checked.eq.false")
          .order("created_at", { ascending: true })
          .limit(MAX_ROWS + 1),
        client
          .from("shopping_items")
          .select(columns)
          .eq("family_id", familyId)
          .eq("checked", true)
          .order("created_at", { ascending: false })
          .limit(MAX_ROWS),
      ]);
      if (open.error) throw open.error;
      if (ticked.error) throw ticked.error;
      if ((open.data ?? []).length > MAX_ROWS) {
        throw new Error(`[bring-sync] more than ${MAX_ROWS} open shopping items; not syncing part of the list`);
      }
      const data = [...(open.data ?? []), ...(ticked.data ?? [])] as Record<string, unknown>[];
      // Oldest first, as planBringSync expects.
      data.sort((a, b) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)));
      return data.map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        checked: (row.checked as boolean | null) ?? null,
        bring_item_id: (row.bring_item_id as string | null) ?? null,
        bring_checked: (row.bring_checked as boolean | null) ?? null,
        bring_list_id: (row.bring_list_id as string | null) ?? null,
        quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
        unit: (row.unit as string | null) ?? null,
      }));
    },
    async removals(familyId) {
      const { data, error } = await client
        .from("bring_removals")
        .select("id, bring_item_id, bring_list_id")
        .eq("family_id", familyId)
        .order("id", { ascending: true })
        .limit(MAX_ROWS);
      if (error) throw error;
      return ((data ?? []) as Array<{ id: number; bring_item_id: string; bring_list_id: string | null }>).map((r) => ({
        id: Number(r.id),
        bring_item_id: String(r.bring_item_id),
        bring_list_id: r.bring_list_id ?? null,
      }));
    },
    async clearRemovals(familyId, ids) {
      const { error } = await client.from("bring_removals").delete().eq("family_id", familyId).in("id", ids);
      if (error) throw error;
    },
    async insert(familyId, rows) {
      const { error } = await client
        .from("shopping_items")
        .insert(rows.map((row) => ({ ...row, family_id: familyId, checked: false, bring_checked: false })));
      if (error) throw error;
    },
    async update(familyId, id, patch) {
      const { error } = await client.from("shopping_items").update(patch).eq("id", id).eq("family_id", familyId);
      if (error) throw error;
    },
  };
}

/**
 * The families the background sync covers: connected, a list picked, and
 * "Auto sync" not switched off (an old row without the switch counts as on,
 * as the settings page shows it).
 */
export async function autoSyncFamilies(db: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<string[]> {
  const { data, error } = await (db as any)
    .from("settings")
    .select("family_id, value")
    .eq("key", SETTINGS_KEYS.bringSettings);
  if (error) throw error;
  return ((data ?? []) as Array<{ family_id: string; value: Record<string, unknown> | null }>)
    .filter(({ value }) => !!value?.credentials && !!value?.selectedListId && value?.autoSync !== false)
    .map(({ family_id }) => family_id);
}
