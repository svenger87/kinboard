/**
 * A child's creature has a mood (RFC-016 §2, "later"): sleepy in the
 * family's night, happy once the child's tasks for today are all done, and
 * otherwise just itself. Never sad -- nothing a child does or doesn't do makes
 * their creature look worse.
 *
 * This file is the rules, with no React and nothing from pocket money: it
 * takes a person, the family's tasks and the family's time zone, so it stays
 * where it is when creatures stop belonging to the pocket-money account. The
 * screens get the answer from hooks/use-creature-mood.ts.
 *
 * Which tasks are "today's" reuses the task list's own rules rather than a
 * third copy of them:
 * - whose a task is today: todayPerson (lib/todo-turns.ts) -- a task taking
 *   turns is the child's only on the child's turn;
 * - whether it is still to do: isTodoOpen (lib/todo-recurrence.ts), what the
 *   nav badge and the Home widget count, with "today" the family's.
 */

import { dayKeyIn, isRecurring, isTodoOpen, type RecurringFields } from "@/lib/todo-recurrence";
import { todayPerson } from "@/lib/todo-turns";

export type CreatureMood = "normal" | "happy" | "sleepy";

/** Sleepy from 20:00 ... */
export const SLEEPY_FROM_MINUTE = 20 * 60;
/** ... until 06:30, in the family's time zone. */
export const AWAKE_FROM_MINUTE = 6 * 60 + 30;

/** The task fields a mood is read from. A `Todo` row is one. */
export interface MoodTask extends RecurringFields {
  due_date?: string | null;
  updated_at?: string | null;
}

/** Minutes since midnight on the wall clock in `timeZone` (the runtime's own when it is not a zone). */
export function wallMinutes(now: Date, timeZone?: string | null): number {
  const read = (zone: string | undefined) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return (num("hour") % 24) * 60 + num("minute");
  };
  if (timeZone) {
    try {
      return read(timeZone);
    } catch {
      // An unknown zone name: the runtime's own, as dayKeyIn does.
    }
  }
  return read(undefined);
}

/** True from 20:00 up to (not including) 06:30 in the family's time zone. */
export function isSleepyTime(now: Date, timeZone?: string | null): boolean {
  const m = wallMinutes(now, timeZone);
  return m >= SLEEPY_FROM_MINUTE || m < AWAKE_FROM_MINUTE;
}

/** True when the task was ticked off on `today` (a family date key). */
function doneOn(task: MoodTask, today: string, timeZone?: string | null): boolean {
  if (isRecurring(task)) {
    if (task.last_completed_day?.slice(0, 10) === today) return true;
    const at = task.last_completed ? new Date(task.last_completed) : null;
    return Boolean(at && !Number.isNaN(at.getTime()) && dayKeyIn(at, timeZone) === today);
  }
  if (!task.completed) return false;
  if (task.due_date?.slice(0, 10) === today) return true;
  // A one-off keeps no completion time; a ticked row's last change is the tick.
  const at = task.updated_at ? new Date(task.updated_at) : null;
  return Boolean(at && !Number.isNaN(at.getTime()) && dayKeyIn(at, timeZone) === today);
}

/**
 * A child's tasks for the family's today: how many are still to do, and how
 * many were done today.
 *
 * Still to do: the child's (on their turn), and open as the badge counts it --
 * a repeating task that has come round, a one-off not ticked. A one-off due on
 * a later day is not today's; one with no date, or overdue, is.
 */
export function childDayTasks(
  personId: string,
  tasks: readonly MoodTask[],
  now: Date,
  timeZone?: string | null,
): { open: number; done: number } {
  const today = dayKeyIn(now, timeZone);
  let open = 0;
  let done = 0;
  for (const task of tasks) {
    if (todayPerson(task, today) !== personId) continue;
    if (isTodoOpen(task, now, timeZone)) {
      const due = task.due_date?.slice(0, 10);
      if (isRecurring(task) || !due || due <= today) open++;
    } else if (doneOn(task, today, timeZone)) {
      done++;
    }
  }
  return { open, done };
}

export interface MoodInput {
  personId: string;
  /** The family's tasks; only the person's count. */
  tasks: readonly MoodTask[];
  now: Date;
  /** The family's time zone; the runtime's own when unset. */
  timeZone?: string | null;
}

/**
 * The creature's mood. Night wins: a creature whose child finished
 * everything at 20:15 is asleep, not partying. Happy needs at least one task
 * done today and none left; a day with no tasks is a normal day.
 */
export function creatureMood({ personId, tasks, now, timeZone }: MoodInput): CreatureMood {
  if (isSleepyTime(now, timeZone)) return "sleepy";
  const { open, done } = childDayTasks(personId, tasks, now, timeZone);
  return open === 0 && done > 0 ? "happy" : "normal";
}
