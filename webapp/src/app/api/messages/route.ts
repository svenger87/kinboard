import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { sendPushToMultiple, isVapidConfigured, type DatabaseSubscription } from "@/lib/push-sender";
import { getPushTranslator } from "@/lib/notifications/messages";
import { getFamilyLocale } from "@/lib/family-locale";

export const dynamic = "force-dynamic";

const MAX_BODY = 200;

/** Messages nobody has acknowledged yet, newest first. */
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
    .from("messages")
    .select("*")
    .eq("family_id", familyId)
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[messages] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ messages: data ?? [] });
}

/**
 * Say something to the house.
 *
 * The push goes out here rather than through `scheduled_notifications`. Every
 * other notification in Kinboard is a row that a processor picks up every 30
 * seconds, which is right for a reminder and wrong for somebody typing "back by
 * 6". `sendPushToMultiple` already exists, so this is a call, not new plumbing.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const payload = (await request.json()) as { family_id?: string; body?: string };

  const familyId = familyIdFrom(request, payload);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (body.length === 0 || body.length > MAX_BODY) {
    return NextResponse.json(
      { error: `body must be 1-${MAX_BODY} characters` },
      { status: 400 },
    );
  }

  // The sender comes from the session, never from the request. A caller who
  // could name the sender could name somebody else's device and quietly
  // exclude that person from every message the household sends. RFC-005 §3.1.
  const senderDeviceId = auth.session.deviceId;

  const supabase = createAdminClient();
  const { data: message, error } = await supabase
    .from("messages")
    .insert({ family_id: familyId, body, sender_device_id: senderDeviceId })
    .select()
    .single();

  if (error || !message) {
    console.error("[messages] create error:", error);
    return NextResponse.json({ error: error?.message ?? "could not send" }, { status: 500 });
  }

  await pushToEveryoneElse(supabase, familyId, senderDeviceId, message.id, body);

  return NextResponse.json({ message });
}

/**
 * Push to every device in the family except the one that sent it.
 *
 * Nothing in here may throw: the row is already written and every screen in the
 * house has it over realtime. The phones are the part that can be lost.
 *
 * Quiet hours are deliberately not consulted, and `notification_preferences` is
 * not read at all — RFC-005 §3.2. Every other push here is a reminder the
 * system chose to raise; this one is a person deciding, at that moment, to tell
 * the house something, and the messages sent at 23:00 are the ones that matter.
 */
async function pushToEveryoneElse(
  supabase: ReturnType<typeof createAdminClient>,
  familyId: string,
  senderDeviceId: string | null,
  messageId: string,
  body: string,
) {
  try {
    if (!isVapidConfigured()) return;

    let query = supabase
      .from("push_subscriptions")
      .select("*")
      .eq("family_id", familyId)
      .eq("is_active", true);
    // A session with no device id has nothing to exclude, so the push goes to
    // the whole family — including, harmlessly, the sender.
    if (senderDeviceId) query = query.neq("device_id", senderDeviceId);

    const { data: subs, error } = await query;
    if (error) {
      console.error("[messages] could not list subscriptions:", error);
      return;
    }
    if (!subs || subs.length === 0) return;

    const t = getPushTranslator(await getFamilyLocale(familyId));
    await sendPushToMultiple(subs as DatabaseSubscription[], {
      title: t("messageTitle"),
      body,
      // Per message, so a second message does not replace the first on a phone.
      tag: `message-${messageId}`,
      // sw.js already navigates to data.url on click — no service-worker change.
      url: `/?message=${messageId}`,
    });
  } catch (err) {
    console.error("[messages] push failed:", err);
  }
}
