import { NextRequest, NextResponse } from "next/server";
import {
  toUnitSystem,
  windSpeedForDisplay,
  visibilityForDisplay,
} from "@/lib/weather-units";
import {
  fetchOpenWeather,
  mapCondition,
  openWeatherApiKey,
  OpenWeatherError,
  placeFrom,
  weatherLang,
  type OpenWeatherCurrent,
} from "@/lib/weather-provider";

function formatTime(timestamp: number, timezoneOffset: number): string {
  const date = new Date((timestamp + timezoneOffset) * 1000);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const city = searchParams.get("city");
  const lang = weatherLang(searchParams.get("lang"));
  const units = toUnitSystem(searchParams.get("units"));
  const apiKey = openWeatherApiKey();

  if (!apiKey) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  const where = placeFrom(lat, lon, city);
  if (!where.ok) {
    return where.reason === "invalid_coordinates"
      ? NextResponse.json({ error: "Invalid coordinates configured" }, { status: 400 })
      : NextResponse.json({ error: "Either lat/lon or city parameter required" }, { status: 400 });
  }

  try {
    // Through lib/weather-provider so the assistant's /weather shares this
    // request's cache entry (10 minutes) instead of paying for its own.
    let data: OpenWeatherCurrent;
    try {
      data = await fetchOpenWeather<OpenWeatherCurrent>("weather", where.place, units, lang, apiKey);
    } catch (err) {
      if (err instanceof OpenWeatherError && err.status === 404) {
        return NextResponse.json(
          { error: "Location not found" },
          { status: 404 }
        );
      }
      throw err;
    }

    // Transform to our format
    const weather = {
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      condition: mapCondition(data.weather[0].main, lang),
      conditionMain: data.weather[0].main,
      conditionIcon: data.weather[0].icon,
      humidity: data.main.humidity,
      // m/s → km/h for metric; imperial already arrives as mph.
      windSpeed: windSpeedForDisplay(data.wind.speed, units),
      location: data.name,
      high: Math.round(data.main.temp_max),
      low: Math.round(data.main.temp_min),
      // Always metres from the API, whatever `units` says.
      visibility: visibilityForDisplay(data.visibility, units),
      sunrise: formatTime(data.sys.sunrise, data.timezone),
      sunset: formatTime(data.sys.sunset, data.timezone),
      // Seconds east of UTC at the *forecast location*. sunrise/sunset
      // above are already in that zone, so anything comparing them
      // against "now" needs this or it compares two different clocks —
      // which is what drew the sun at the wrong point of its arc for any
      // board configured to a city in another zone.
      timezoneOffset: data.timezone,
      // Echoed back so the client labels the numbers with the system
      // they were actually produced in, even if the setting changed
      // while this response was in flight.
      units,
    };

    return NextResponse.json(weather);
  } catch (error) {
    console.error("Weather API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch weather data" },
      { status: 500 }
    );
  }
}
