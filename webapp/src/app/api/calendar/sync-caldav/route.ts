import { NextRequest, NextResponse } from "next/server";
import { syncFamilyCaldavCalendars } from "@/lib/caldav-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * User-triggered "Sync now" for a single family's CalDAV calendars,
 * called from the /settings/caldav button. The cron-driven cross-family
 * equivalent lives at /api/cron/sync-caldav (auth via CRON_SECRET); both
 * share `syncCaldavCalendar` so their behaviour can't drift.
 *
 * Auth model matches /api/calendar/sync-ics: family_id from the body.
 */
export async function POST(request: NextRequest) {
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
