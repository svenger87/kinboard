import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { MediaPlayerInsert } from "@/types/database";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { familyIdFrom } from "@/lib/family-scope";

export const dynamic = "force-dynamic";

// GET /api/media-players?family_id=X
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("media_players")
    .select("*")
    .eq("family_id", familyId)
    .order("position", { ascending: true });

  if (error) {
    console.error("[media-players] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ players: data ?? [] });
}

// POST /api/media-players  body: MediaPlayerInsert
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Partial<MediaPlayerInsert>;
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (!body.nickname || !body.driver) {
    return NextResponse.json(
      { error: "nickname and driver are required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("media_players")
    .insert({
      family_id: familyId,
      driver: body.driver,
      nickname: body.nickname,
      position: body.position ?? 0,
      config: body.config ?? {},
    })
    .select()
    .single();

  if (error) {
    console.error("[media-players] create error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ player: data });
}
