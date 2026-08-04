import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy for OpenWeatherMap's map tiles.
 *
 * `/api/weather/map` used to hand the browser a tile URL template with
 * `appid=<key>` baked in, so the key sat in the JSON response, in the
 * client's query cache, and in the URL of every tile request in the
 * network tab. Anyone who could load the dashboard — a guest on the wifi,
 * anyone near an unlocked kiosk — could read it and spend the quota.
 *
 * Every other weather route already kept the key server-side. This closes
 * the one that didn't: the browser asks Kinboard for a tile, Kinboard
 * fetches it with the key, and the key never leaves the server.
 *
 * The tiles are static raster images that change on OpenWeatherMap's own
 * schedule (roughly every ten minutes for precipitation), so they cache
 * hard and cost little.
 */

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;

/**
 * The layers the UI offers, mapped to OpenWeatherMap's names.
 *
 * An allowlist rather than passing the segment through: the layer lands
 * in an upstream URL, and letting a request choose that string freely is
 * how a tile proxy turns into a general-purpose fetcher.
 */
const LAYERS: Record<string, string> = {
  precipitation: "precipitation_new",
  clouds: "clouds_new",
  temperature: "temp_new",
  wind: "wind_new",
  pressure: "pressure_new",
};

/** Web Mercator tile bounds: zoom 0-19, and 0 <= x,y < 2^z. */
function tileIsValid(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > 19) return false;
  const max = 2 ** z;
  return x >= 0 && x < max && y >= 0 && y < max;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ layer: string; z: string; x: string; y: string }> },
) {
  const { layer, z, x, y } = await params;

  if (!OPENWEATHERMAP_API_KEY) {
    return NextResponse.json({ error: "Weather API not configured" }, { status: 503 });
  }

  const upstreamLayer = LAYERS[layer];
  if (!upstreamLayer) {
    return NextResponse.json({ error: "Unknown layer" }, { status: 404 });
  }

  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  if (!tileIsValid(zi, xi, yi)) {
    return NextResponse.json({ error: "Tile out of range" }, { status: 400 });
  }

  const upstream = `https://tile.openweathermap.org/map/${upstreamLayer}/${zi}/${xi}/${yi}.png?appid=${OPENWEATHERMAP_API_KEY}`;

  try {
    const response = await fetch(upstream, {
      signal: AbortSignal.timeout(10_000),
      // Let Next cache the tile between requests; the browser cache header
      // below covers repeat views from the same board.
      next: { revalidate: 600 },
    });

    if (!response.ok) {
      // Deliberately not forwarding the upstream body: on an auth failure
      // it can echo the request, key included.
      return NextResponse.json(
        { error: "Tile unavailable" },
        { status: response.status === 401 ? 503 : response.status },
      );
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/png",
        // Ten minutes matches how often the weather layers actually move;
        // `stale-while-revalidate` keeps a panning map smooth while the
        // next tile refreshes behind it.
        "Cache-Control": "public, max-age=600, stale-while-revalidate=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Tile unavailable" }, { status: 504 });
  }
}
