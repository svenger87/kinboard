import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const dow = new Date().getUTCDay(); // 0=Sun..6=Sat

  const { data: accounts, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .select("id, pending_interest_cents, balance_cents, lifetime_saved_cents")
    .eq("interest_committed_day_of_week", dow)
    .gt("pending_interest_cents", 0);

  if (error) {
    console.error("[cron/commit-interest] read error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 23h window — slightly less than a day so an off-by-an-hour re-fire
  // on the same UTC day doesn't slip past, but a true weekly re-run
  // (next Sunday) is allowed.
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

    const { error: txnErr } = await (supabase as any)
      .from("pocket_money_transactions")
      .insert({
        account_id: acct.id,
        amount_cents: amount,
        type: "interest",
        note: "Weekly interest",
      });
    if (txnErr) {
      console.error("[cron/commit-interest] txn error:", txnErr);
      continue;
    }

    const { error: updErr } = await (supabase as any)
      .from("pocket_money_accounts")
      .update({
        balance_cents: acct.balance_cents + amount,
        lifetime_saved_cents: acct.lifetime_saved_cents + amount,
        pending_interest_cents: 0,
        interest_committed_at: new Date().toISOString(),
      })
      .eq("id", acct.id);
    if (updErr) {
      console.error("[cron/commit-interest] update error:", updErr);
      continue;
    }
    committed++;
  }

  return NextResponse.json({ ok: true, committed });
}
