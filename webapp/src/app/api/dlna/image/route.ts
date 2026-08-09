import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { assertDlnaUrl, browseItemMetadata, reachableMediaUrl } from "@/lib/dlna-client";
import { readDlnaSettings } from "@/lib/dlna-settings";

/**
 * Proxy one image off the family's DLNA server.
 *
 * The browser names the photo by its **object id** — the identifier the media
 * server itself gave it — and never by URL. This route then asks that server
 * to describe the object, and fetches whatever address comes back.
 *
 * That ordering is the point. An earlier version took the full URL as a query
 * parameter and defended it: a session, a family check, an HMAC over the URL,
 * and finally a host pinned to the configured server. All of it worked, and all
 * of it was arguing about an address that had still arrived from outside. Here
 * the address is only ever something this family's own server said in reply to
 * a question about its own catalogue, so there is nothing to forge and nothing
 * to sign.
 *
 * Images are proxied rather than linked because a DLNA server speaks plain
 * HTTP, and a wall display served over HTTPS will silently refuse to load an
 * HTTP image.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const familyId = params.get("family_id");
  const objectId = params.get("object_id");
  // Servers publish a smaller rendition for some photos; the grid asks for it
  // by name rather than by URL, for the same reason as everything else here.
  const wantThumbnail = params.get("thumb") === "1";

  if (!familyId || !objectId) {
    return NextResponse.json(
      { error: "family_id and object_id are required" },
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

  try {
    const item = await browseItemMetadata(settings.control_url, objectId);
    if (!item) {
      return NextResponse.json({ error: "no such item" }, { status: 404 });
    }

    const chosen = wantThumbnail ? (item.thumbnailUrl ?? item.url) : item.url;
    if (!chosen) {
      return NextResponse.json({ error: "no such item" }, { status: 404 });
    }

    // Still normalised: a server that advertises an address it is not
    // reachable on describes its objects with that same address.
    const target = assertDlnaUrl(reachableMediaUrl(chosen, settings.control_url));

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
