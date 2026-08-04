/**
 * Time at the weather location, as opposed to time where the browser or
 * the container happens to be.
 *
 * OpenWeatherMap gives UTC timestamps plus an offset in seconds
 * (`city.timezone` on the forecast, `timezone` on current weather). It
 * does not give an IANA zone name, so `Intl` with a `timeZone` option is
 * not available to us.
 *
 * The workable trick is to shift the instant by the offset and then read
 * **UTC** fields from the result: those fields then spell out the
 * location's wall clock. The catch is that every subsequent read has to
 * stay in UTC — one `getHours()` and the container's zone is back, which
 * is exactly how the forecast came to render a US household's hours in
 * Berlin time.
 */

/** A Date whose UTC fields read as the location's wall clock. */
export function atLocation(unixSeconds: number, offsetSeconds: number): Date {
  return new Date((unixSeconds + offsetSeconds) * 1000);
}

/** The location's calendar day, `YYYY-MM-DD`. */
export function localDateKey(unixSeconds: number, offsetSeconds: number): string {
  return atLocation(unixSeconds, offsetSeconds).toISOString().split("T")[0];
}

/** The hour of the location's day, 0-23. */
export function localHour(unixSeconds: number, offsetSeconds: number): number {
  return atLocation(unixSeconds, offsetSeconds).getUTCHours();
}

/**
 * Minutes since midnight at the location — the unit sunrise/sunset are
 * compared in.
 *
 * With no offset it falls back to the viewer's own clock, which is right
 * for a board showing its own town and no worse than what it replaced.
 */
export function minutesOfDayAt(now: Date, offsetSeconds?: number): number {
  if (offsetSeconds === undefined) {
    return now.getHours() * 60 + now.getMinutes();
  }
  const there = new Date(now.getTime() + offsetSeconds * 1000);
  return there.getUTCHours() * 60 + there.getUTCMinutes();
}
