import { NextRequest, NextResponse } from "next/server";
import { syncFamilyIcsCalendars } from "@/lib/ics-sync";

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
 * Auth model: family_id from the body. Same shape every other family-
 * scoped POST endpoint uses (e.g. /api/google/sync, /api/vehicles).
 * Row-Level Security is disabled; the device-cookie + join-code model
 * is the actual boundary (per CLAUDE.md). A device can only know its
 * family_id after joining, so passing it explicitly is sufficient.
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
