import { toLocalDateKey } from "@/lib/local-date";
import { isScheduled, isTurnOpen, type TurnFields } from "@/lib/todo-turns";

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

export interface RecurringFields extends TurnFields {
  completed?: boolean;
  recurrence?: string | null;
  last_completed?: string | null;
  /** When the task was made: where a never-done custom-days task starts counting. */
  created_at?: string | null;
}

/** Whole calendar days between two dates, in `timeZone` (the viewer's own without one). */
function calendarDaysBetween(from: Date, to: Date, timeZone?: string | null): number {
  // Compare date keys rather than subtracting timestamps: a chore ticked at
  // 22:00 is due again the next morning, not at 22:00 the following night,
  // and the ms-based version also drifted by an hour across a DST change.
  const [fy, fm, fd] = dayKeyIn(from, timeZone).split("-").map(Number);
  const [ty, tm, td] = dayKeyIn(to, timeZone).split("-").map(Number);
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

/**
 * Custom days. A task can repeat on picked weekdays -- Monday to Friday, say --
 * stored in `recurrence` as "days:" and iCalendar day codes, Monday first:
 * "days:MO,TU,WE,TH,FR". The column is plain text, so no migration, and every
 * other value is untouched.
 *
 * Codes are indexed in getDay() order: 0 is Sunday.
 */
export const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAYS_PREFIX = "days:";
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** The picked weekdays (getDay() numbers, Monday first) of a custom-days task, or null for any other recurrence. */
export function recurrenceWeekdays(recurrence: string | null | undefined): number[] | null {
  if (!recurrence?.startsWith(DAYS_PREFIX)) return null;
  const picked = new Set(
    recurrence
      .slice(DAYS_PREFIX.length)
      .split(",")
      .map((code) => (WEEKDAY_CODES as readonly string[]).indexOf(code.trim().toUpperCase()))
      .filter((day) => day >= 0),
  );
  return MONDAY_FIRST.filter((day) => picked.has(day));
}

/**
 * How a set of picked weekdays is stored: "days:MO,WE,FR", Monday first. All
 * seven is stored as "daily", so one schedule has one spelling; none is null,
 * which is not a schedule at all.
 */
export function formatRecurrenceDays(days: Iterable<number>): string | null {
  const picked = new Set([...days].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (picked.size === 0) return null;
  if (picked.size === 7) return "daily";
  return DAYS_PREFIX + MONDAY_FIRST.filter((day) => picked.has(day)).map((day) => WEEKDAY_CODES[day]).join(",");
}

/** The interval recurrences, plus "once" for a task that does not repeat. */
export const RECURRENCE_VALUES = ["once", "daily", "weekly", "biweekly", "monthly"] as const;

/**
 * A recurrence a caller sent, as it would be stored -- or null when it is not
 * one Kinboard knows. Accepts the values the task form stores: "once",
 * "daily", "weekly", "biweekly", "monthly", and "days:" with one or more
 * weekday codes ("days:MO,WE,FR"). Codes are case-insensitive and stored the
 * way the form stores them (formatRecurrenceDays: Monday first, all seven as
 * "daily"). An empty "days:" or an unknown code is refused rather than
 * dropped: a task that silently repeats on fewer days than asked for is worse
 * than an error.
 */
export function parseRecurrence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if ((RECURRENCE_VALUES as readonly string[]).includes(v)) return v;
  if (!v.startsWith(DAYS_PREFIX)) return null;
  const codes = v.slice(DAYS_PREFIX.length).split(",").map((code) => code.trim().toUpperCase());
  const days = codes.map((code) => (WEEKDAY_CODES as readonly string[]).indexOf(code));
  if (days.length === 0 || days.some((day) => day < 0)) return null;
  return formatRecurrenceDays(days);
}

/** A local date key ("YYYY-MM-DD") in `timeZone`, or in this runtime's own zone without one. */
export function dayKeyIn(date: Date, timeZone?: string | null): string {
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    } catch {
      // An unknown zone name: fall through to the runtime's own.
    }
  }
  return toLocalDateKey(date);
}

const dayNumber = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const weekdayOf = (dayN: number): number => new Date(dayN * 86_400_000).getUTCDay();

/**
 * The first day that counts for a custom-days task: the day after it was last
 * done, or -- never done -- the day it was made (today if that is unknown).
 */
function weekdayWindowStart(todo: RecurringFields, todayN: number, timeZone?: string | null): number {
  const last = todo.last_completed ? new Date(todo.last_completed) : null;
  if (last && !Number.isNaN(last.getTime())) return dayNumber(dayKeyIn(last, timeZone)) + 1;
  const created = todo.created_at ? new Date(todo.created_at) : null;
  if (created && !Number.isNaN(created.getTime())) return dayNumber(dayKeyIn(created, timeZone));
  return todayN;
}

/**
 * True when a custom-days task is due: a picked weekday has come round since it
 * was last done (or since it was made). Missed days do not pile up -- it is
 * simply due, as an interval task is when overdue. `timeZone` decides what
 * "today" is; without one, the runtime's own zone (the browser's, on a page).
 */
export function isWeekdayTaskDue(
  todo: RecurringFields,
  weekdays: readonly number[],
  now: Date = new Date(),
  timeZone?: string | null,
): boolean {
  if (weekdays.length === 0) return false;
  const todayN = dayNumber(dayKeyIn(now, timeZone));
  const startN = weekdayWindowStart(todo, todayN, timeZone);
  // Seven days hold every weekday, so a longer gap need not be walked.
  for (let n = startN; n <= todayN && n < startN + 7; n++) {
    if (weekdays.includes(weekdayOf(n))) return true;
  }
  return false;
}

/**
 * The day a custom-days task comes due next, at local midnight: the first
 * picked weekday since it was last done or made. In the past when overdue.
 */
export function nextWeekdayDueDate(
  todo: RecurringFields,
  weekdays: readonly number[],
  now: Date = new Date(),
): Date | null {
  if (weekdays.length === 0) return null;
  const startN = weekdayWindowStart(todo, dayNumber(dayKeyIn(now)));
  for (let n = startN; n < startN + 7; n++) {
    if (weekdays.includes(weekdayOf(n))) {
      const due = new Date(n * 86_400_000);
      return new Date(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
    }
  }
  return null;
}

export function isRecurring(todo: RecurringFields): boolean {
  return Boolean(todo.recurrence) && todo.recurrence !== "once";
}

/**
 * True when a recurring task has come round again. `timeZone` decides what
 * "today" is (a server passes the family's); without one, the runtime's own.
 */
export function isRecurringTaskDue(
  todo: RecurringFields,
  now: Date = new Date(),
  timeZone?: string | null,
): boolean {
  if (!isRecurring(todo)) return false;
  // Taking turns or tracked (#341): due while the open day is not done.
  if (isScheduled(todo)) return isTurnOpen(todo, dayKeyIn(now, timeZone));
  const weekdays = recurrenceWeekdays(todo.recurrence);
  if (weekdays) return isWeekdayTaskDue(todo, weekdays, now, timeZone);
  // Never done — due since it was created.
  if (!todo.last_completed) return true;

  const lastCompleted = new Date(todo.last_completed);
  if (Number.isNaN(lastCompleted.getTime())) return true;

  const interval = INTERVAL_DAYS[todo.recurrence as string];
  if (!interval) return false;

  return calendarDaysBetween(lastCompleted, now, timeZone) >= interval;
}

const keyOf = (dayN: number): string => new Date(dayN * 86_400_000).toISOString().slice(0, 10);

/**
 * The days from `fromKey` to `toKey` (local date keys, inclusive) on which a
 * recurring task comes due if it is done each time: the days
 * isRecurringTaskDue answers true on, walking forward from `startKey` and
 * ticking the task off on each. Nothing before `startKey` -- past occurrences
 * are not stored, so there is no history to show.
 *
 * Computed rather than walked. After its first due day an interval task comes
 * round every N days and a custom-days task on each picked weekday, so the
 * cost is the days in range, not every day since `startKey`: a calendar paged
 * ten years ahead used to walk 3,650 days per task, on every refetch.
 */
export function recurringDueDayKeys(
  todo: RecurringFields,
  startKey: string,
  fromKey: string,
  toKey: string,
): string[] {
  if (!isRecurring(todo)) return [];
  const startN = dayNumber(startKey);
  const fromN = Math.max(dayNumber(fromKey), startN);
  const toN = dayNumber(toKey);
  if (toN < fromN) return [];
  const keys: string[] = [];

  const weekdays = recurrenceWeekdays(todo.recurrence);
  if (weekdays) {
    if (weekdays.length === 0) return [];
    // Due once a picked weekday has come round since the window opened, and
    // seven days hold every weekday: the first is at most six days on.
    let firstN = weekdayWindowStart(todo, startN);
    while (!weekdays.includes(weekdayOf(firstN))) firstN++;
    firstN = Math.max(firstN, startN);
    if (firstN >= fromN && firstN <= toN) keys.push(keyOf(firstN));
    // Each tick reopens the window the day after, so every picked weekday
    // after the first is due again.
    for (let n = Math.max(firstN + 1, fromN); n <= toN; n++) {
      if (weekdays.includes(weekdayOf(n))) keys.push(keyOf(n));
    }
    return keys;
  }

  const last = todo.last_completed ? new Date(todo.last_completed) : null;
  const lastN = last && !Number.isNaN(last.getTime()) ? dayNumber(toLocalDateKey(last)) : null;
  const interval = INTERVAL_DAYS[todo.recurrence as string];
  if (!interval) {
    // A schedule this file does not know: isRecurringTaskDue calls it due
    // until it is first done, and never after.
    return lastN === null && startN >= fromN && startN <= toN ? [keyOf(startN)] : [];
  }
  // Never done: due from the start. Done: due `interval` days after.
  const firstN = lastN === null ? startN : Math.max(startN, lastN + interval);
  const skip = Math.max(0, Math.ceil((fromN - firstN) / interval));
  for (let n = firstN + skip * interval; n <= toN; n += interval) keys.push(keyOf(n));
  return keys;
}

/**
 * True when a todo is genuinely outstanding — the count a badge should show.
 *
 * A one-off is open until it is completed. A recurring one is open only when
 * it has come round again.
 */
export function isTodoOpen(todo: RecurringFields, now: Date = new Date(), timeZone?: string | null): boolean {
  if (todo.completed) return false;
  if (isRecurring(todo)) return isRecurringTaskDue(todo, now, timeZone);
  return true;
}
