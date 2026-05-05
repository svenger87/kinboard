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

  // Return map configuration with tile URLs
  // Clients will use these URLs directly with their map library
  const tileUrlTemplate = `https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png?appid=${OPENWEATHERMAP_API_KEY}`;

  return NextResponse.json({
    center: {
      lat: parseFloat(lat),
      lon: parseFloat(lon),
    },
    zoom: 8,
    layers: {
      precipitation: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.precipitation),
      clouds: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.clouds),
      temperature: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.temperature),
      wind: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.wind),
      pressure: tileUrlTemplate.replace("{layer}", WEATHER_MAP_LAYERS.pressure),
    },
    layerNames: {
      precipitation: "Niederschlag",
      clouds: "Wolken",
      temperature: "Temperatur",
      wind: "Wind",
      pressure: "Luftdruck",
    },
    // OpenStreetMap base layer
    baseLayer: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> | Weather: OpenWeatherMap',
  });
}
