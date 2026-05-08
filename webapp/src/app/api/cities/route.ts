import { NextRequest, NextResponse } from "next/server";

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;
// Geo endpoint is at a different path tier than the weather/forecast API
// (`/geo/1.0` vs `/data/2.5`), so it gets its own override. In production
// neither env var is set and we hit the real OWM. In demo / CI the demo
// overlay can route this to a mock without disturbing the weather routes.
const OPENWEATHERMAP_GEO_URL =
  process.env.OPENWEATHERMAP_GEO_URL || "https://api.openweathermap.org/geo/1.0";

interface GeocodingResult {
  name: string;
  local_names?: Record<string, string>;
  lat: number;
  lon: number;
  country: string;
  state?: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  if (!OPENWEATHERMAP_API_KEY) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  try {
    const url = `${OPENWEATHERMAP_GEO_URL}/direct?q=${encodeURIComponent(query)}&limit=5&appid=${OPENWEATHERMAP_API_KEY}`;

    const response = await fetch(url, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!response.ok) {
      // Treat any non-200 from OWM (401 invalid key, 429 rate-limited,
      // 5xx outage) the same as a missing key. Reverse-geocoding from
      // the dashboard widget shouldn't spam console.error on every
      // page load when the key has a problem — the weather widget's
      // own /api/weather call has the same degrade-gracefully shape
      // and surfaces the configure-weather card visibly.
      console.error(
        `/api/cities: OWM responded ${response.status}; treating as unconfigured`,
      );
      return NextResponse.json({ configured: false }, { status: 200 });
    }

    const data: GeocodingResult[] = await response.json();

    // Transform to simpler format
    const cities = data.map((city) => ({
      name: city.name,
      displayName: city.state
        ? `${city.name}, ${city.state}, ${city.country}`
        : `${city.name}, ${city.country}`,
      lat: city.lat,
      lon: city.lon,
      country: city.country,
      state: city.state,
    }));

    return NextResponse.json(cities);
  } catch (error) {
    // Network error / timeout / DNS failure — same graceful-degrade
    // path. Still log so it shows up in container logs for debugging.
    console.error("Geocoding API error:", error);
    return NextResponse.json({ configured: false }, { status: 200 });
  }
}
