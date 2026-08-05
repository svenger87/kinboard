import { NextRequest, NextResponse } from "next/server";
import { fetchIcsCalendar } from "@/lib/ics-fetcher";
import { requireSession } from "@/lib/require-session";

// Force Node.js runtime + dynamic — node-ical's transitive deps (http,
// https, fs) are Node-only and Next's static page-data collector fails
// to bundle them for prerender. Without these, `next build` errors with
// "Failed to collect page data for /api/calendar/test-ics".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No family_id — nothing here is family data — but it fetches whatever URL it
// is handed and reports what came back, which is an open request proxy if it
// takes no session at all. The ICS settings screen is the only caller, and it
// has one.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const url = (body as Record<string, unknown>)?.url;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ ok: false, error: "url is required" }, { status: 400 });
  }

  try {
    const result = await fetchIcsCalendar(url.trim());

    if (result.notModified) {
      return NextResponse.json({
        ok: true,
        eventCount: 0,
        firstEventTitle: null,
        note: "304 Not Modified — feed returned no events in this check",
      });
    }

    return NextResponse.json({
      ok: true,
      eventCount: result.events.length,
      firstEventTitle: result.events[0]?.title ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
