import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

/** Not-yet-dismissed timers, newest first. */
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
    .from("timers")
    .select("*")
    .eq("family_id", familyId)
    .is("dismissed_at", null)
    .order("started_at", { ascending: false });

  if (error) {
    console.error("[timers] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ timers: data ?? [] });
}

/**
 * Start a timer, and queue the push that announces its end.
 *
 * The push is a `scheduled_notifications` row rather than anything new: the
 * existing processor runs every 30 seconds and sends whatever is due. It is
 * tagged with `related_entity_type: "timer"` and the timer's id so that
 * cancelling can find and delete it — see the item route.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as {
    family_id?: string;
    label?: string | null;
    duration_seconds?: number;
  };

  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const duration = body.duration_seconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return NextResponse.json(
      { error: "duration_seconds must be a positive number" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data: timer, error } = await supabase
    .from("timers")
    .insert({
      family_id: familyId,
      label: body.label?.trim() || null,
      duration_seconds: Math.round(duration),
    })
    .select()
    .single();

  if (error || !timer) {
    console.error("[timers] create error:", error);
    return NextResponse.json({ error: error?.message ?? "could not start" }, { status: 500 });
  }

  // Queue the announcement. A failure here must not fail the timer itself —
  // the panel still counts down and still rings; only the phone push is lost.
  //
  // `title` is written in English because `scheduled_notifications.title` is
  // `NOT NULL` and nothing has resolved the recipient's locale yet at insert
  // time — it's a sensible fallback if it's ever read directly, not what
  // gets sent. The send side (process-notifications' `case "timer"`) renders
  // the real, locale-aware push through `getPushTranslator`, and needs the
  // label on its own rather than baked into a sentence, so it goes in `data`.
  const dueAt = new Date(Date.parse(timer.started_at) + timer.duration_seconds * 1000);
  const { error: notifyError } = await supabase.from("scheduled_notifications").insert({
    family_id: familyId,
    notification_type: "timer",
    scheduled_for: dueAt.toISOString(),
    title: timer.label ? `${timer.label} is ready` : "Timer finished",
    body: null,
    data: timer.label ? { label: timer.label } : null,
    related_entity_type: "timer",
    related_entity_id: timer.id,
  });
  if (notifyError) {
    console.error("[timers] could not schedule the push:", notifyError);
  }

  return NextResponse.json({ timer });
}
