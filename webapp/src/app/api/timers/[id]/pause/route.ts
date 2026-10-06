import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { pauseTimer } from "@/lib/timers";

export const dynamic = "force-dynamic";

/**
 * Pause a running timer: it stops counting on every screen, and its phone
 * push is cancelled until it is resumed (lib/timers.ts). 409 when it is not
 * running: already paused, ringing or dismissed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await request.json()) as { family_id?: string };
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  if (!(await rowInFamily(supabase, "timers", id, familyId))) {
    return NextResponse.json({ error: "no such timer" }, { status: 404 });
  }

  const { timer, error } = await pauseTimer(supabase, familyId, id);
  if (error) {
    console.error("[timers] pause error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!timer) {
    return NextResponse.json({ error: "the timer is not running" }, { status: 409 });
  }
  return NextResponse.json({ timer });
}
