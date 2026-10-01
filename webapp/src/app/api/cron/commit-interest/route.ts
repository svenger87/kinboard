import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { commitPendingInterest, type RpcClient } from "@/lib/pocket-money/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Commit interest *daily* — cron fires hourly, but the per-account
  // 23h dedup guard below restricts to one commit per ~24h window.
  // The legacy `interest_committed_day_of_week` column stays on the
  // table for backwards-compat but is no longer consulted; weekly
  // commits felt like "interest is broken" to parents because accrued
  // cents sat invisible in pending_interest_cents for up to 6 days
  // before showing up in the balance the kid sees.
  const { data: accounts, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .select("id, pending_interest_cents")
    .gt("pending_interest_cents", 0);

  if (error) {
    console.error("[cron/commit-interest] read error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 23h window — slightly less than a day so an off-by-an-hour re-fire
  // on the same UTC day doesn't double-commit, but the *next* day's
  // run is allowed through.
  const recentSinceIso = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();

  let committed = 0;
  for (const acct of accounts ?? []) {
    const amount = acct.pending_interest_cents;
    if (amount <= 0) continue;

    // Guard against double-commit if a previous run inserted the
    // transaction but the balance update failed before completing.
    // The retry would otherwise see pending_interest_cents still > 0
    // and insert a second interest transaction for the same period.
    const { count: recentTxnCount } = await (supabase as any)
      .from("pocket_money_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acct.id)
      .eq("type", "interest")
      .gte("created_at", recentSinceIso);
    if ((recentTxnCount ?? 0) > 0) {
      console.warn(
        `[cron/commit-interest] account ${acct.id} has a recent interest txn but pending > 0 — skipping; balance update likely failed last run`,
      );
      continue;
    }

    // The amount is read afresh under the account's row lock and booked as
    // a delta, then exactly that much is taken off pending — all in
    // commit_pocket_money_interest(). The `amount` read above only decides
    // whether to try; a booking or an accrual alongside keeps its part.
    const result = await commitPendingInterest(supabase as unknown as RpcClient, acct.id, "Daily interest");
    if (!result.ok) {
      if (result.error === "failed") console.error("[cron/commit-interest] commit error:", result.message);
      else if (result.error !== "nothing_pending") console.error("[cron/commit-interest] commit refused:", result.error);
      continue;
    }
    committed++;
  }

  return NextResponse.json({ ok: true, committed });
}
