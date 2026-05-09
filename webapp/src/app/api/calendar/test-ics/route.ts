import { NextRequest, NextResponse } from "next/server";
import { fetchIcsCalendar } from "@/lib/ics-fetcher";

// Force Node.js runtime + dynamic — node-ical's transitive deps (http,
// https, fs) are Node-only and Next's static page-data collector fails
// to bundle them for prerender. Without these, `next build` errors with
// "Failed to collect page data for /api/calendar/test-ics".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
