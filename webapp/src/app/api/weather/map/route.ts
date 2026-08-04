import { NextRequest, NextResponse } from "next/server";

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;

// The layer keys the UI uses. The mapping to OpenWeatherMap's own names
// (`precipitation_new` and friends) belongs to the tile proxy, which is
// the only thing that talks to them — this route just names the layers.
const WEATHER_MAP_LAYERS = ["precipitation", "clouds", "temperature", "wind", "pressure"] as const;

// Get map configuration for a location
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "lat and lon parameters required" },
      { status: 400 }
    );
  }

  // Tile URLs point at our own proxy, never at OpenWeatherMap directly.
  // The previous template carried `appid=<key>` and was handed to the
  // browser, which put the key in this response body, the client's query
  // cache and every tile request in the network tab. See
  // api/weather/tile/[layer]/[z]/[x]/[y]/route.ts.
  const tileUrlTemplate = "/api/weather/tile/{layer}/{z}/{x}/{y}";

  // parseFloat returns NaN for junk, and NaN serialises to JSON null —
  // which Leaflet receives as a centre of [null, null] and throws on. A
  // bad stored coordinate should be a clear 400, not a crashed map.
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum) ||
      latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    return NextResponse.json(
      { error: "lat and lon must be valid coordinates" },
      { status: 400 },
    );
  }

  // Checked after the request itself: a malformed coordinate is a 400
  // whatever the server's configuration, and answering 500 for it sent
  // people looking for a server fault that wasn't there. 503 rather than
  // 500 — the service isn't broken, it isn't set up.
  if (!OPENWEATHERMAP_API_KEY) {
    return NextResponse.json(
      { error: "Weather API not configured" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    center: {
      lat: latNum,
      lon: lonNum,
    },
    zoom: 8,
    // Keys, not OpenWeatherMap's internal names: the proxy allowlists
    // these and translates. Emitting `precipitation_new` here made every
    // tile request 404 and the map render blank.
    layers: Object.fromEntries(
      WEATHER_MAP_LAYERS.map((layer) => [layer, tileUrlTemplate.replace("{layer}", layer)]),
    ),
    // OpenStreetMap base layer
    baseLayer: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> | Weather: OpenWeatherMap',
  });
}
