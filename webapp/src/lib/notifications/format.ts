/**
 * Server-side time/date formatting for push notification bodies.
 *
 * The webapp container's clock runs in whatever timezone the host
 * sets via the `TZ` env var (default `UTC` in `.env.example` and on
 * stock Docker hosts). Without an explicit `timeZone` option,
 * `toLocaleTimeString` formats in the runtime zone — so a CEST 08:00
 * event renders as "06:00" inside a UTC container and the user gets
 * a push notification that's two hours off.
 *
 * Resolves the formatter zone in this order:
 *   1. `process.env.TZ` (set by docker-compose from `.env`)
 *   2. `Europe/Berlin` (project's German-first default; matches the
 *      hardcoded `de-DE` locale used in the notification bodies)
 *
 * Self-hosters elsewhere should set `TZ=America/New_York` (or
 * equivalent) in their `.env` so server-rendered times match their
 * household's wall clock.
 */
function notificationTimeZone(): string {
  return process.env.TZ || "Europe/Berlin";
}

export function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: notificationTimeZone(),
  });
}
