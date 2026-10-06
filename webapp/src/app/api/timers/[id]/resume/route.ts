import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { resumeTimer } from "@/lib/timers";

export const dynamic = "force-dynamic";

/**
 * Resume a paused timer: it counts down again on every screen, and its phone
 * push is queued again for its new end (lib/timers.ts). 409 when it is not
 * paused.
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

  const { timer, error } = await resumeTimer(supabase, familyId, id);
  if (error) {
    console.error("[timers] resume error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!timer) {
    return NextResponse.json({ error: "the timer is not paused" }, { status: 409 });
  }
  return NextResponse.json({ timer });
}
