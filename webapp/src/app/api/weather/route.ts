import { NextRequest, NextResponse } from "next/server";
import {
  toUnitSystem,
  windSpeedForDisplay,
  visibilityForDisplay,
} from "@/lib/weather-units";

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

const CONDITION_LABELS: Record<string, Record<string, string>> = {
  de: { Clear: "Klar", Clouds: "Bewölkt", Rain: "Regen", Drizzle: "Nieselregen", Thunderstorm: "Gewitter", Snow: "Schnee", Mist: "Nebel", Fog: "Nebel", Haze: "Dunst" },
  en: { Clear: "Clear", Clouds: "Cloudy", Rain: "Rain", Drizzle: "Drizzle", Thunderstorm: "Thunderstorm", Snow: "Snow", Mist: "Mist", Fog: "Fog", Haze: "Haze" },
  fr: { Clear: "Dégagé", Clouds: "Nuageux", Rain: "Pluie", Drizzle: "Bruine", Thunderstorm: "Orage", Snow: "Neige", Mist: "Brume", Fog: "Brouillard", Haze: "Brume sèche" },
};

function mapCondition(weatherMain: string, lang: string): string {
  return CONDITION_LABELS[lang]?.[weatherMain] ?? CONDITION_LABELS.de[weatherMain] ?? weatherMain;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const city = searchParams.get("city");
  const rawLang = searchParams.get("lang") || "de";
  const lang = ["de", "en", "fr"].includes(rawLang) ? rawLang : "de";
  const units = toUnitSystem(searchParams.get("units"));

  if (!OPENWEATHERMAP_API_KEY) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  try {
    let url: string;

    if (lat && lon) {
      // Parsed to numbers rather than interpolated as strings: these come
      // from a settings row, and a value containing `&` would otherwise
      // append parameters of its own to the upstream request. The city
      // branch below has always been encoded; this one was not.
      const latNum = Number(lat);
      const lonNum = Number(lon);
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum) ||
          latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
        return NextResponse.json(
          { error: "Invalid coordinates configured" },
          { status: 400 },
        );
      }
      url = `${BASE_URL}/weather?lat=${latNum}&lon=${lonNum}&units=${units}&lang=${lang}&appid=${OPENWEATHERMAP_API_KEY}`;
    } else if (city) {
      url = `${BASE_URL}/weather?q=${encodeURIComponent(city)}&units=${units}&lang=${lang}&appid=${OPENWEATHERMAP_API_KEY}`;
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
