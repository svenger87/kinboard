import { NextRequest, NextResponse } from "next/server";
import { syncAllCaldavCalendars } from "@/lib/caldav-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Sync every CalDAV-backed calendar across all families. Auth via
 * CRON_SECRET, scheduled by Ofelia (docker/ofelia.ini, job "sync-caldav")
 * on the same 30-minute cadence as the ICS job.
 *
 * The per-calendar work — and every write to the events table — lives in
 * lib/caldav-sync.ts, shared with the user-triggered
 * /api/calendar/sync-caldav.
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    console.error("[sync-caldav] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    console.warn("[sync-caldav] Unauthorized access attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[sync-caldav] Starting cross-family CalDAV sync");

  try {
    const { processed, succeeded, failed, results } = await syncAllCaldavCalendars();

    for (const result of results) {
      if (!result.success) {
        console.error(`[sync-caldav] Calendar ${result.calendarId}: ${result.error}`);
      }
    }

    console.log(`[sync-caldav] Done: ${succeeded} succeeded, ${failed} failed`);

    return NextResponse.json({
      processed,
      succeeded,
      failed,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    console.error("[sync-caldav] Failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
