/**
 * The scheduled pocket-money runs and a parent's decision on a withdrawal
 * request, with the database handed in — the cron routes and
 * `/api/pocket-money/withdrawal-requests/{id}` are thin wrappers, and
 * `e2e/pocket-money-runs.spec.ts` drives these with a fake client to pin what
 * each one asks the database to do.
 *
 * Every balance change here is one SQL call
 * (`docker/migration_zzzzz_pocket_money_booking.sql`):
 *
 * - the allowance: `pay_pocket_money_allowance()` claims the period and books
 *   it in one transaction;
 * - interest: `accrue_pocket_money_interest()` adds to pending as a delta,
 *   once a day; `commit_pocket_money_interest()` books what is pending under
 *   the row lock;
 * - a withdrawal request: `decide_pocket_money_withdrawal()` locks the request,
 *   checks it is still pending, books, and records the decision together.
 */

import { applyDailyAccrual } from "@/lib/pocket-money/interest";
import { accruePendingInterest, commitPendingInterest, type RpcClient } from "@/lib/pocket-money/booking";

/** The admin client, as far as these runs use it: table reads and RPCs. */
export type PocketMoneyClient = RpcClient & { from: (table: string) => any };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Pay every account whose allowance falls due today (UTC weekday). */
export async function processAllowance(client: PocketMoneyClient, now: Date): Promise<{ deposited: number } | { error: string }> {
  const dow = now.getUTCDay();

  const { data: accounts, error } = await client
    .from("pocket_money_accounts")
    .select("id, family_id, weekly_allowance_cents, allowance_interval_days, last_allowance_at")
    .eq("allowance_day_of_week", dow)
    .gt("weekly_allowance_cents", 0);

  if (error) {
    console.error("[cron/process-allowance] read error:", error);
    return { error: error.message };
  }

  let deposited = 0;
  for (const acct of accounts ?? []) {
    // The interval is the cadence the parent set (7=weekly, 14=biweekly,
    // etc.). The dedup window is (interval - 1) days — caps the cadence
    // at one pay per period, with a −1 day buffer for off-by-an-hour
    // cron re-fires.
    //
    // Schedule-change re-anchor: when the parent changes
    // allowance_day_of_week, the last pay's UTC day-of-week no longer
    // matches today's (today's is the configured day; the last pay was
    // on the previous schedule). In that case, ignore the interval
    // window — pay now and re-anchor `last_allowance_at` to the new
    // schedule. Without this, a kid loses up to (interval - 1) days of
    // allowance whenever the parent retunes the day.
    const intervalDays = acct.allowance_interval_days ?? 7;
    const minIntervalMs = (intervalDays - 1) * ONE_DAY_MS;
    if (acct.last_allowance_at) {
      const lastAt = new Date(acct.last_allowance_at);
      const lastDow = lastAt.getUTCDay();
      const elapsedMs = now.getTime() - lastAt.getTime();
      const sameDow = lastDow === dow;
      // Only enforce the interval window when the schedule hasn't
      // shifted. A different DOW from the last pay means the parent
      // retuned the cadence — honor the new day immediately.
      if (sameDow && elapsedMs < minIntervalMs) {
        continue; // already paid this period at the same DOW
      }
    }

    // Paid and marked paid in one transaction (pay_pocket_money_allowance):
    // the period is claimed only if last_allowance_at still holds what was
    // read above, and the allowance is booked as a delta in the same call.
    // A failure undoes both, so a retry never pays twice, and a booking made
    // at the same moment is never overwritten.
    const { data: paid, error: payErr } = await client.rpc("pay_pocket_money_allowance", {
      p_account_id: acct.id,
      p_amount_cents: acct.weekly_allowance_cents,
      p_note: intervalDays === 7 ? "Weekly allowance" : `Allowance (every ${intervalDays} days)`,
      p_expected_last: acct.last_allowance_at ?? null,
    });
    if (payErr) {
      console.error("[cron/process-allowance] payment error:", payErr.message);
      continue;
    }
    if ((paid as { ok?: unknown } | null)?.ok !== true) continue; // another run paid this period
    deposited++;
  }

  return { deposited };
}

/** Move pending interest into the balance, at most once per ~24 hours per account. */
export async function commitInterest(client: PocketMoneyClient, now: Date): Promise<{ committed: number } | { error: string }> {
  // Commit interest *daily* — cron fires hourly, but the per-account
  // 23h dedup guard below restricts to one commit per ~24h window.
  // The legacy `interest_committed_day_of_week` column stays on the
  // table for backwards-compat but is no longer consulted; weekly
  // commits felt like "interest is broken" to parents because accrued
  // cents sat invisible in pending_interest_cents for up to 6 days
  // before showing up in the balance the kid sees.
  const { data: accounts, error } = await client
    .from("pocket_money_accounts")
    .select("id, pending_interest_cents")
    .gt("pending_interest_cents", 0);

  if (error) {
    console.error("[cron/commit-interest] read error:", error);
    return { error: error.message };
  }

  // 23h window — slightly less than a day so an off-by-an-hour re-fire
  // on the same UTC day doesn't double-commit, but the *next* day's
  // run is allowed through.
  const recentSinceIso = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();

  let committed = 0;
  for (const acct of accounts ?? []) {
    const amount = acct.pending_interest_cents;
    if (amount <= 0) continue;

    // At most one commit per ~24h. (The commit itself is one transaction
    // now, so a half-finished earlier run can no longer be what trips this;
    // it stays as the once-a-day limit it also always was.)
    const { count: recentTxnCount } = await client
      .from("pocket_money_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acct.id)
      .eq("type", "interest")
      .gte("created_at", recentSinceIso);
    if ((recentTxnCount ?? 0) > 0) {
      console.warn(
        `[cron/commit-interest] account ${acct.id} has an interest txn in the last 23h — skipping until tomorrow`,
      );
      continue;
    }

    // The amount is read afresh under the account's row lock and booked as
    // a delta, then exactly that much is taken off pending — all in
    // commit_pocket_money_interest(). The `amount` read above only decides
    // whether to try; a booking or an accrual alongside keeps its part.
    const result = await commitPendingInterest(client, acct.id, "Daily interest");
    if (!result.ok) {
      if (result.error === "failed") console.error("[cron/commit-interest] commit error:", result.message);
      else if (result.error !== "nothing_pending") console.error("[cron/commit-interest] commit refused:", result.error);
      continue;
    }
    committed++;
  }

  return { committed };
}

/** Accrue one day's interest into pending, once per UTC date. */
export async function accrueInterest(
  client: PocketMoneyClient, now: Date,
): Promise<{ updated: number; processed: number } | { error: string }> {
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC

  const { data: accounts, error } = await client
    .from("pocket_money_accounts")
    .select("id, balance_cents, max_balance_eligible_cents, apr_bps, pending_interest_cents, pending_interest_micros, last_accrued_date");

  if (error) {
    console.error("[cron/accrue-interest] read error:", error);
    return { error: error.message };
  }

  let updated = 0;
  for (const acct of accounts ?? []) {
    if (acct.last_accrued_date === today) continue; // already done
    // Carry the sub-cent fraction instead of flooring it away each day.
    // Flooring meant any balance under ~EUR 36.50 accrued nothing at all,
    // ever — see migration_pocket_money_interest_carry.sql.
    const { addCents, carryMicros } = applyDailyAccrual({
      balanceCents: acct.balance_cents,
      maxBalanceEligibleCents: acct.max_balance_eligible_cents,
      aprBps: acct.apr_bps,
      carryMicros: acct.pending_interest_micros ?? 0,
    });
    // Added to pending as a delta, once for `today`, by
    // accrue_pocket_money_interest() — never written back as an absolute
    // value read above, which would undo a commit that ran in between.
    const accrued = await accruePendingInterest(client, {
      accountId: acct.id, addCents, carryMicros, today,
    });
    if (!accrued.ok) {
      console.error("[cron/accrue-interest] update error:", accrued.message);
      continue;
    }
    if (!accrued.accrued) continue; // another run accrued today meanwhile
    updated++;
  }

  return { updated, processed: accounts?.length ?? 0 };
}

export interface WithdrawalDecision {
  familyId: string;
  requestId: string;
  decision: "approved" | "denied";
  personId: string | null;
}

/**
 * Decide a withdrawal request in one transaction
 * (`decide_pocket_money_withdrawal()`), answered as the route always has:
 * 200 `{ ok: true }`; 404 not found; 409 `already_decided`; 409
 * `insufficient_funds_at_decide_time` (the request is then denied); 400 for a
 * goal that is not on the account or a decider who is not in the family.
 */
export async function decideWithdrawal(
  client: RpcClient, input: WithdrawalDecision,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await client.rpc("decide_pocket_money_withdrawal", {
    p_family_id: input.familyId,
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_person_id: input.personId,
  });
  if (error) return { status: 500, body: { error: error.message } };
  const answer = data as { ok?: unknown; error?: unknown } | null;
  if (answer?.ok === true) return { status: 200, body: { ok: true } };
  switch (answer?.error) {
    case "not_found": return { status: 404, body: { error: "not found" } };
    case "already_decided": return { status: 409, body: { error: "already_decided" } };
    case "insufficient_funds": return { status: 409, body: { error: "insufficient_funds_at_decide_time" } };
    case "invalid_goal": return { status: 400, body: { error: "the request's goal is not one of this account's goals" } };
    case "invalid_person": return { status: 400, body: { error: "parent_decided_by_person_id is not a person of this family" } };
    default: return { status: 500, body: { error: "unexpected answer from decide_pocket_money_withdrawal" } };
  }
}
