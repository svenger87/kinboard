/**
 * Who pocket money can be booked for, read live: a person of the family, not
 * in the recycle bin, who is a child and has an account. Shared by the
 * Integration API's booking request (`lib/integration-pocket-money.ts`) and
 * the approved booking (`DecideDeps.pocketMoneyAccount`), which looks again
 * before it runs.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { UUID } from "@/lib/home/action-requests";
import { bookPocketMoney, type BookingInput, type BookingResult, type RpcClient } from "@/lib/pocket-money/booking";

export type ChildLookup =
  /** No such person in this family, or in the recycle bin. */
  | { status: "no_person" }
  | { status: "not_a_child"; name: string }
  | { status: "no_account"; name: string }
  | { status: "ok"; name: string; account: { id: string; currency: string; balanceCents: number } };

/**
 * A person of this family, not binned, and their account. Throws when
 * unreadable. `client` is the admin client unless a test hands in a fake.
 */
export async function lookupChild(familyId: string, personId: string, client?: unknown): Promise<ChildLookup> {
  if (!UUID.test(personId)) return { status: "no_person" };
  const db = (client ?? createAdminClient()) as any;
  const { data: person, error } = await db
    .from("people")
    .select("id, name, is_child")
    .eq("id", personId)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the person: ${error.message}`);
  if (!person) return { status: "no_person" };
  if (person.is_child !== true) return { status: "not_a_child", name: person.name };
  const { data: account, error: accountError } = await db
    .from("pocket_money_accounts")
    .select("id, currency, balance_cents")
    .eq("person_id", personId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (accountError) throw new Error(`Failed to read the account: ${accountError.message}`);
  if (!account) return { status: "no_account", name: person.name };
  return {
    status: "ok",
    name: person.name,
    account: { id: account.id, currency: account.currency ?? "EUR", balanceCents: account.balance_cents ?? 0 },
  };
}

/** `DecideDeps.pocketMoneyAccount`: the account of a child of this family, or null. */
export async function childPocketMoneyAccount(
  familyId: string, personId: string,
): Promise<{ accountId: string; currency: string } | null> {
  const found = await lookupChild(familyId, personId);
  return found.status === "ok" ? { accountId: found.account.id, currency: found.account.currency } : null;
}

/** `DecideDeps.bookPocketMoney`, on the admin client. */
export function liveBookPocketMoney(input: BookingInput): Promise<BookingResult> {
  return bookPocketMoney(createAdminClient() as unknown as RpcClient, input);
}
