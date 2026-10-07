import { atLocation, localDateKey, localHour } from "@/lib/weather-time";
import { NextRequest, NextResponse } from "next/server";
import {
  toUnitSystem,
  windSpeedForDisplay,
  precipitationForDisplay,
} from "@/lib/weather-units";
import { LOCALES } from "@/i18n/locales";
import {
  dayRainChance,
  fetchOpenWeather,
  groupForecastByDay,
  mapCondition,
  middayItem,
  openWeatherApiKey,
  OpenWeatherError,
  placeFrom,
  weatherLang,
  type OpenWeatherForecast,
} from "@/lib/weather-provider";

// No default locale: every caller passes one, and a default of "de-DE" meant a
// missing parameter silently produced German day names for everybody.
function getDayName(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
}

// Maps the app's short lang code to the BCP47 tag used by Intl date/time
// formatting, so forecast day names and hourly times follow the app
// language instead of always being formatted as German.
function bcp47ForLang(lang: string): string {
  // Fall back to English rather than German: an unrecognised code is a bug
  // or a new locale, and neither is a reason to answer in German.
  return LOCALES.find((l) => l.code === lang)?.bcp47 ?? "en-GB";
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
    // request's cache entry (30 minutes) instead of paying for its own.
    let data: OpenWeatherForecast;
    try {
      data = await fetchOpenWeather<OpenWeatherForecast>("forecast", where.place, units, lang, apiKey);
    } catch (err) {
      if (err instanceof OpenWeatherError && err.status === 404) {
        return NextResponse.json(
          { error: "Location not found" },
          { status: 404 }
        );
      }
      throw err;
    }

    // Seconds east of UTC for the forecast location.
    const tzOffset = data.city.timezone ?? 0;

    // Group forecasts by the day they fall on *where the weather is*.
    const dailyForecasts = groupForecastByDay(data.list, (dt) => localDateKey(dt, tzOffset));

    // Process each day to get summary
    const days = dailyForecasts.map(([dateKey, items]) => {
      // `dateKey` is a bare YYYY-MM-DD, which parses as UTC midnight —
      // hence the UTC timeZone in getDayName, or a browser west of
      // Greenwich would name the previous day.
      const date = new Date(dateKey);
      const temps = items.map(i => i.main.temp);
      const maxTemp = Math.round(Math.max(...temps));
      const minTemp = Math.round(Math.min(...temps));

      // Get most common weather condition (prefer midday). The hour is the
      // one where the weather is: getHours() read the container's zone, so
      // the "midday" icon for a distant city came from the middle of its night.
      const midday = middayItem(items, (dt) => localHour(dt, tzOffset));

      // Calculate max precipitation probability
      const maxPop = dayRainChance(items);

      // Calculate total precipitation
      const totalRain = items.reduce((sum, i) => sum + (i.rain?.["3h"] || 0), 0);
      const totalSnow = items.reduce((sum, i) => sum + (i.snow?.["3h"] || 0), 0);

      return {
        date: dateKey,
        dayName: getDayName(date, bcp47ForLang(lang)),
        tempMax: maxTemp,
        tempMin: minTemp,
        condition: mapCondition(midday.weather[0].main, lang),
        conditionMain: midday.weather[0].main,
        conditionIcon: midday.weather[0].icon,
        humidity: Math.round(items.reduce((sum, i) => sum + i.main.humidity, 0) / items.length),
        windSpeed: windSpeedForDisplay(
          items.reduce((sum, i) => sum + i.wind.speed, 0) / items.length,
          units,
        ),
        precipProbability: maxPop,
        // Precipitation is millimetres from the API in both unit
        // systems, so it always needs converting for imperial.
        rainAmount: precipitationForDisplay(totalRain, units),
        snowAmount: precipitationForDisplay(totalSnow, units),
      };
    });

    // Get hourly forecast for next 24 hours
    const hourlyForecast = data.list.slice(0, 8).map(item => {
      const date = atLocation(item.dt, tzOffset);
      return {
        /*
          The location's wall clock as "HH:mm" — UTC fields of the shifted
          instant, which is what `atLocation` produces.

          Deliberately not formatted for a locale here. It was
          `toLocaleTimeString(bcp47ForLang(lang), …)`, which put the whole strip
          on a 12-hour clock for every English household and a 24-hour one for
          every German household — following the interface language rather than
          the "24-hour format" switch, which it never consulted. The server
          cannot consult it: the setting is per-family and read through the
          browser's session. So this sends an unambiguous 24-hour string and the
          client renders it with `formatWallClock`.
        */
        time: date.toISOString().slice(11, 16),
        temp: Math.round(item.main.temp),
        condition: mapCondition(item.weather[0].main, lang),
        conditionMain: item.weather[0].main,
        conditionIcon: item.weather[0].icon,
        precipProbability: Math.round(item.pop * 100),
        windSpeed: windSpeedForDisplay(item.wind.speed, units),
      };
    });

    return NextResponse.json({
      location: data.city.name,
      coords: data.city.coord,
      timezone: data.city.timezone,
      daily: days,
      hourly: hourlyForecast,
      units,
    });
  } catch (error) {
    console.error("Forecast API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch forecast data" },
      { status: 500 }
    );
  }
}
