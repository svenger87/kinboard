import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { MAX_MESSAGE_BODY, parseMessageText, sendFamilyMessage } from "@/lib/family-messages";

export const dynamic = "force-dynamic";

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
 * The insert and the push live in `lib/family-messages.ts`'s
 * `sendFamilyMessage`, shared with the Integration API route an assistant's
 * `send_message` tool calls (RFC-011 task 6) — this route's own job is just
 * the session boundary and the request shape a person's browser sends.
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

  const parsed = parseMessageText(payload.body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: `body must be 1-${MAX_MESSAGE_BODY} characters` },
      { status: 400 },
    );
  }

  // The sender comes from the session, never from the request. A caller who
  // could name the sender could name somebody else's device and quietly
  // exclude that person from every message the household sends. RFC-005 §3.1.
  const senderDeviceId = auth.session.deviceId;

  const result = await sendFamilyMessage({ familyId, body: parsed.value!, senderDeviceId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ message: result.message });
}
