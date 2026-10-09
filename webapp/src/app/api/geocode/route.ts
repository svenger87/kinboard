import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { apiError, logApiError } from "@/lib/api-error";
import { hitLimit } from "@/lib/rate-limit";
import { photonSearchParams } from "@/lib/location-search";
import { searchPhoton } from "@/lib/photon-client";

export const dynamic = "force-dynamic";

/** A screen typing in the Location field: a search per pause, a few a second at most. */
const LIMIT = 60;
const WINDOW_MS = 60_000;
const MAX_QUERY = 200;
const MAX_RESULTS = 10;

/** "Papenburg" or OpenWeather's "London,GB": the town, and its country when given. */
function parseNear(value: string): { name: string; country: string | null } | null {
  const trimmed = value.trim().slice(0, MAX_QUERY);
  if (trimmed.length < 2) return null;
  const match = /^(.*?),\s*([A-Za-z]{2})$/.exec(trimmed);
  return match ? { name: match[1].trim(), country: match[2] } : { name: trimmed, country: null };
}

/**
 * Where a weather location given as a town is, from Photon's towns, cities and
 * villages. Cached by searchPhoton like any search, so it costs one request
 * per town a day.
 */
async function locateTown(near: { name: string; country: string | null }): Promise<{ lat: number; lon: number } | null> {
  const params = new URLSearchParams({ q: near.name, limit: "1", lang: "default", layer: "city" });
  if (near.country) params.set("countrycode", near.country.toUpperCase());
  const [town] = await searchPhoton(params);
  return town ? { lat: Number(town.lat), lon: Number(town.lon) } : null;
}

/**
 * GET /api/geocode — the calendar's Location field.
 *
 *   q        what was typed (3 to 200 characters)
 *   lang     the app's language
 *   lat/lon  where the family is (a weather location given as coordinates)
 *   near     ...or the weather location's town, located here
 *   country  the family's country, for a family with no weather location
 *   limit    1 to 10, default 5
 *
 * Behind the session, so Kinboard is not an open proxy to Photon for anyone
 * who finds the URL. See lib/photon-client.ts for why the search is made
 * here rather than from the browser.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { limited, retryAfterMs } = hitLimit(`geocode:${auth.session.sessionId}`, LIMIT, WINDOW_MS);
  if (limited) {
    return apiError("too many searches — slow down", "rate_limited", {
      headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
    });
  }

  const p = request.nextUrl.searchParams;
  const query = (p.get("q") ?? "").trim();
  if (query.length < 3 || query.length > MAX_QUERY) {
    return apiError(`\`q\` must be 3 to ${MAX_QUERY} characters`, "invalid_request");
  }
  const limit = Math.min(MAX_RESULTS, Math.max(1, Number.parseInt(p.get("limit") ?? "5", 10) || 5));
  const language = (p.get("lang") ?? "en").slice(0, 10);

  try {
    let near: { lat: number; lon: number } | null = null;
    const lat = Number(p.get("lat"));
    const lon = Number(p.get("lon"));
    if (p.has("lat") && p.has("lon") && Number.isFinite(lat) && Number.isFinite(lon)) {
      near = { lat, lon };
    } else if (p.get("near")) {
      const town = parseNear(p.get("near")!);
      // A town Photon does not know is no worse than no weather location.
      if (town) near = await locateTown(town).catch(() => null);
    }

    const results = await searchPhoton(
      photonSearchParams({ query, limit, language, near, countryCode: p.get("country") }),
    );
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    await logApiError("geocode", err);
    return apiError("the place search is unavailable", "upstream_unavailable");
  }
}
