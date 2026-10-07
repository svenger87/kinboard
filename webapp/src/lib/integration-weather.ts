/**
 * `GET /api/integration/v1/weather`: the family's weather for an assistant.
 *
 * The same place, units and language the Weather widget asks for, fetched
 * through lib/weather-provider — so a question from ChatGPT or Claude lands on
 * the cache entry the widget already filled (current conditions 10 minutes,
 * forecast 30) and costs no provider quota of its own while a board is showing
 * the widget. Two provider requests at most, run together, whatever is asked.
 *
 * The difference from the widget is whose calendar the days are on. The widget
 * groups the 3-hour steps by the weather location's day; an assistant answering
 * "Thursday" means the family's Thursday, so here a step belongs to the date it
 * falls on in the family's time zone (Settings → Language). For a family whose
 * weather is its own town these are the same days.
 *
 * Pure apart from `WeatherIo`, which the route fills with the database and the
 * real `fetch`, and the specs with stubs.
 */

import { familyDateKey } from "@/lib/family-time";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { precipitationForDisplay, toUnitSystem, unitLabels, windSpeedForDisplay, type UnitSystem } from "@/lib/weather-units";
import {
  dayRainChance, fetchOpenWeather, groupForecastByDay, mapCondition, middayItem, OpenWeatherError, placeFrom,
  weatherLang, type OpenWeatherCurrent, type OpenWeatherForecast, type OpenWeatherForecastItem, type WeatherPlace,
} from "@/lib/weather-provider";

export interface WeatherIo {
  /** A `settings` value of this family, or null when there is none. */
  setting: (key: string) => Promise<unknown>;
  /** The family's IANA time zone. */
  timeZone: () => Promise<string>;
  /** The OpenWeatherMap key, or undefined when the server has none. */
  apiKey: () => string | undefined;
  fetch: typeof fetch;
  now: () => Date;
}

/** Why there is no forecast; stable, an assistant may branch on it. */
export type WeatherUnavailableReason = "weather_not_configured" | "location_not_found";

export interface WeatherDay {
  date: string;
  temp_min: number;
  temp_max: number;
  condition: string;
  condition_code: string;
  rain_chance_pct: number;
  rain_amount: number;
  snow_amount: number;
  partial: boolean;
}

export interface WeatherHour {
  time: string;
  temperature: number;
  condition: string;
  condition_code: string;
  rain_chance_pct: number;
}

export interface WeatherCurrent {
  temperature: number;
  feels_like: number;
  condition: string;
  condition_code: string;
  humidity_pct: number;
  wind_speed: number;
  observed_at: string | null;
}

export interface WeatherForecastBody {
  location: string;
  time_zone: string;
  units: { system: UnitSystem; temperature: string; wind_speed: string; precipitation: string };
  current: WeatherCurrent | null;
  daily: WeatherDay[];
  hourly_today: WeatherHour[];
  fetched_at: string;
}

export type WeatherResult =
  | { status: 200; body: WeatherForecastBody }
  | { status: 404; body: { error: string; code: "not_found"; reason: WeatherUnavailableReason } }
  | { status: 502; body: { error: string; code: "upstream_unavailable" }; cause: unknown };

/** A forecast step is 3 hours; a day with fewer than this many is not a whole day. */
const STEPS_PER_DAY = 8;

const notConfigured = (why: string): WeatherResult => ({
  status: 404,
  body: { error: `Weather isn't set up in Kinboard yet: ${why}`, code: "not_found", reason: "weather_not_configured" },
});

/**
 * The place the widget would ask about, from the `weather_location` setting —
 * coordinates when the setting says so and has both, otherwise the city.
 *
 * Unlike the widget there is no fallback: the widget shows Hamburg until a
 * location is chosen, but an assistant telling a family in Lyon that it will
 * stay dry on the strength of Hamburg's forecast is worse than saying nothing.
 */
export function familyWeatherPlace(value: unknown): WeatherPlace | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { type?: unknown; city?: unknown; lat?: unknown; lon?: unknown };
  const coords = v.type === "coordinates";
  const where = placeFrom(coords ? v.lat : null, coords ? v.lon : null, v.city);
  return where.ok ? where.place : null;
}

function hourIn(timeZone: string): (dt: number) => number {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" });
  return (dt) => Number(format.format(new Date(dt * 1000)));
}

function clockIn(timeZone: string): (dt: number) => string {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (dt) => format.format(new Date(dt * 1000));
}

function summariseDay(
  date: string, items: OpenWeatherForecastItem[], hourOf: (dt: number) => number, lang: string, units: UnitSystem,
): WeatherDay {
  const temps = items.map((i) => i.main.temp);
  const midday = middayItem(items, hourOf);
  const rain = items.reduce((sum, i) => sum + (i.rain?.["3h"] || 0), 0);
  const snow = items.reduce((sum, i) => sum + (i.snow?.["3h"] || 0), 0);
  return {
    date,
    temp_min: Math.round(Math.min(...temps)),
    temp_max: Math.round(Math.max(...temps)),
    condition: mapCondition(midday.weather[0].main, lang),
    condition_code: midday.weather[0].main,
    rain_chance_pct: dayRainChance(items),
    rain_amount: precipitationForDisplay(rain, units),
    snow_amount: precipitationForDisplay(snow, units),
    partial: items.length < STEPS_PER_DAY,
  };
}

function shapeCurrent(data: OpenWeatherCurrent, lang: string, units: UnitSystem): WeatherCurrent {
  return {
    temperature: Math.round(data.main.temp),
    feels_like: Math.round(data.main.feels_like),
    condition: mapCondition(data.weather[0].main, lang),
    condition_code: data.weather[0].main,
    humidity_pct: data.main.humidity,
    wind_speed: windSpeedForDisplay(data.wind.speed, units),
    observed_at: typeof data.dt === "number" ? new Date(data.dt * 1000).toISOString() : null,
  };
}

export async function readFamilyWeather(io: WeatherIo): Promise<WeatherResult> {
  const apiKey = io.apiKey();
  if (!apiKey) return notConfigured("this Kinboard server has no OpenWeatherMap API key.");

  const [location, unitSetting, localeSetting, timeZone] = await Promise.all([
    io.setting(SETTINGS_KEYS.weatherLocation),
    io.setting(SETTINGS_KEYS.weatherUnits),
    io.setting(SETTINGS_KEYS.locale),
    io.timeZone(),
  ]);
  const place = familyWeatherPlace(location);
  if (!place) return notConfigured("no weather location is chosen in Settings → Weather.");

  const units = toUnitSystem(unitSetting);
  const lang = weatherLang(localeSetting);

  // Both at once; current conditions are a nice-to-have, the forecast is not.
  const [forecast, current] = await Promise.allSettled([
    fetchOpenWeather<OpenWeatherForecast>("forecast", place, units, lang, apiKey, io.fetch),
    fetchOpenWeather<OpenWeatherCurrent>("weather", place, units, lang, apiKey, io.fetch),
  ]);

  if (forecast.status === "rejected") {
    if (forecast.reason instanceof OpenWeatherError && forecast.reason.status === 404) {
      return {
        status: 404,
        body: {
          error: "The weather service does not know the location chosen in Settings → Weather.",
          code: "not_found",
          reason: "location_not_found",
        },
      };
    }
    return {
      status: 502,
      body: { error: "The weather service could not be reached — try again later.", code: "upstream_unavailable" },
      cause: forecast.reason,
    };
  }

  const now = io.now();
  const today = familyDateKey(now, timeZone);
  const hourOf = hourIn(timeZone);
  const clockOf = clockIn(timeZone);
  const dayOf = (dt: number) => familyDateKey(new Date(dt * 1000), timeZone);
  const data = forecast.value;
  const labels = unitLabels(units);

  return {
    status: 200,
    body: {
      location: data.city?.name || ("city" in place ? place.city : `${place.lat}, ${place.lon}`),
      time_zone: timeZone,
      units: { system: units, temperature: labels.temperature, wind_speed: labels.speed, precipitation: labels.precipitation },
      current: current.status === "fulfilled" ? shapeCurrent(current.value, lang, units) : null,
      daily: groupForecastByDay(data.list, dayOf)
        .filter(([date]) => date >= today)
        .map(([date, items]) => summariseDay(date, items, hourOf, lang, units)),
      hourly_today: data.list
        .filter((item) => dayOf(item.dt) === today)
        .map((item) => ({
          time: clockOf(item.dt),
          temperature: Math.round(item.main.temp),
          condition: mapCondition(item.weather[0].main, lang),
          condition_code: item.weather[0].main,
          rain_chance_pct: Math.round(item.pop * 100),
        })),
      fetched_at: now.toISOString(),
    },
  };
}
