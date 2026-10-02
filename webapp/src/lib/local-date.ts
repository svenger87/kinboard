/**
 * A calendar day, as the person looking at the screen would name it.
 *
 * `new Date().toISOString().split("T")[0]` looks like it produces today
 * and produces the *UTC* day instead. East of Greenwich it is wrong every
 * night between local midnight and the offset — in Berlin (UTC+2) a task
 * due today reads as not-due until 02:00, and "move this meal to
 * tomorrow" wrote today\'s date, so the meal never moved.
 *
 * This is the same mistake the weather forecast made with a different
 * blast radius (see lib/weather-time.ts, which shifts the other way for a
 * remote location). Every date key that names a day *here* should come
 * from this function.
 */
export function toLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today, where the viewer is. */
export function todayKey(): string {
  return toLocalDateKey();
}

/**
 * `day` (a `YYYY-MM-DD` calendar date) moved by `n` days, as a calendar
 * date. Anchored at noon UTC, so no zone's daylight-saving change can land
 * it on the day before or after.
 */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
