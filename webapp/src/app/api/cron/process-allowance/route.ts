import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SIX_DAYS_MS = 6 * ONE_DAY_MS;

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const dow = new Date().getUTCDay();
  const now = Date.now();

  const { data: accounts, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .select("id, weekly_allowance_cents, balance_cents, lifetime_saved_cents, last_allowance_at")
    .eq("allowance_day_of_week", dow)
    .gt("weekly_allowance_cents", 0);

  if (error) {
    console.error("[cron/process-allowance] read error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let deposited = 0;
  for (const acct of accounts ?? []) {
    if (acct.last_allowance_at && now - new Date(acct.last_allowance_at).getTime() < SIX_DAYS_MS) {
      continue; // already paid this week
    }

    const { error: txnErr } = await (supabase as any)
      .from("pocket_money_transactions")
      .insert({
        account_id: acct.id,
        amount_cents: acct.weekly_allowance_cents,
        type: "allowance",
        note: "Weekly allowance",
      });
    if (txnErr) {
      console.error("[cron/process-allowance] txn error:", txnErr);
      continue;
    }

    const { error: updErr } = await (supabase as any)
      .from("pocket_money_accounts")
      .update({
        balance_cents: acct.balance_cents + acct.weekly_allowance_cents,
        lifetime_saved_cents: acct.lifetime_saved_cents + acct.weekly_allowance_cents,
        last_allowance_at: new Date().toISOString(),
      })
      .eq("id", acct.id);
    if (updErr) {
      // Without `last_allowance_at` written, the next hourly tick
      // re-fires for this account. Log loudly so the operator notices.
      console.error("[cron/process-allowance] update error (POSSIBLE DOUBLE-PAY ON RETRY):", updErr);
      continue;
    }
    deposited++;
  }

  return NextResponse.json({ ok: true, deposited });
}
