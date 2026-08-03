/**
 * When the next allowance lands.
 *
 * This exists because "the biweekly drop isn't happening" was reported
 * as a bug when the cron was in fact paying perfectly on schedule — the
 * app simply never showed when the next one was due, so ten quiet days
 * were indistinguishable from a broken job. `last_allowance_at` was
 * stored and never rendered anywhere.
 *
 * The prediction must match `/api/cron/process-allowance` exactly, or it
 * replaces one confusion with a worse one. That route pays when BOTH
 * hold:
 *
 *   1. today's UTC day-of-week equals `allowance_day_of_week`, and
 *   2. at least (interval - 1) days have passed since the last payment
 *      — the -1 absorbs an hour of cron jitter without letting a
 *      fortnightly allowance land weekly.
 *
 * Condition 1 is why this can't just add `interval` days: an interval
 * that isn't a multiple of 7 drifts off the configured weekday, and the
 * cron will wait for that weekday to come round again.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NextAllowanceArgs {
  /** ISO timestamp of the last payment; null for an account never paid. */
  lastAllowanceAt: string | null;
  /** Cadence in days: 7 weekly, 14 fortnightly, 28 every four weeks. */
  intervalDays: number;
  /** UTC day of week the cron pays on (0 = Sunday, matching getUTCDay). */
  dayOfWeek: number;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/**
 * The next payment date, or null when the account has no allowance
 * configured. Returned at UTC midnight of the paying day — the cron runs
 * hourly and pays on its first tick after the day rolls over, so the
 * date is meaningful but the time of day is not.
 */
export function nextAllowanceDate({
  lastAllowanceAt,
  intervalDays,
  dayOfWeek,
  now = new Date(),
}: NextAllowanceArgs): Date | null {
  const interval = Math.max(1, Math.floor(intervalDays));
  if (!Number.isFinite(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return null;

  const todayUtc = startOfUtcDay(now);

  // Never paid: the cron pays on the first matching weekday, with no
  // interval to wait out.
  if (!lastAllowanceAt) {
    return advanceToDayOfWeek(todayUtc, dayOfWeek);
  }

  const last = new Date(lastAllowanceAt);
  if (Number.isNaN(last.getTime())) {
    return advanceToDayOfWeek(todayUtc, dayOfWeek);
  }

  // Earliest day the interval guard can pass. Measured from the last
  // payment's exact timestamp, then floored to a day, mirroring the
  // route's `elapsedMs < minIntervalMs` comparison.
  const earliest = startOfUtcDay(new Date(last.getTime() + (interval - 1) * DAY_MS));

  // The cron only runs the check on the configured weekday, so walk
  // forward to it. Never predict the past: an overdue allowance (the
  // container was down, say) is due at the next opportunity, not the
  // one it missed.
  const from = earliest > todayUtc ? earliest : todayUtc;
  return advanceToDayOfWeek(from, dayOfWeek);
}

/** First day on or after `from` whose UTC weekday is `dayOfWeek`. */
function advanceToDayOfWeek(from: Date, dayOfWeek: number): Date {
  const result = new Date(from);
  const delta = (dayOfWeek - result.getUTCDay() + 7) % 7;
  result.setUTCDate(result.getUTCDate() + delta);
  return result;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Whole days from today until the next allowance. 0 means today.
 *
 * Both sides are floored to UTC midnight, so this counts calendar days
 * rather than 24-hour blocks — "in 1 day" should mean tomorrow, not
 * some time in the next 48 hours.
 */
export function daysUntil(target: Date, now: Date = new Date()): number {
  const today = startOfUtcDay(now).getTime();
  const then = startOfUtcDay(target).getTime();
  return Math.max(0, Math.round((then - today) / DAY_MS));
}
