/**
 * Server-side lookups for the creature and reward routes (RFC-017). Every
 * read is scoped to the session's family: RLS is off for the service role, so
 * the filter here is the whole boundary (lib/family-scope).
 */

import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { moneyAvailable, pluginOn } from "./rules";

// The admin client is untyped for these tables, as in the other routes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface ChildRow {
  id: string;
  family_id: string;
  is_child: boolean | null;
}

/** The person, if they are in this family. */
export async function personInFamily(db: Db, familyId: string, personId: string): Promise<ChildRow | null> {
  const { data, error } = await db
    .from("people")
    .select("id, family_id, is_child")
    .eq("id", personId)
    .eq("family_id", familyId)
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

/** Whether the child has a pocket-money account in this family. */
export async function hasAccount(db: Db, familyId: string, personId: string): Promise<boolean> {
  const { data, error } = await db
    .from("pocket_money_accounts")
    .select("id")
    .eq("family_id", familyId)
    .eq("person_id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** "Grows with saved money" is on offer for this child (RFC-017 §2.3). */
export async function moneyAvailableFor(db: Db, familyId: string, personId: string): Promise<boolean> {
  const [on, account] = await Promise.all([pocketMoneyOn(db, familyId), hasAccount(db, familyId, personId)]);
  return moneyAvailable({ pocketMoneyOn: on, hasAccount: account });
}
