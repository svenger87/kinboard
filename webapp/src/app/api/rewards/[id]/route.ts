import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { parseReward } from "@/lib/pocket-money/rewards";
import { UUID } from "@/lib/home/action-requests";

export const dynamic = "force-dynamic";

/** PATCH /api/rewards/[id] -- edit a reward; needs the settings PIN. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  // An icon sent along is checked against the emoji set -- unless it is the
  // one the reward already has, which may predate the picker.
  let storedIcon: string | null = null;
  if (typeof body?.icon === "string") {
    const { data: current } = await (createAdminClient() as any)
      .from("point_rewards")
      .select("icon")
      .eq("id", id)
      .eq("family_id", auth.session.familyId)
      .maybeSingle();
    storedIcon = (current?.icon as string | null | undefined) ?? null;
  }
  const parsed = parseReward(body ?? {}, true, { storedIcon });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await (createAdminClient() as any)
    .from("point_rewards")
    .update(parsed.fields)
    .eq("id", id)
    .eq("family_id", auth.session.familyId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ reward: data });
}

/**
 * DELETE /api/rewards/[id] -- remove a reward; needs the settings
 * PIN. Requests already made keep their own copy of its title and cost.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data, error } = await (createAdminClient() as any)
    .from("point_rewards")
    .delete()
    .eq("id", id)
    .eq("family_id", auth.session.familyId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
