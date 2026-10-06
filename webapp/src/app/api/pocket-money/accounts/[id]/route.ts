import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyAccountUpdate } from "@/types/database";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { parseCreaturePatch } from "@/lib/creatures/rules";
import { applyCreaturePatch } from "@/lib/creatures/server";

export const dynamic = "force-dynamic";

/**
 * The money settings, every one a parent's: allowance, interest, currency.
 * The PIN check is per-field so that a body naming none of them -- nothing
 * left to write -- answers 400, not 403.
 */
const PIN_PROTECTED_FIELDS = [
  "currency",
  "apr_bps",
  "weekly_allowance_cents",
  "allowance_day_of_week",
  "allowance_interval_days",
  "max_balance_eligible_cents",
  "interest_committed_day_of_week",
] as const;

/**
 * The creature's fields, which lived on the account until RFC-017 and are now
 * on `creatures`, written through /api/creatures/[personId].
 *
 * REMOVE in the release after RFC-017 step 1. For one release this PATCH
 * still takes them and forwards them to the account's child's creature, under
 * the creature's own rules (applyCreaturePatch): the species and what it
 * grows with need the settings PIN, the style, the look and the stages do
 * not, and the stages are held to what the growth source justifies. That
 * keeps a screen still running the previous bundle working until it reloads.
 * The account columns themselves are never written again.
 */
const MOVED_TO_CREATURES: Record<string, string> = {
  avatar_species: "species",
  avatar_style: "style",
  avatar_look: "look",
  best_tier: "best_tier",
  last_seen_tier: "last_seen_tier",
  reward_mode: "grows_with",
};

// GET /api/pocket-money/accounts/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  // RLS is off, so this filter is the whole boundary — see lib/family-scope.
  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
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

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  // A body that is not JSON, or is JSON but not an object (null, a number,
  // an array), is the caller's mistake: 400, not the 500 a throw from
  // request.json() or a property read on null used to give.
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const body = parsed as Partial<PocketMoneyAccountUpdate> & { family_id?: string };

  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // The creature's fields, renamed to the creature's own and checked by its
  // rules before anything is written.
  const creatureBody: Record<string, unknown> = {};
  for (const [old, now] of Object.entries(MOVED_TO_CREATURES)) {
    const value = (body as Record<string, unknown>)[old];
    if (value !== undefined) creatureBody[now] = value;
  }
  const creature = Object.keys(creatureBody).length > 0 ? parseCreaturePatch(creatureBody) : null;
  if (creature && !creature.ok) {
    return NextResponse.json({ error: creature.error }, { status: 400 });
  }

  // One PIN check for the whole body, before either half is written.
  if (PIN_PROTECTED_FIELDS.some((field) => body[field] !== undefined) || (creature?.ok && creature.parental)) {
    const locked = await requireSettingsUnlock(auth.session);
    if (locked) return locked;
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
  if (Object.keys(update).length === 0 && !creature) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const supabase = createAdminClient() as any;
  if (creature?.ok) {
    const { data: acct, error: acctErr } = await supabase
      .from("pocket_money_accounts")
      .select("person_id")
      .eq("id", id)
      .eq("family_id", familyId)
      .maybeSingle();
    if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
    if (!acct) return NextResponse.json({ error: "not found" }, { status: 404 });
    const written = await applyCreaturePatch({
      db: supabase,
      session: auth.session,
      familyId,
      personId: acct.person_id,
      patch: creature.patch,
      parental: creature.parental,
      pinChecked: true,
    });
    if (written.status !== 200) return NextResponse.json(written.body, { status: written.status });
  }

  const { data, error } = Object.keys(update).length > 0
    ? await supabase
        .from("pocket_money_accounts")
        .update(update)
        .eq("id", id)
        .eq("family_id", familyId)
        .select()
        .maybeSingle()
    : await supabase
        .from("pocket_money_accounts")
        .select("*")
        .eq("id", id)
        .eq("family_id", familyId)
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

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const supabase = createAdminClient();

  const { error } = await (supabase as any)
    .from("pocket_money_accounts")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
