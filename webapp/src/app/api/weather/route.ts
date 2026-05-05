import { NextRequest, NextResponse } from "next/server";

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;
const BASE_URL = process.env.OPENWEATHERMAP_BASE_URL || "https://api.openweathermap.org/data/2.5";

interface OpenWeatherResponse {
  main: {
    temp: number;
    feels_like: number;
    humidity: number;
    temp_min: number;
    temp_max: number;
  };
  weather: Array<{
    id: number;
    main: string;
    description: string;
    icon: string;
  }>;
  wind: {
    speed: number;
  };
  visibility: number;
  sys: {
    sunrise: number;
    sunset: number;
  };
  name: string;
  timezone: number;
}

function formatTime(timestamp: number, timezoneOffset: number): string {
  const date = new Date((timestamp + timezoneOffset) * 1000);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function mapCondition(weatherMain: string): string {
  const mapping: Record<string, string> = {
    Clear: "Klar",
    Clouds: "Bewölkt",
    Rain: "Regen",
    Drizzle: "Nieselregen",
    Thunderstorm: "Gewitter",
    Snow: "Schnee",
    Mist: "Nebel",
    Fog: "Nebel",
    Haze: "Dunst",
  };
  return mapping[weatherMain] || weatherMain;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const city = searchParams.get("city");

  if (!OPENWEATHERMAP_API_KEY) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  try {
    let url: string;

    if (lat && lon) {
      url = `${BASE_URL}/weather?lat=${lat}&lon=${lon}&units=metric&lang=de&appid=${OPENWEATHERMAP_API_KEY}`;
    } else if (city) {
      url = `${BASE_URL}/weather?q=${encodeURIComponent(city)}&units=metric&lang=de&appid=${OPENWEATHERMAP_API_KEY}`;
    } else {
      return NextResponse.json(
        { error: "Either lat/lon or city parameter required" },
        { status: 400 }
      );
    }

    const response = await fetch(url, {
      next: { revalidate: 600 }, // Cache for 10 minutes
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: "Location not found" },
          { status: 404 }
        );
      }
      throw new Error(`OpenWeatherMap API error: ${response.status}`);
    }

    const data: OpenWeatherResponse = await response.json();

    // Transform to our format
    const weather = {
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      condition: mapCondition(data.weather[0].main),
      conditionIcon: data.weather[0].icon,
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed * 3.6), // m/s to km/h
      location: data.name,
      high: Math.round(data.main.temp_max),
      low: Math.round(data.main.temp_min),
      visibility: Math.round(data.visibility / 1000), // m to km
      sunrise: formatTime(data.sys.sunrise, data.timezone),
      sunset: formatTime(data.sys.sunset, data.timezone),
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
