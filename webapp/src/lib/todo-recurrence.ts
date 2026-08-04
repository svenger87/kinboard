import { toLocalDateKey } from "@/lib/local-date";

/**
 * A recurring todo is never marked `completed` — ticking it writes
 * `last_completed` and leaves the row open so it can come round again. So
 * `!completed` does not mean "outstanding" for a recurring task; it means
 * "exists".
 *
 * Anything counting open todos with `!completed` alone therefore counts
 * every recurring chore forever. That is what kept the nav badge lit: with
 * one daily chore in the family, the number never reached zero no matter
 * what anyone ticked off, and the dashboard widget kept listing it as
 * pending on the same day it was done.
 *
 * The todos page had this logic inline and used it for its own grouping,
 * which is why the page and the badge disagreed with each other.
 */

export interface RecurringFields {
  completed?: boolean;
  recurrence?: string | null;
  last_completed?: string | null;
}

/** Whole calendar days between two dates, in the viewer's timezone. */
function calendarDaysBetween(from: Date, to: Date): number {
  // Compare date keys rather than subtracting timestamps: a chore ticked at
  // 22:00 is due again the next morning, not at 22:00 the following night,
  // and the ms-based version also drifted by an hour across a DST change.
  const [fy, fm, fd] = toLocalDateKey(from).split("-").map(Number);
  const [ty, tm, td] = toLocalDateKey(to).split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

const INTERVAL_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

export function isRecurring(todo: RecurringFields): boolean {
  return Boolean(todo.recurrence) && todo.recurrence !== "once";
}

/** True when a recurring task has come round again. */
export function isRecurringTaskDue(todo: RecurringFields, now: Date = new Date()): boolean {
  if (!isRecurring(todo)) return false;
  // Never done — due since it was created.
  if (!todo.last_completed) return true;

  const lastCompleted = new Date(todo.last_completed);
  if (Number.isNaN(lastCompleted.getTime())) return true;

  const interval = INTERVAL_DAYS[todo.recurrence as string];
  if (!interval) return false;

  return calendarDaysBetween(lastCompleted, now) >= interval;
}

/**
 * True when a todo is genuinely outstanding — the count a badge should show.
 *
 * A one-off is open until it is completed. A recurring one is open only when
 * it has come round again.
 */
export function isTodoOpen(todo: RecurringFields, now: Date = new Date()): boolean {
  if (todo.completed) return false;
  if (isRecurring(todo)) return isRecurringTaskDue(todo, now);
  return true;
}
