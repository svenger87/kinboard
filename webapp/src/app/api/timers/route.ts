import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { listActiveTimers, startTimer } from "@/lib/timers";

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

  const { data, error } = await listActiveTimers(createAdminClient(), familyId);

  if (error) {
    console.error("[timers] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ timers: data ?? [] });
}

/**
 * Start a timer, and queue the push that announces its end
 * (`startTimer`, lib/timers.ts).
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

  // The insert and the push that announces the end live in lib/timers.ts,
  // shared with the Integration API.
  const { timer, error } = await startTimer(
    createAdminClient(),
    familyId,
    body.label?.trim() || null,
    Math.round(duration),
  );

  if (error || !timer) {
    console.error("[timers] create error:", error);
    return NextResponse.json({ error: error?.message ?? "could not start" }, { status: 500 });
  }

  return NextResponse.json({ timer });
}
