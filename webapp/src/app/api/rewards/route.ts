import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { parseReward } from "@/lib/pocket-money/rewards";

export const dynamic = "force-dynamic";

/**
 * POST /api/rewards -- a reward for the family's catalogue (discussion #349;
 * core since RFC-017, no pocket money needed). The family is the session's;
 * the catalogue is a parent's to keep, so this needs the settings PIN, like
 * the rest of Settings. Screens read the catalogue straight from
 * point_rewards (family-scoped RLS).
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseReward(body ?? {}, false);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await (createAdminClient() as any)
    .from("point_rewards")
    .insert({ ...parsed.fields, family_id: auth.session.familyId })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reward: data }, { status: 201 });
}
