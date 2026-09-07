import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { getMergedSetting } from "@/lib/integration-secrets";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import type { HomeAssistantSettings } from "@/types/home-assistant";

export const dynamic = "force-dynamic";

/**
 * Fetch a player's artwork server-side.
 *
 * Home Assistant returns `entity_picture` as a path on the HA host that needs
 * the access token, which the browser does not have and must not be given. So
 * the server fetches it, with the household's token attached, and streams the
 * bytes back.
 *
 * `src` is validated twice, and the two checks are not redundant.
 *
 * The first is a cheap early rejection: anything that isn't `/single/slash`
 * shaped — an absolute URL, or a protocol-relative `//host/…` — is refused
 * before touching the DB or Home Assistant.
 *
 * The second, after resolving `new URL(src, ha.url)`, is the check that
 * actually holds: WHATWG URL parsing treats `\` as `/` for "special" schemes
 * (http/https among them) and silently strips embedded tab/newline
 * characters, so a string can pass the first check yet still resolve outside
 * `ha.url`'s origin — e.g. `/\evil.com/x` (no leading `//`, so it passes the
 * prefix check) resolves to `http://evil.com/x`, and `/\t/evil.com` does the
 * same via tab-stripping. Comparing the *resolved* URL's origin against Home
 * Assistant's origin closes that regardless of how the input is encoded. A
 * route that fetches whatever it is handed, with credentials, is an SSRF
 * hole — this is what keeps it from being one.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const familyId = familyIdFrom(request);
  const src = request.nextUrl.searchParams.get("src");

  if (!familyId || !src) {
    return NextResponse.json({ error: "family_id and src required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  // Cheap rejection: an absolute or protocol-relative src is refused before
  // any DB lookup or URL parsing happens at all.
  if (!src.startsWith("/") || src.startsWith("//")) {
    return NextResponse.json({ error: "src must be a path" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // This route runs on the service-role client, which bypasses RLS by
  // design (see family-scope.ts) — so even though RLS is enabled on
  // media_players, it does nothing here. This check is the only thing
  // stopping a caller who knows another family's player id from using
  // *this* family's Home Assistant token to fetch it.
  if (!(await rowInFamily(supabase, "media_players", id, familyId))) {
    // Same 404 for "not yours" as for "doesn't exist" — see rowInFamily.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // access_token is a secret field (see integration-secrets.ts SECRET_FIELDS)
  // stored out of the settings row and merged back in here — a plain
  // `settings` select would only ever see the redacted sentinel.
  const ha = await getMergedSetting<HomeAssistantSettings>(familyId, SETTINGS_KEYS.homeAssistant);
  if (!ha?.url || !ha.access_token) {
    return NextResponse.json({ error: "home assistant not configured" }, { status: 404 });
  }

  let target: URL;
  let haOrigin: string;
  try {
    haOrigin = new URL(ha.url).origin;
    target = new URL(src, ha.url);
  } catch {
    return NextResponse.json({ error: "src must be a path" }, { status: 400 });
  }
  // The authoritative guard — see the function comment for why the prefix
  // check above cannot stand alone.
  if (target.origin !== haOrigin) {
    return NextResponse.json({ error: "src must be a path" }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { Authorization: `Bearer ${ha.access_token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "artwork unavailable" }, { status: 502 });
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        // Artwork changes with the track, so this is short on purpose.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    console.error("[media-players] artwork fetch failed:", err);
    return NextResponse.json({ error: "artwork unavailable" }, { status: 502 });
  }
}
