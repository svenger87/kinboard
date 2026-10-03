import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/camera-takeover?family_id=...
 *
 * The family's camera takeover (#335), for the screens: the row `show_camera`
 * wrote, or null once it has ended. Whether this screen is one of its
 * targets, and how much of it is left, the screen works out against the
 * server's clock (lib/camera-takeover.ts) — one row serves every screen.
 */
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

  const { data, error } = await (createAdminClient() as any)
    .from("camera_takeovers")
    .select("family_id, camera_id, device_ids, started_at, ends_at")
    .eq("family_id", familyId)
    .gt("ends_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("[camera-takeover] read error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ takeover: data ?? null });
}
