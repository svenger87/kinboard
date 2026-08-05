import { NextRequest, NextResponse } from "next/server";
import { syncFamilyCaldavCalendars } from "@/lib/caldav-sync";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * User-triggered "Sync now" for a single family's CalDAV calendars,
 * called from the /settings/caldav button. The cron-driven cross-family
 * equivalent lives at /api/cron/sync-caldav (auth via CRON_SECRET); both
 * share `syncCaldavCalendar` so their behaviour can't drift.
 *
 * Auth model matches /api/calendar/sync-ics: a device session for the
 * family named in the body.
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
    const result = await syncFamilyCaldavCalendars(familyId);
    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    console.error("[sync-caldav:user] Failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
