import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { assertDlnaUrl } from "@/lib/dlna-client";
import { readDlnaSettings, verifyImageUrl } from "@/lib/dlna-settings";

/**
 * Proxy one image off the family's DLNA server.
 *
 * The `item` parameter is a full URL, which makes this shaped like an open
 * proxy — so it carries a signature. Only a URL this family's own browse
 * produced can be fetched back through here.
 *
 * An earlier version pinned the host to the configured server instead, and a
 * real MiniDLNA broke it: media servers advertise whichever address they
 * detected for themselves, which is routinely not the one you reached them on.
 * The signature does not care how many addresses the server answers to.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const familyId = params.get("family_id");
  const item = params.get("item");
  const signature = params.get("sig");

  if (!familyId || !item || !signature) {
    return NextResponse.json(
      { error: "family_id, item and sig are required" },
      { status: 400 },
    );
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const settings = await readDlnaSettings(familyId);
  if (!settings?.control_url) {
    return NextResponse.json({ error: "DLNA is not configured" }, { status: 400 });
  }

  if (!verifyImageUrl(familyId, item, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }

  let target: URL;
  try {
    target = assertDlnaUrl(item);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
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
