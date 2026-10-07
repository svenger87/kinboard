/**
 * Server-side lookups and the one write path for a creature (RFC-017). Every
 * read is scoped to the family the caller hands in, the session's own: RLS is
 * off for the service role, so the filter here is the whole boundary
 * (lib/family-scope).
 */

import { requireSettingsUnlock } from "@/lib/settings-pin";
import type { SessionContext } from "@/lib/session";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { moneyAvailable, pluginOn, type CreaturePatch } from "./rules";
import { clampStageWrites, justifiedTiers } from "./stage";
import { wornNotOwned } from "@/lib/pocket-money/creatures/look";
import { SHOP_SLOTS, ownedSet } from "@/lib/pocket-money/creatures/shop";

// The admin client is untyped for these tables, as in the other routes.
type Db = any;

export interface ChildRow {
  id: string;
  family_id: string;
  is_child: boolean | null;
}

/** The person, if they are in this family and not in the recycle bin. */
export async function personInFamily(db: Db, familyId: string, personId: string): Promise<ChildRow | null> {
  const { data, error } = await db
    .from("people")
    .select("id, family_id, is_child")
    .eq("id", personId)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ChildRow | null) ?? null;
}

/** Whether the family has the pocket-money plugin on (missing means on). */
export async function pocketMoneyOn(db: Db, familyId: string): Promise<boolean> {
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.enabledPlugins)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return pluginOn(data?.value, "pocket-money");
}

/** The child's pocket-money account in this family: its balance, or null. */
export async function accountOf(db: Db, familyId: string, personId: string): Promise<{ id: string; balance_cents: number } | null> {
  const { data, error } = await db
    .from("pocket_money_accounts")
    .select("id, balance_cents")
    .eq("family_id", familyId)
    .eq("person_id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Whether the child has a pocket-money account in this family. */
export async function hasAccount(db: Db, familyId: string, personId: string): Promise<boolean> {
  return Boolean(await accountOf(db, familyId, personId));
}

/** "Grows with saved money" is on offer for this child (RFC-017 §2.3). */
export async function moneyAvailableFor(db: Db, familyId: string, personId: string): Promise<boolean> {
  const [on, account] = await Promise.all([pocketMoneyOn(db, familyId), hasAccount(db, familyId, personId)]);
  return moneyAvailable({ pocketMoneyOn: on, hasAccount: account });
}

/** Every task point the child has earned, all time. */
export async function earnedPoints(db: Db, familyId: string, personId: string): Promise<number> {
  const { data, error } = await db
    .from("todo_point_awards")
    .select("points")
    .eq("family_id", familyId)
    .eq("person_id", personId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ points: number }>).reduce((sum, r) => sum + (r.points ?? 0), 0);
}

/** The shop items the child owns (point_purchases), in this family. */
export async function ownedItems(db: Db, familyId: string, personId: string): Promise<ReadonlySet<string>> {
  const { data, error } = await db
    .from("point_purchases")
    .select("item_id")
    .eq("family_id", familyId)
    .eq("person_id", personId);
  if (error) throw new Error(error.message);
  return ownedSet(data as Array<{ item_id: string }> | null);
}

export type CreatureWrite = { status: number; body: Record<string, unknown> };

/**
 * Writes a checked creature patch: the one path for PATCH
 * /api/creatures/[personId] and, for one release, the creature fields the old
 * account PATCH still forwards.
 *
 *   - a parental field puts the whole write behind the settings PIN
 *   - the creature must exist; kid-side fields need it switched on
 *   - grows_with 'money' only with the plugin on and an account
 *   - best_tier and last_seen_tier are held to what the growth source
 *     justifies right now (clampStageWrites)
 *   - a look may wear only shop items the child owns (409 not_owned)
 */
export async function applyCreaturePatch(args: {
  db: Db;
  session: SessionContext;
  /** The session's own family: every read and write below filters on it. */
  familyId: string;
  personId: string;
  patch: CreaturePatch;
  parental: boolean;
  /** The caller already checked the PIN for this request. */
  pinChecked?: boolean;
}): Promise<CreatureWrite> {
  const { db, session, personId, parental } = args;
  let patch = args.patch;
  if (parental && !args.pinChecked) {
    const locked = await requireSettingsUnlock(session);
    if (locked) return { status: locked.status, body: await locked.json() };
  }
  const familyId = args.familyId;
  const { data: creature, error: readErr } = await db
    .from("creatures")
    .select("person_id, enabled, grows_with, best_tier")
    .eq("person_id", personId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (readErr) return { status: 500, body: { error: readErr.message } };
  if (!creature) return { status: 404, body: { error: "not found" } };

  if (!parental && !creature.enabled) return { status: 409, body: { error: "creature_off" } };
  if (patch.grows_with === "money" && !(await moneyAvailableFor(db, familyId, personId))) {
    return { status: 409, body: { error: "money_unavailable" } };
  }

  // Only owned items can be worn (RFC-017 §5). The look's values are already
  // catalogue items for their slots (validateLook); this is whether the
  // child bought them. A purchase is never taken back, so an item owned here
  // is still owned when the update below lands.
  const look = patch.look;
  if (look && SHOP_SLOTS.some((slot) => look[slot] !== undefined)) {
    let owned: ReadonlySet<string>;
    try {
      owned = await ownedItems(db, familyId, personId);
    } catch (err) {
      return { status: 500, body: { error: err instanceof Error ? err.message : "purchases" } };
    }
    const missing = wornNotOwned(look, owned);
    if (missing.length > 0) return { status: 409, body: { error: "not_owned", items: missing } };
  }

  if (patch.best_tier !== undefined || patch.last_seen_tier !== undefined) {
    const [account, earned] = await Promise.all([accountOf(db, familyId, personId), earnedPoints(db, familyId, personId)]);
    const growsWith = patch.grows_with ?? creature.grows_with;
    patch = clampStageWrites(patch, justifiedTiers({ creature: { grows_with: growsWith, best_tier: creature.best_tier }, account, earnedPoints: earned }));
  }

  const { data, error } = await db
    .from("creatures")
    .update(patch)
    .eq("person_id", personId)
    .eq("family_id", familyId)
    .select()
    .maybeSingle();
  if (error) return { status: 500, body: { error: error.message } };
  if (!data) return { status: 404, body: { error: "not found" } };
  return { status: 200, body: { creature: data } };
}
