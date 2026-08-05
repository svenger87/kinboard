import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

/**
 * Proxy for Unsplash photos, so the browser never talks to Unsplash directly
 * and the access key stays server-side.
 *
 * This route used to fetch whatever URL it was handed. No host check, no
 * family check, no authentication — and it returned the response body
 * verbatim. Anything that could reach a Kinboard instance could use it to
 * fetch arbitrary URLs from inside the network and read the result: other
 * containers, the Supabase gateway, a router's admin page, a cloud metadata
 * endpoint. Pointing it at the app's own origin returned the dashboard's HTML
 * with a 200.
 *
 * Two controls now, either of which would close it:
 *
 *  - the host must be one Unsplash actually serves images from, which is the
 *    entire legitimate use of this endpoint; and
 *  - a family_id must be present, and it must be the session's. "Present"
 *    was the whole test before, which any caller could satisfy.
 *
 * A host allowlist rather than safeFetch (src/lib/safe-fetch.ts) on purpose:
 * safeFetch exists for URLs a household types in, where the destination is
 * unknown and only the address family can be judged. Here the destination is
 * known exactly, and naming it is a far tighter control than proving an
 * address is public.
 */
const ALLOWED_HOSTS = ["images.unsplash.com", "plus.unsplash.com"] as const;

// The screensaver renders these as <img src>, a same-origin subresource, so
// the session cookie rides along with the request the same as any fetch.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const photoUrl = searchParams.get("photo_url");
  const familyId = searchParams.get("family_id");

  if (!photoUrl || !familyId) {
    return NextResponse.json(
      { error: "family_id and photo_url are required" },
      { status: 400 },
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let target: URL;
  try {
    target = new URL(photoUrl);
  } catch {
    return NextResponse.json({ error: "photo_url is not a URL" }, { status: 400 });
  }

  // https only — an http URL to an allowed host could still be intercepted,
  // and Unsplash serves everything over TLS anyway.
  //
  // The host is taken *from the allowlist*, not from the parsed URL, and the
  // request below is rebuilt around it. So the address fetched is always one
  // of the two literals above: the caller chooses which, and the path, and
  // nothing else. Comparing and then reusing the caller's own URL would be
  // equivalent in practice, but this way the destination host is a constant
  // by construction rather than by argument.
  const host = ALLOWED_HOSTS.find((allowed) => allowed === target.hostname);
  if (target.protocol !== "https:" || !host) {
    return NextResponse.json({ error: "photo_url is not an Unsplash image" }, { status: 400 });
  }

  const upstream = new URL(`https://${host}`);
  upstream.pathname = target.pathname;
  upstream.search = target.search;

  try {
    const res = await fetch(upstream.href, {
      // A hung CDN shouldn't hold a connection open indefinitely.
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });

    // Don't follow redirects: a 302 off the allowlisted host would walk
    // straight back out of the control above.
    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json({ error: "unexpected redirect" }, { status: 502 });
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${res.status}` },
        { status: res.status },
      );
    }

    // Return an image or nothing — never pass a foreign content type through.
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "not an image" }, { status: 502 });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to proxy image", details: String(err) },
      { status: 500 },
    );
  }
}
