import { NextRequest, NextResponse } from "next/server";
import { syncFamilyIcsCalendars } from "@/lib/ics-sync";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// Same Node-runtime + dynamic constraints as the cron path — node-ical's
// transitive deps don't survive Next's static prerender.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * User-triggered "Sync now" for a single family's ICS calendars.
 * Called from the /settings/ics manual-sync button. The cron-driven
 * cross-family equivalent lives at /api/cron/sync-ics (auth via
 * CRON_SECRET); both share the same `syncIcsCalendar` helper so the
 * upsert/delete behaviour can't drift.
 *
 * Auth model: a device session, and family_id has to be the session's. The
 * old note here said "a device can only know its family_id after joining, so
 * passing it explicitly is sufficient" — which was never true. The id is in
 * localStorage and in the query string of most requests; knowing one proves
 * nothing about having joined.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const familyId = (body as Record<string, unknown>)?.family_id;
  if (typeof familyId !== "string" || !familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    const result = await syncFamilyIcsCalendars(familyId);
    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    console.error("[sync-ics:user] Failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
