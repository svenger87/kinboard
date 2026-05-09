import { NextRequest, NextResponse } from "next/server";
import { fetchIcsCalendar } from "@/lib/ics-fetcher";

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
