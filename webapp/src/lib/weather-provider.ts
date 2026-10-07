/**
 * The one way Kinboard asks OpenWeatherMap anything.
 *
 * `/api/weather`, `/api/weather/forecast` (the Weather widget) and the
 * Integration API's `/weather` (assistants) all fetch through `fetchOpenWeather`
 * here. That is what keeps an assistant from costing provider quota: Next's
 * data cache keys a `fetch` on its URL and options, so a call built by the same
 * function, for the same place, units and language, is the same cache entry the
 * widget already filled — current conditions for 10 minutes, the forecast for
 * 30. Building the URL a second way somewhere else (a different parameter
 * order, a missing `lang`) would be a second cache entry and a second bill.
 *
 * The API key is read at call time rather than at import, so the not-configured
 * answer follows the environment the request actually runs in.
 */

import type { UnitSystem } from "@/lib/weather-units";

export type OpenWeatherKind = "weather" | "forecast";

/** Seconds a response stays in Next's data cache, per endpoint. */
export const OPENWEATHER_REVALIDATE: Record<OpenWeatherKind, number> = {
  weather: 600, // current conditions: 10 minutes
  forecast: 1800, // 5-day / 3-hour forecast: 30 minutes
};

/** The languages condition labels exist for; anything else is asked for in English. */
export const WEATHER_LANGS = ["de", "en", "fr"] as const;

export function weatherLang(raw: unknown): string {
  return typeof raw === "string" && (WEATHER_LANGS as readonly string[]).includes(raw) ? raw : "en";
}

export function openWeatherBaseUrl(): string {
  return process.env.OPENWEATHERMAP_BASE_URL || "https://api.openweathermap.org/data/2.5";
}

export function openWeatherApiKey(): string | undefined {
  return process.env.OPENWEATHERMAP_API_KEY || undefined;
}

/** Where to ask about: coordinates, or a city name the provider resolves. */
export type WeatherPlace = { lat: number; lon: number } | { city: string };

/**
 * A place from the raw lat/lon/city values a query string or the
 * `weather_location` setting holds.
 *
 * Coordinates are parsed to numbers rather than interpolated as strings: they
 * come from a settings row, and a value containing `&` would otherwise append
 * parameters of its own to the upstream request. Coordinates win over a city
 * when both are present, as the widget has always done.
 */
export function placeFrom(
  lat: unknown, lon: unknown, city: unknown,
): { ok: true; place: WeatherPlace } | { ok: false; reason: "invalid_coordinates" | "missing" } {
  const present = (v: unknown) => v !== null && v !== undefined && v !== "";
  if (present(lat) && present(lon)) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum) ||
        latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return { ok: false, reason: "invalid_coordinates" };
    }
    return { ok: true, place: { lat: latNum, lon: lonNum } };
  }
  if (typeof city === "string" && city.trim() !== "") return { ok: true, place: { city } };
  return { ok: false, reason: "missing" };
}

export function openWeatherUrl(
  kind: OpenWeatherKind, place: WeatherPlace, units: UnitSystem, lang: string, apiKey: string,
): string {
  const where = "city" in place
    ? `q=${encodeURIComponent(place.city)}`
    : `lat=${place.lat}&lon=${place.lon}`;
  return `${openWeatherBaseUrl()}/${kind}?${where}&units=${units}&lang=${lang}&appid=${apiKey}`;
}

export class OpenWeatherError extends Error {
  constructor(readonly status: number) {
    super(`OpenWeatherMap API error: ${status}`);
    this.name = "OpenWeatherError";
  }
}

/**
 * One OpenWeatherMap request through Next's data cache. Throws
 * `OpenWeatherError` for a non-OK answer (404 = the provider does not know the
 * place); network failures propagate as they are.
 */
export async function fetchOpenWeather<T>(
  kind: OpenWeatherKind, place: WeatherPlace, units: UnitSystem, lang: string, apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(openWeatherUrl(kind, place, units, lang, apiKey), {
    next: { revalidate: OPENWEATHER_REVALIDATE[kind] },
  } as RequestInit);
  if (!response.ok) throw new OpenWeatherError(response.status);
  return (await response.json()) as T;
}

// ── Provider shapes ─────────────────────────────────────────────────────

export interface OpenWeatherCurrent {
  dt?: number;
  main: { temp: number; feels_like: number; humidity: number; temp_min: number; temp_max: number };
  weather: Array<{ id: number; main: string; description: string; icon: string }>;
  wind: { speed: number };
  visibility: number;
  sys: { sunrise: number; sunset: number };
  name: string;
  timezone: number;
}

export interface OpenWeatherForecastItem {
  dt: number;
  main: { temp: number; feels_like: number; temp_min: number; temp_max: number; humidity: number };
  weather: Array<{ id: number; main: string; description: string; icon: string }>;
  wind: { speed: number };
  pop: number; // Probability of precipitation, 0..1
  rain?: { "3h": number };
  snow?: { "3h": number };
  dt_txt: string;
}

export interface OpenWeatherForecast {
  list: OpenWeatherForecastItem[];
  city: { name: string; coord: { lat: number; lon: number }; timezone: number };
}

// ── Conditions ──────────────────────────────────────────────────────────

const CONDITION_LABELS: Record<string, Record<string, string>> = {
  de: { Clear: "Klar", Clouds: "Bewölkt", Rain: "Regen", Drizzle: "Nieselregen", Thunderstorm: "Gewitter", Snow: "Schnee", Mist: "Nebel", Fog: "Nebel", Haze: "Dunst" },
  en: { Clear: "Clear", Clouds: "Cloudy", Rain: "Rain", Drizzle: "Drizzle", Thunderstorm: "Thunderstorm", Snow: "Snow", Mist: "Mist", Fog: "Fog", Haze: "Haze" },
  fr: { Clear: "Dégagé", Clouds: "Nuageux", Rain: "Pluie", Drizzle: "Bruine", Thunderstorm: "Orage", Snow: "Neige", Mist: "Brume", Fog: "Brouillard", Haze: "Brume sèche" },
};

export function mapCondition(weatherMain: string, lang: string): string {
  return CONDITION_LABELS[lang]?.[weatherMain] ?? CONDITION_LABELS.de[weatherMain] ?? weatherMain;
}

// ── Days ────────────────────────────────────────────────────────────────

/**
 * The 3-hour forecast steps grouped into calendar days, in first-seen order.
 * `dayOf` decides whose calendar: the widget's is the weather location's
 * (`localDateKey` with the provider's offset), the assistant's the family's.
 */
export function groupForecastByDay(
  list: OpenWeatherForecastItem[], dayOf: (dt: number) => string,
): [string, OpenWeatherForecastItem[]][] {
  const days = new Map<string, OpenWeatherForecastItem[]>();
  for (const item of list) {
    const key = dayOf(item.dt);
    const bucket = days.get(key);
    if (bucket) bucket.push(item);
    else days.set(key, [item]);
  }
  return [...days.entries()];
}

/** The day's summary item: the first step between 11:00 and 14:00, else the middle one. */
export function middayItem(
  items: OpenWeatherForecastItem[], hourOf: (dt: number) => number,
): OpenWeatherForecastItem {
  return items.find((i) => {
    const hour = hourOf(i.dt);
    return hour >= 11 && hour <= 14;
  }) || items[Math.floor(items.length / 2)];
}

/**
 * A day's highest chance of precipitation as a whole percent, 0 included —
 * the figure the widget shows under each day.
 */
export function dayRainChance(items: OpenWeatherForecastItem[]): number {
  return Math.round(Math.max(...items.map((i) => i.pop)) * 100);
}
