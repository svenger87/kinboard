import { recurrenceWeekdays } from "@/lib/todo-recurrence";

/**
 * Taking turns and a done / not-done history for repeating tasks (#341).
 *
 * A repeating task that rotates between people or tracks whether it was done
 * *keeps a schedule*: its due days are fixed by the calendar, counted from
 * `schedule_start_day`, instead of coming round N days after it was last
 * done. Day k of the schedule is `rotation_person_ids[k mod n]`'s. A due day
 * stays open until the next one arrives; a tick always lands on the open day,
 * and once the next one comes, the old one is closed.
 *
 * The rules live in the database (docker/migration_zzzzzy_todo_turns.sql),
 * which writes `schedule_start_day`, `carry_day` and the history. This file
 * is their mirror for the screens, line for line -- a change there is a change
 * here -- so a screen can say whose turn any day is without asking.
 *
 * Every day here is a date key, "YYYY-MM-DD"; arithmetic is on day numbers,
 * never on timestamps, so DST cannot move a day.
 */

export interface TurnFields {
  recurrence?: string | null;
  person_id?: string | null;
  rotation_person_ids?: string[] | null;
  track_completion?: boolean | null;
  schedule_start_day?: string | null;
  carry_day?: string | null;
  tracking_started_day?: string | null;
  last_completed_day?: string | null;
}

/** A written-down day, as todo_occurrences holds it. */
export interface WrittenDay {
  day: string;
  person_id: string | null;
  status: "open" | "done" | "missed";
}

export type DayStatus = "done" | "missed" | "open" | "upcoming";

const INTERVAL_DAYS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };

export const dayNumber = (key: string): number => {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
export const dayKeyOf = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (n: number): number => new Date(n * 86_400_000).getUTCDay();

function intervalDays(recurrence: string | null | undefined): number | null {
  return (recurrence && INTERVAL_DAYS[recurrence]) || null;
}

/** True when the recurrence is one a schedule can be kept for. */
function hasSchedule(recurrence: string | null | undefined): boolean {
  return intervalDays(recurrence) !== null || (recurrenceWeekdays(recurrence)?.length ?? 0) > 0;
}

/** todo_keeps_schedule: repeating, and rotating or tracked. */
export function keepsSchedule(todo: TurnFields): boolean {
  return (Boolean(todo.track_completion) || (todo.rotation_person_ids?.length ?? 0) > 0) && hasSchedule(todo.recurrence);
}

/** True when the database has started this task's schedule. */
export function isScheduled(todo: TurnFields): boolean {
  return keepsSchedule(todo) && Boolean(todo.schedule_start_day || todo.carry_day);
}

/** todo_is_due_day: a due day of the schedule starting at `start` (itself a due day). */
export function isDueDay(recurrence: string | null | undefined, start: string, day: string): boolean {
  const s = dayNumber(start);
  const d = dayNumber(day);
  if (d < s) return false;
  const step = intervalDays(recurrence);
  if (step) return (d - s) % step === 0;
  return (recurrenceWeekdays(recurrence) ?? []).includes(weekdayOf(d));
}

/** todo_prev_due_day: the last due day on or before `day`, or null before the start. */
export function prevDueDay(recurrence: string | null | undefined, start: string, day: string): string | null {
  const s = dayNumber(start);
  const d = dayNumber(day);
  if (d < s) return null;
  const step = intervalDays(recurrence);
  if (step) return dayKeyOf(s + Math.floor((d - s) / step) * step);
  for (let n = d; n > d - 7 && n >= s; n--) {
    if (isDueDay(recurrence, start, dayKeyOf(n))) return dayKeyOf(n);
  }
  return null;
}

/** todo_due_index: how many due days lie in [start, day) -- day k of the rotation. */
export function dueIndex(recurrence: string | null | undefined, start: string, day: string): number {
  const s = dayNumber(start);
  const span = dayNumber(day) - s;
  if (span <= 0) return 0;
  const step = intervalDays(recurrence);
  if (step) return Math.ceil(span / step);
  const days = recurrenceWeekdays(recurrence) ?? [];
  let n = Math.floor(span / 7) * days.length;
  for (let i = 0; i < span % 7; i++) if (days.includes(weekdayOf(s + i))) n++;
  return n;
}

/** todo_current_day: the day a tick on `today` lands on, or null when no turn is open yet. */
export function currentDay(todo: TurnFields, today: string): string | null {
  if (todo.schedule_start_day && today >= todo.schedule_start_day) {
    return prevDueDay(todo.recurrence, todo.schedule_start_day, today);
  }
  if (todo.carry_day && todo.carry_day <= today) return todo.carry_day;
  return null;
}

/**
 * todo_turn_person: whose turn `day` is. A written-down day keeps the person
 * it was written with; otherwise the rotation's, or the task's own person.
 */
export function turnPerson(todo: TurnFields, day: string, written?: ReadonlyMap<string, WrittenDay>): string | null {
  const row = written?.get(day);
  if (row) return row.person_id;
  const rotation = todo.rotation_person_ids ?? [];
  if (rotation.length > 0 && todo.schedule_start_day && day >= todo.schedule_start_day) {
    return rotation[dueIndex(todo.recurrence, todo.schedule_start_day, day) % rotation.length];
  }
  return todo.person_id ?? null;
}

/** Today's person: the open turn's, or the first turn's before the schedule starts. */
export function todayPerson(todo: TurnFields, today: string): string | null {
  if (!isScheduled(todo)) return todo.person_id ?? null;
  const day = currentDay(todo, today) ?? todo.schedule_start_day;
  return day ? turnPerson(todo, day) : todo.person_id ?? null;
}

/**
 * True when a scheduled task's open day has not been done. The database sets
 * `last_completed_day` to the open day on a tick and back to the previous
 * done day on an un-tick, so no history is needed to answer this.
 */
export function isTurnOpen(todo: TurnFields, today: string): boolean {
  const day = currentDay(todo, today);
  return day !== null && todo.last_completed_day !== day;
}

/** The scheduled task's due days from `from` to `to` inclusive: the carried-over day and the schedule's. */
export function scheduledDueDays(todo: TurnFields, from: string, to: string): string[] {
  const out: string[] = [];
  if (todo.carry_day && todo.carry_day >= from && todo.carry_day <= to) out.push(todo.carry_day);
  const start = todo.schedule_start_day;
  if (!start) return out;
  const fromN = Math.max(dayNumber(from), dayNumber(start));
  const toN = dayNumber(to);
  const step = intervalDays(todo.recurrence);
  if (step) {
    const s = dayNumber(start);
    for (let n = s + Math.ceil((fromN - s) / step) * step; n <= toN; n += step) out.push(dayKeyOf(n));
    return out;
  }
  const days = recurrenceWeekdays(todo.recurrence) ?? [];
  for (let n = fromN; n <= toN; n++) if (days.includes(weekdayOf(n))) out.push(dayKeyOf(n));
  return out;
}

/**
 * How a due day stands. A day written down is as written. A closed day not
 * yet written -- the pass that writes them runs every quarter of an hour --
 * counts as missed once tracking covers it; the open day is open unless the
 * task was ticked for it; later days are upcoming.
 */
export function dayStatus(
  todo: TurnFields,
  day: string,
  today: string,
  written?: ReadonlyMap<string, WrittenDay>,
): DayStatus {
  const open = currentDay(todo, today);
  const row = written?.get(day);
  if (day === open) {
    if (row?.status === "done" || todo.last_completed_day === day) return "done";
    return "open";
  }
  if (row) return row.status === "open" ? (open && day < open ? "missed" : "open") : row.status;
  if (open ? day < open : day <= today) {
    return todo.track_completion && todo.tracking_started_day && day >= todo.tracking_started_day ? "missed" : "upcoming";
  }
  return "upcoming";
}

/**
 * The last `count` due days up to and including today's open one, oldest
 * first, with how each stands -- the `✓ ✓ ✗` strip on a tracked task. Days
 * before tracking started are left out: there is no history for them.
 */
export function recentDays(
  todo: TurnFields,
  today: string,
  written: ReadonlyMap<string, WrittenDay> | undefined,
  count = 7,
): { day: string; status: DayStatus; personId: string | null }[] {
  if (!isScheduled(todo) || !todo.track_completion) return [];
  const open = currentDay(todo, today);
  const last = open ?? today;
  // Going back far enough to find `count` due days: a monthly task needs 30 a step.
  const step = intervalDays(todo.recurrence) ?? 7;
  const from = dayKeyOf(dayNumber(last) - step * count - 7);
  const days = new Set(scheduledDueDays(todo, from, last));
  for (const row of written?.values() ?? []) if (row.day >= from && row.day <= last) days.add(row.day);
  return [...days]
    .filter((day) => !todo.tracking_started_day || day >= todo.tracking_started_day)
    .sort()
    .slice(-count)
    .map((day) => ({ day, status: dayStatus(todo, day, today, written), personId: turnPerson(todo, day, written) }));
}

/**
 * The day a scheduled task is next due: the open day while it is not done,
 * else the next due day after today. What the task list sorts and labels by.
 */
export function nextTurnDay(todo: TurnFields, today: string): string | null {
  if (isTurnOpen(todo, today)) return currentDay(todo, today);
  const from = dayKeyOf(dayNumber(today) + 1);
  const step = intervalDays(todo.recurrence) ?? 7;
  return scheduledDueDays(todo, from, dayKeyOf(dayNumber(from) + step + 7)).filter((d) => d >= from)[0] ?? null;
}
