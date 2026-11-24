/**
 * Today's high and low as the Weather card shows them.
 *
 * Not the current-weather `temp_min`/`temp_max`. OpenWeatherMap documents those
 * as the "minimal/maximal currently observed temperature (within large
 * megalopolises and urban areas)": a spread across a city at this moment, which
 * "in most cases" equals the temperature itself. Shown as a day's range, they
 * read as "16° / 9°" while saying nothing about tonight.
 *
 * Today's range is the forecast's steps for today at the weather location plus
 * the reading now. The free forecast starts at the next 3-hour step, so the
 * hours already gone today are not in it: in the evening the high is "now" and
 * the low is tonight's. That is the honest figure the free plan allows.
 *
 * Null when the forecast has no day for today yet (not loaded, or the last step
 * of today has passed): the card then shows no range rather than the city spread.
 */
export function todayRange(
  currentTemp: number,
  daily: ReadonlyArray<{ date: string; tempMax: number; tempMin: number }> | undefined,
  timezoneOffset: number | undefined,
  now: Date = new Date(),
): { high: number; low: number } | null {
  if (!daily?.length) return null;
  const today = locationDateKey(now, timezoneOffset);
  const day = daily.find((d) => d.date === today);
  if (!day) return null;
  return { high: Math.max(day.tempMax, currentTemp), low: Math.min(day.tempMin, currentTemp) };
}

/** `YYYY-MM-DD` at the weather location; the viewer's own day without an offset. */
export function locationDateKey(now: Date, timezoneOffset: number | undefined): string {
  if (timezoneOffset === undefined) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return new Date(now.getTime() + timezoneOffset * 1000).toISOString().slice(0, 10);
}
