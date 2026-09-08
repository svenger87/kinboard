import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

/**
 * Cancel the queued push for a timer.
 *
 * Without this, stopping a timer early leaves its notification queued and the
 * phone buzzes for something that no longer exists. `related_entity_type` and
 * `related_entity_id` are exactly the handle for it.
 */
async function cancelScheduledPush(
  supabase: ReturnType<typeof createAdminClient>,
  familyId: string,
  timerId: string,
) {
  const { error } = await supabase
    .from("scheduled_notifications")
    .delete()
    .eq("family_id", familyId)
    .eq("related_entity_type", "timer")
    .eq("related_entity_id", timerId);
  if (error) console.error("[timers] could not cancel the push:", error);
}

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

  await cancelScheduledPush(supabase, familyId, id);

  const { data, error } = await supabase
    .from("timers")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("family_id", familyId)
    .select()
    .single();

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

  await cancelScheduledPush(supabase, familyId, id);

  const { error } = await supabase.from("timers").delete().eq("id", id).eq("family_id", familyId);
  if (error) {
    console.error("[timers] delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
