import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { MediaPlayerInsert, MediaPlayerUpdate } from "@/types/database";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";

export const dynamic = "force-dynamic";

/** Both verbs scope the write by family_id as well as id, so knowing a row's
 *  uuid is not enough to change another household's player. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await request.json()) as Partial<MediaPlayerInsert>;
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  if (!(await rowInFamily(supabase, "media_players", id, familyId))) {
    // Same 404 for "not yours" as for "doesn't exist", so ids can't be
    // enumerated by watching the status code.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updates: MediaPlayerUpdate = {};
  if (body.nickname !== undefined) updates.nickname = body.nickname;
  if (body.position !== undefined) updates.position = body.position;
  if (body.config !== undefined) updates.config = body.config;

  const { data, error } = await supabase
    .from("media_players")
    .update(updates)
    .eq("id", id)
    .eq("family_id", familyId)
    .select()
    .single();

  if (error) {
    console.error("[media-players] update error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ player: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  if (!(await rowInFamily(supabase, "media_players", id, familyId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("media_players")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId);

  if (error) {
    console.error("[media-players] delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
