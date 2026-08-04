import { NextRequest, NextResponse } from "next/server";

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;

// Available weather map layers from OpenWeatherMap
const WEATHER_MAP_LAYERS = {
  precipitation: "precipitation_new",
  clouds: "clouds_new",
  temperature: "temp_new",
  wind: "wind_new",
  pressure: "pressure_new",
} as const;

// Get map configuration for a location
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!OPENWEATHERMAP_API_KEY) {
    return NextResponse.json(
      { error: "Weather API not configured" },
      { status: 500 }
    );
  }

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

  return NextResponse.json({
    center: {
      lat: latNum,
      lon: lonNum,
    },
    zoom: 8,
    layers: {
      precipitation: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.precipitation),
      clouds: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.clouds),
      temperature: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.temperature),
      wind: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.wind),
      pressure: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.pressure),
    },
    // OpenStreetMap base layer
    baseLayer: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> | Weather: OpenWeatherMap',
  });
}
