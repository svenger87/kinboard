import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { parseCreaturePatch } from "@/lib/creatures/rules";
import { applyCreaturePatch } from "@/lib/creatures/server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/creatures/[personId] -- change a child's creature (RFC-017).
 *
 * Both sides call it, so the PIN check is per field (lib/creatures/rules.ts):
 *
 *   a parent, with the settings PIN: enabled (switching it off keeps it),
 *     species, grows_with, shop_enabled
 *   the child's own screen, no PIN: style and look, the child's own choice
 *     (RFC-016 §4), checked against the editor's sets exactly as #366 did;
 *     best_tier and last_seen_tier, the stage recorded on every visit
 *
 * One parental field in the body puts the whole write behind the PIN, so a
 * look sent along with a new species writes neither without it.
 *
 * grows_with 'money' only where it can work: the pocket-money plugin on and
 * the child with an account there (409 money_unavailable otherwise). The
 * stages a child's screen records are held to what the creature's growth
 * source justifies right now -- a screen cannot grow its own creature -- and
 * best_tier only ever climbs (creatures_best_tier_climbs). The kid-side fields
 * need the creature switched on. lib/creatures/server.ts, applyCreaturePatch.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseCreaturePatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (parsed.parental) {
    const locked = await requireSettingsUnlock(auth.session);
    if (locked) return locked;
  }
  if (!UUID.test(personId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await applyCreaturePatch({
    db: createAdminClient() as any,
    session: auth.session,
    familyId: auth.session.familyId,
    personId,
    patch: parsed.patch,
    parental: parsed.parental,
    // Checked above, before the person id was looked at.
    pinChecked: true,
  });
  return NextResponse.json(result.body, { status: result.status });
}
