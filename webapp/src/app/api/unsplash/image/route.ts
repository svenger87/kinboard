import { NextResponse } from "next/server";

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
 *  - a family_id must be present, which the only caller has always sent.
 *
 * A host allowlist rather than safeFetch (src/lib/safe-fetch.ts) on purpose:
 * safeFetch exists for URLs a household types in, where the destination is
 * unknown and only the address family can be judged. Here the destination is
 * known exactly, and naming it is a far tighter control than proving an
 * address is public.
 */
const ALLOWED_HOSTS = new Set([
  "images.unsplash.com",
  "plus.unsplash.com",
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const photoUrl = searchParams.get("photo_url");
  const familyId = searchParams.get("family_id");

  if (!photoUrl || !familyId) {
    return NextResponse.json(
      { error: "family_id and photo_url are required" },
      { status: 400 },
    );
  }

  let target: URL;
  try {
    target = new URL(photoUrl);
  } catch {
    return NextResponse.json({ error: "photo_url is not a URL" }, { status: 400 });
  }

  // https only — an http URL to an allowed host could still be intercepted,
  // and Unsplash serves everything over TLS anyway.
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return NextResponse.json({ error: "photo_url is not an Unsplash image" }, { status: 400 });
  }

  try {
    const res = await fetch(target.href, {
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
