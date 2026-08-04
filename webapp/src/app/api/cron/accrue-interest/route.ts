import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { applyDailyAccrual } from "@/lib/pocket-money/interest";

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
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  const { data: accounts, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .select("id, balance_cents, max_balance_eligible_cents, apr_bps, pending_interest_cents, pending_interest_micros, last_accrued_date");

  if (error) {
    console.error("[cron/accrue-interest] read error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
    const { error: updErr } = await (supabase as any)
      .from("pocket_money_accounts")
      .update({
        pending_interest_cents: acct.pending_interest_cents + addCents,
        pending_interest_micros: carryMicros,
        last_accrued_date: today,
      })
      .eq("id", acct.id);
    if (updErr) {
      console.error("[cron/accrue-interest] update error:", updErr);
      continue;
    }
    updated++;
  }

  return NextResponse.json({ ok: true, updated, processed: accounts?.length ?? 0 });
}
