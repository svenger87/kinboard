/** OpenWeatherMap's AQI levels, 1 (Good) to 5 (Very Poor): the keys of `weather.aqi.*`. */
export type AqiLevel = 1 | 2 | 3 | 4 | 5;

export function isAqiLevel(value: unknown): value is AqiLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * The dot beside the level's name. The name carries the meaning and is
 * ordinary text colour, so the dot needs no contrast of its own.
 */
export function aqiDotClass(level: AqiLevel): string {
  return level <= 2 ? "bg-success" : level === 3 ? "bg-warning" : "bg-destructive";
}

/**
 * Whether the Home card shows air quality, not just the detail view: only from
 * "Poor" (4) up. The card's side column already holds humidity, wind and
 * "feels like"; a fourth line every day would crowd it to say "Good" most
 * days, while a poor-air day is worth the line.
 */
export function aqiOnCard(level: AqiLevel | undefined): boolean {
  return level !== undefined && level >= 4;
}
