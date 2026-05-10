import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyAccountUpdate } from "@/types/database";

export const dynamic = "force-dynamic";

// GET /api/pocket-money/accounts/[id]
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: data });
}

// PATCH /api/pocket-money/accounts/[id]  body: Partial<PocketMoneyAccountUpdate>
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as Partial<PocketMoneyAccountUpdate>;

  // Whitelist editable fields. balance_cents, lifetime_saved_cents,
  // pending_interest_cents etc. are driven by transactions/cron — not settable here.
  const update: PocketMoneyAccountUpdate = {};
  if (body.currency !== undefined) update.currency = body.currency;
  if (body.apr_bps !== undefined) update.apr_bps = body.apr_bps;
  if (body.weekly_allowance_cents !== undefined) update.weekly_allowance_cents = body.weekly_allowance_cents;
  if (body.allowance_day_of_week !== undefined) update.allowance_day_of_week = body.allowance_day_of_week;
  if (body.allowance_interval_days !== undefined) update.allowance_interval_days = body.allowance_interval_days;
  if (body.max_balance_eligible_cents !== undefined) update.max_balance_eligible_cents = body.max_balance_eligible_cents;
  if (body.interest_committed_day_of_week !== undefined) update.interest_committed_day_of_week = body.interest_committed_day_of_week;
  if (body.avatar_species !== undefined) update.avatar_species = body.avatar_species;
  if (body.last_seen_tier !== undefined) update.last_seen_tier = body.last_seen_tier;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: data });
}

// DELETE /api/pocket-money/accounts/[id]
export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await (supabase as any)
    .from("pocket_money_accounts")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
