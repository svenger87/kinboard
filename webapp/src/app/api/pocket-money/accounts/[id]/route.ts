import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyAccountUpdate } from "@/types/database";
import avatarCatalog from "@/plugins/pocket-money/catalog/avatars.json";
import { familyIdFrom, rowInFamily, accountInFamily } from "@/lib/family-scope";

export const dynamic = "force-dynamic";

const VALID_SPECIES: ReadonlySet<string> = new Set(
  avatarCatalog.species.map((s) => s.id),
);

// GET /api/pocket-money/accounts/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // RLS is off, so this filter is the whole boundary — see lib/family-scope.
  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  const supabase = createAdminClient();

  const { data, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .select("*")
    .eq("id", id)
    .eq("family_id", familyId)
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
  const body = (await request.json()) as Partial<PocketMoneyAccountUpdate> & {
    family_id?: string;
  };

  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

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
  if (body.avatar_species !== undefined) {
    if (!VALID_SPECIES.has(body.avatar_species)) {
      return NextResponse.json(
        { error: `unknown avatar_species: ${body.avatar_species}` },
        { status: 400 },
      );
    }
    update.avatar_species = body.avatar_species;
  }
  if (body.last_seen_tier !== undefined) update.last_seen_tier = body.last_seen_tier;
  // The avatar's high-water mark. Client-written because it's derived
  // from the balance the client just rendered; the route clamps it to a
  // valid stage so a bad value can't push the badge past stage 8.
  if (body.best_tier !== undefined) {
    update.best_tier = Math.min(8, Math.max(1, Math.floor(Number(body.best_tier) || 1)));
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("pocket_money_accounts")
    .update(update)
    .eq("id", id)
    .eq("family_id", familyId)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: data });
}

// DELETE /api/pocket-money/accounts/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { error } = await (supabase as any)
    .from("pocket_money_accounts")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
