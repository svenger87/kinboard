import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { deleteTimer, dismissTimer } from "@/lib/timers";

export const dynamic = "force-dynamic";

/** Dismiss: the timer stops being shown, but the row stays. */
export async function PATCH(
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

  // Cancels the queued push, then stamps dismissed_at (lib/timers.ts).
  const { data, error } = await dismissTimer(supabase, familyId, id);

  if (error) {
    console.error("[timers] dismiss error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ timer: data });
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
  if (!(await rowInFamily(supabase, "timers", id, familyId))) {
    return NextResponse.json({ error: "no such timer" }, { status: 404 });
  }

  const { error } = await deleteTimer(supabase, familyId, id);
  if (error) {
    console.error("[timers] delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
