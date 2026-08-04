import { NextRequest } from "next/server";

/**
 * Confirm a row belongs to the family making the request.
 *
 * Kinboard runs with Row-Level Security disabled — the Security & Threat
 * Model page says so plainly, and names the consequence: "the device-cookie
 * + join-code model is the actual, load-bearing security boundary — it's
 * enforced entirely in application code (every API route filters by
 * `family_id`), not by Postgres. There is no database-level backstop if a
 * route ever forgot to filter."
 *
 * Several routes had forgotten. They take an id from the path, use the
 * service-role client, and update whatever row matches — so any caller who
 * knew or guessed a UUID could edit another family's pocket-money account,
 * approve their own withdrawal request, or reorder their tickers. On a
 * single-family LAN that is theoretical; on the public demo it is not, and
 * the model does not distinguish.
 *
 * This is the missing filter, in one place so it reads the same everywhere.
 */

/** How each table reaches a family. */
const SCOPE: Record<string, { column: "family_id" } | { via: "account" }> = {
  pocket_money_accounts: { column: "family_id" },
  tickers: { column: "family_id" },
  vehicles: { column: "family_id" },
  push_subscriptions: { column: "family_id" },
  // These hang off an account rather than carrying a family of their own,
  // so ownership is one hop away.
  pocket_money_goals: { via: "account" },
  pocket_money_withdrawal_requests: { via: "account" },
  pocket_money_transactions: { via: "account" },
};

export type ScopedTable = keyof typeof SCOPE;

/**
 * Read the caller's family id. Query string for reads, body for writes —
 * matching how the existing routes already take their parameters.
 */
export function familyIdFrom(request: NextRequest, body?: unknown): string | null {
  const fromQuery = request.nextUrl.searchParams.get("family_id");
  if (fromQuery) return fromQuery;
  if (body && typeof body === "object" && "family_id" in body) {
    const value = (body as Record<string, unknown>).family_id;
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/**
 * True when `id` in `table` belongs to `familyId`.
 *
 * Returns false for a missing row as well as a foreign one — callers turn
 * both into the same 404, so a probe can't tell "not yours" from "doesn't
 * exist" and enumerate ids.
 */
export async function rowInFamily(
  // The admin client is deliberately untyped in this codebase; keeping the
  // loose type local rather than spreading it through every caller.
  supabase: any,
  table: ScopedTable,
  id: string,
  familyId: string,
): Promise<boolean> {
  if (!id || !familyId) return false;
  const scope = SCOPE[table];

  if ("column" in scope) {
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .eq(scope.column, familyId)
      .maybeSingle();
    return Boolean(data);
  }

  // One hop: find the row's account, then check that account's family.
  const { data: row } = await supabase
    .from(table)
    .select("account_id")
    .eq("id", id)
    .maybeSingle();
  if (!row?.account_id) return false;

  return accountInFamily(supabase, row.account_id, familyId);
}

/** True when a pocket-money account belongs to that family. */
export async function accountInFamily(
  supabase: any,
  accountId: string,
  familyId: string,
): Promise<boolean> {
  if (!accountId || !familyId) return false;
  const { data } = await supabase
    .from("pocket_money_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("family_id", familyId)
    .maybeSingle();
  return Boolean(data);
}
