import { NextRequest, NextResponse } from "next/server";
import { LOCALES } from "@/i18n/locales";

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;
const BASE_URL = process.env.OPENWEATHERMAP_BASE_URL || "https://api.openweathermap.org/data/2.5";

interface ForecastItem {
  dt: number;
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    humidity: number;
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
  pop: number; // Probability of precipitation
  rain?: { "3h": number };
  snow?: { "3h": number };
  dt_txt: string;
}

interface OpenWeatherForecastResponse {
  list: ForecastItem[];
  city: {
    name: string;
    coord: {
      lat: number;
      lon: number;
    };
    timezone: number;
  };
}

const CONDITION_LABELS: Record<string, Record<string, string>> = {
  de: { Clear: "Klar", Clouds: "Bewölkt", Rain: "Regen", Drizzle: "Nieselregen", Thunderstorm: "Gewitter", Snow: "Schnee", Mist: "Nebel", Fog: "Nebel", Haze: "Dunst" },
  en: { Clear: "Clear", Clouds: "Cloudy", Rain: "Rain", Drizzle: "Drizzle", Thunderstorm: "Thunderstorm", Snow: "Snow", Mist: "Mist", Fog: "Fog", Haze: "Haze" },
  fr: { Clear: "Dégagé", Clouds: "Nuageux", Rain: "Pluie", Drizzle: "Bruine", Thunderstorm: "Orage", Snow: "Neige", Mist: "Brume", Fog: "Brouillard", Haze: "Brume sèche" },
};

function mapCondition(weatherMain: string, lang: string): string {
  return CONDITION_LABELS[lang]?.[weatherMain] ?? CONDITION_LABELS.de[weatherMain] ?? weatherMain;
}

function getDayName(date: Date, locale: string = "de-DE"): string {
  return date.toLocaleDateString(locale, { weekday: "short" });
}

// Maps the app's short lang code to the BCP47 tag used by Intl date/time
// formatting, so forecast day names and hourly times follow the app
// language instead of always being formatted as German.
function bcp47ForLang(lang: string): string {
  return LOCALES.find((l) => l.code === lang)?.bcp47 ?? "de-DE";
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const city = searchParams.get("city");
  const rawLang = searchParams.get("lang") || "de";
  const lang = ["de", "en", "fr"].includes(rawLang) ? rawLang : "de";

  if (!OPENWEATHERMAP_API_KEY) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  try {
    let url: string;

    if (lat && lon) {
      url = `${BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=metric&lang=${lang}&appid=${OPENWEATHERMAP_API_KEY}`;
    } else if (city) {
      url = `${BASE_URL}/forecast?q=${encodeURIComponent(city)}&units=metric&lang=${lang}&appid=${OPENWEATHERMAP_API_KEY}`;
    } else {
      return NextResponse.json(
        { error: "Either lat/lon or city parameter required" },
        { status: 400 }
      );
    }

    const response = await fetch(url, {
      next: { revalidate: 1800 }, // Cache for 30 minutes
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

    const data: OpenWeatherForecastResponse = await response.json();

    // Group forecasts by day
    const dailyForecasts: Record<string, ForecastItem[]> = {};

    for (const item of data.list) {
      const date = new Date(item.dt * 1000);
      const dateKey = date.toISOString().split("T")[0];

      if (!dailyForecasts[dateKey]) {
        dailyForecasts[dateKey] = [];
      }
      dailyForecasts[dateKey].push(item);
    }

    // Process each day to get summary
    const days = Object.entries(dailyForecasts).map(([dateKey, items]) => {
      const date = new Date(dateKey);
      const temps = items.map(i => i.main.temp);
      const maxTemp = Math.round(Math.max(...temps));
      const minTemp = Math.round(Math.min(...temps));

      // Get most common weather condition (prefer midday)
      const middayItem = items.find(i => {
        const hour = new Date(i.dt * 1000).getHours();
        return hour >= 11 && hour <= 14;
      }) || items[Math.floor(items.length / 2)];

      // Calculate max precipitation probability
      const maxPop = Math.round(Math.max(...items.map(i => i.pop)) * 100);

      // Calculate total precipitation
      const totalRain = items.reduce((sum, i) => sum + (i.rain?.["3h"] || 0), 0);
      const totalSnow = items.reduce((sum, i) => sum + (i.snow?.["3h"] || 0), 0);

      return {
        date: dateKey,
        dayName: getDayName(date, bcp47ForLang(lang)),
        tempMax: maxTemp,
        tempMin: minTemp,
        condition: mapCondition(middayItem.weather[0].main, lang),
        conditionMain: middayItem.weather[0].main,
        conditionIcon: middayItem.weather[0].icon,
        humidity: Math.round(items.reduce((sum, i) => sum + i.main.humidity, 0) / items.length),
        windSpeed: Math.round((items.reduce((sum, i) => sum + i.wind.speed, 0) / items.length) * 3.6),
        precipProbability: maxPop,
        rainAmount: Math.round(totalRain * 10) / 10,
        snowAmount: Math.round(totalSnow * 10) / 10,
      };
    });

    // Get hourly forecast for next 24 hours
    const hourlyForecast = data.list.slice(0, 8).map(item => {
      const date = new Date(item.dt * 1000);
      return {
        time: date.toLocaleTimeString(bcp47ForLang(lang), { hour: "2-digit", minute: "2-digit" }),
        temp: Math.round(item.main.temp),
        condition: mapCondition(item.weather[0].main, lang),
        conditionMain: item.weather[0].main,
        conditionIcon: item.weather[0].icon,
        precipProbability: Math.round(item.pop * 100),
        windSpeed: Math.round(item.wind.speed * 3.6),
      };
    });

    return NextResponse.json({
      location: data.city.name,
      coords: data.city.coord,
      timezone: data.city.timezone,
      daily: days,
      hourly: hourlyForecast,
    });
  } catch (error) {
    console.error("Forecast API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch forecast data" },
      { status: 500 }
    );
  }
}
