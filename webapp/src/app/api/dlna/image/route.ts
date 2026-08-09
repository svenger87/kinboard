import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { assertDlnaUrl } from "@/lib/dlna-client";
import { readDlnaSettings } from "@/lib/dlna-settings";

/**
 * Proxy one image off the family's DLNA server.
 *
 * The `item` parameter is a full URL, which makes this shaped like an open
 * proxy — so it is pinned to the host of the configured server. A caller
 * cannot point it somewhere else: the family must have DLNA configured, and
 * the requested URL must live on that same origin. That check is the reason
 * this route exists rather than the client fetching the media server directly.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const familyId = params.get("family_id");
  const item = params.get("item");

  if (!familyId || !item) {
    return NextResponse.json({ error: "family_id and item are required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const settings = await readDlnaSettings(familyId);
  if (!settings?.control_url) {
    return NextResponse.json({ error: "DLNA is not configured" }, { status: 400 });
  }

  let target: URL;
  let control: URL;
  try {
    target = assertDlnaUrl(item);
    control = assertDlnaUrl(settings.control_url);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }

  // Same host as the configured server, port included: a media server serves
  // its images from the same box that answered the SOAP call.
  if (target.host !== control.host) {
    return NextResponse.json({ error: "not this family's media server" }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), { signal: AbortSignal.timeout(20_000) });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "upstream error" }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    // Only images come back. A DLNA server will happily stream a 4 GB film
    // through the same URL shape, and this route is not that.
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "not an image" }, { status: 415 });
    }

    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": contentType,
        // The LAN server is the cache of record; a short private cache keeps
        // a slideshow from re-fetching the same frame on every transition.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("[dlna] image proxy failed:", e);
    return NextResponse.json({ error: "upstream unreachable" }, { status: 502 });
  }
}
