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
 * It also pins the host to the configured server. An earlier attempt at that
 * alone was broken by a real MiniDLNA — media servers advertise whichever
 * address they detected for themselves, routinely not the one you reached them
 * on — but `reachableMediaUrl` now rewrites every media URL to the host that
 * answered the browse before it is signed, so by this point the two always
 * agree. Signature and host together mean a signed URL cannot be replayed
 * against anything but the server this family configured: without the pin, a
 * member who can set that address could point the server at, say, a cloud
 * metadata endpoint and have Kinboard fetch it for them.
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
    // The allowlist is one entry long and it comes from the family's own
    // settings, not from this request.
    const server = new URL(settings.control_url);
    if (target.hostname !== server.hostname) {
      return NextResponse.json({ error: "bad url" }, { status: 400 });
    }
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
