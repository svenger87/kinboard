import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { PocketMoneyAccountUpdate } from "@/types/database";
import avatarCatalog from "@/plugins/pocket-money/catalog/avatars.json";
import { familyIdFrom, rowInFamily, accountInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { isAvatarStyle } from "@/lib/pocket-money/creatures/styles";
import { validateLook } from "@/lib/pocket-money/creatures/look";

export const dynamic = "force-dynamic";

const VALID_SPECIES: ReadonlySet<string> = new Set(
  avatarCatalog.species.map((s) => s.id),
);

/**
 * This PATCH also carries the kid-side avatar fields: the stage tracking
 * (last_seen_tier, best_tier), written on every visit to /pocket-money, and
 * the avatar's look (avatar_style, avatar_look), which the child picks on their own page --
 * so a child's own device must reach them with no PIN. Everything else here is a
 * parental setting — allowance, interest, currency, the avatar species picked
 * at setup — so the PIN check is per-field, not on the route as a whole.
 */
const PIN_PROTECTED_FIELDS = [
  "currency",
  "apr_bps",
  "weekly_allowance_cents",
  "allowance_day_of_week",
  "allowance_interval_days",
  "max_balance_eligible_cents",
  "interest_committed_day_of_week",
  "avatar_species",
] as const;

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

  if (PIN_PROTECTED_FIELDS.some((field) => body[field] !== undefined)) {
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
  if (body.avatar_species !== undefined) {
    if (!VALID_SPECIES.has(body.avatar_species)) {
      return NextResponse.json(
        { error: `unknown avatar_species: ${body.avatar_species}` },
        { status: 400 },
      );
    }
    update.avatar_species = body.avatar_species;
  }
  // What the avatar grows with (discussion #349). A parent's choice, so it
  // takes the settings PIN even though the rest of this route does not: the
  // child's own screen writes last_seen_tier here.
  if (body.reward_mode !== undefined) {
    if (body.reward_mode !== "money" && body.reward_mode !== "points") {
      return NextResponse.json({ error: "reward_mode must be money or points" }, { status: 400 });
    }
    const locked = await requireSettingsUnlock(auth.session);
    if (locked) return locked;
    update.reward_mode = body.reward_mode;
  }
  // How the avatar is drawn. The child's own choice, made on their own page,
  // so no PIN -- like the stage tracking below. Only the four known values;
  // the database's CHECK says the same (migration_zzzzzzzz_pocket_money_avatar_style.sql).
  if (body.avatar_style !== undefined) {
    if (!isAvatarStyle(body.avatar_style)) {
      return NextResponse.json({ error: `unknown avatar_style: ${String(body.avatar_style)}` }, { status: 400 });
    }
    update.avatar_style = body.avatar_style;
  }
  // The child's own look for their creature: colours, pattern, eyes, an
  // accessory, a name (RFC-016 §4). No PIN, like the style. Only the editor's
  // fixed sets: unknown keys and values outside them are refused, not stored,
  // and the name is cleaned and cut to 16 characters (lib/.../look.ts). The
  // whole look is replaced; {} is the creature's own.
  if (body.avatar_look !== undefined) {
    const look = validateLook(body.avatar_look);
    if (!look.ok) return NextResponse.json({ error: look.error }, { status: 400 });
    update.avatar_look = look.look as PocketMoneyAccountUpdate["avatar_look"];
  }
  if (body.last_seen_tier !== undefined) update.last_seen_tier = body.last_seen_tier;
  // The avatar's high-water mark. Client-written because it's derived
  // from the balance (or, in points mode, the points) the client just
  // rendered; the route clamps it to a valid stage so a bad value can't push
  // the badge past stage 8, and the database never lets it go down
  // (pocket_money_accounts_best_tier_climbs).
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
