import { getHolidays, type Holiday } from "@/lib/holidays";
import { toLocalDateKey } from "@/lib/local-date";
import {
  isRecurring,
  recurrenceWeekdays,
  recurringDueDayKeys,
  type RecurringFields,
} from "@/lib/todo-recurrence";
import {
  currentDay,
  dayStatus,
  isScheduled,
  scheduledDueDays,
  turnPerson,
  type DayStatus,
  type WrittenDay,
} from "@/lib/todo-turns";

/**
 * What the calendar marks on a day besides events. Family-wide, and both off
 * by default: a household that has not asked for markers sees the calendar it
 * always had.
 */
export interface CalendarDisplaySettings {
  showHolidays: boolean;
  showTasks: boolean;
  /** Tasks also listed among events: the Events widget, the week overview, the calendar's day lists. */
  tasksAsEvents: boolean;
}

export const DEFAULT_CALENDAR_DISPLAY: CalendarDisplaySettings = {
  showHolidays: false,
  showTasks: false,
  tasksAsEvents: false,
};

export interface MarkerTodo extends RecurringFields {
  due_date?: string | null;
  person_id?: string | null;
  deleted_at?: string | null;
}

// Day arithmetic on date keys, never on timestamps: a key is a calendar day in
// the viewer's timezone, and adding 86 400 000 ms drifts by an hour across DST.
const dayNumber = (key: string): number => {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const keyOf = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

/**
 * The days, as local date keys, on which a task is marked between `from` and
 * `to` inclusive.
 *
 * A one-off task is marked on its due date while it is open, and not at all
 * without one: there is no day to put it on. A recurring task is marked on the
 * days the task list would call it due: recurringDueDayKeys -- the rule the
 * task list and the nav badge use, carried forward -- from today, taking the
 * task as done on every day it comes due. An overdue task is marked today.
 * Nothing recurring is marked before today: past occurrences are history, and
 * that history is not stored.
 *
 * A repeating task never done but given a due date starts on that date, where
 * the task list shows it, not today. Custom days are the exception, in the
 * list as here: they count from the day the task was made.
 */
export function taskDayKeys(
  todo: MarkerTodo,
  from: Date,
  to: Date,
  now: Date = new Date(),
  written?: ReadonlyMap<string, WrittenDay>,
): string[] {
  if (todo.deleted_at || todo.completed) return [];
  const fromN = dayNumber(toLocalDateKey(from));
  const toN = dayNumber(toLocalDateKey(to));
  if (toN < fromN) return [];

  // Taking turns or tracked (#341): the schedule's own days. A tracked task
  // shows its history too, from the day tracking started; one that is not
  // tracked shows the open day and what comes after, without the open day
  // once it is done, as any repeating task drops off when ticked.
  if (isScheduled(todo)) {
    const today = toLocalDateKey(now);
    const open = currentDay(todo, today);
    const fromKey = keyOf(fromN);
    const toKey = keyOf(toN);
    if (todo.track_completion) {
      const since = todo.tracking_started_day && todo.tracking_started_day > fromKey ? todo.tracking_started_day : fromKey;
      const days = new Set(since <= toKey ? scheduledDueDays(todo, since, toKey) : []);
      for (const row of written?.values() ?? []) if (row.day >= fromKey && row.day <= toKey) days.add(row.day);
      return [...days].sort();
    }
    const first = open && open < today ? open : today;
    return scheduledDueDays(todo, first > fromKey ? first : fromKey, toKey).filter(
      (day) => !(day === open && todo.last_completed_day === open) && (day >= today || day === open),
    );
  }

  if (!isRecurring(todo)) {
    if (!todo.due_date) return [];
    const n = dayNumber(todo.due_date);
    return n >= fromN && n <= toN ? [keyOf(n)] : [];
  }

  let startN = dayNumber(toLocalDateKey(now));
  if (!todo.last_completed && todo.due_date && !recurrenceWeekdays(todo.recurrence)) {
    startN = Math.max(startN, dayNumber(todo.due_date));
  }
  return recurringDueDayKeys(todo, keyOf(startN), keyOf(fromN), keyOf(toN));
}

/**
 * Day key -> one colour per person with a task that day, in `people` order,
 * then a single neutral dot for anything unassigned. One dot per person rather
 * than per task: the dot says "something is here for Emma", not how much. A
 * person id that matches nobody (a removed person) counts as unassigned.
 *
 * Takes occurrences rather than tasks, so the calendar can put them through
 * the same person and search filters as its events before they become dots.
 */
export function taskMarkersByDay(
  occurrences: readonly { dayKey: string; personId: string | null }[],
  people: readonly { id: string; color: string }[],
  unassignedColor: string,
): Map<string, string[]> {
  const byDay = new Map<string, Set<string | null>>();
  for (const { dayKey, personId } of occurrences) {
    let ids = byDay.get(dayKey);
    if (!ids) byDay.set(dayKey, (ids = new Set()));
    ids.add(personId);
  }

  const known = new Set(people.map((p) => p.id));
  const out = new Map<string, string[]>();
  for (const [key, ids] of byDay) {
    const colors = people.filter((p) => ids.has(p.id)).map((p) => p.color);
    if ([...ids].some((id) => id === null || !known.has(id))) colors.push(unassignedColor);
    out.set(key, colors);
  }
  return out;
}

/** One person's dot on a day: done when every tracked task of theirs that day was, missed when any was not. */
export interface TaskDot {
  color: string;
  status?: "done" | "missed";
}

/**
 * taskMarkersByDay, with how each person's day went (#341): a dot is
 * "missed" when any of that person's tracked tasks that day was not done,
 * "done" when every task of theirs that day is a tracked one that was, and
 * plain otherwise -- something still to do.
 */
export function taskDotsByDay(
  occurrences: readonly { dayKey: string; personId: string | null; status?: DayStatus }[],
  people: readonly { id: string; color: string }[],
  unassignedColor: string,
): Map<string, TaskDot[]> {
  const colors = taskMarkersByDay(occurrences, people, unassignedColor);
  const known = new Set(people.map((p) => p.id));
  const colorOf = (id: string | null) =>
    (id && known.has(id) && people.find((p) => p.id === id)?.color) || unassignedColor;
  const statuses = new Map<string, DayStatus[]>();
  for (const o of occurrences) {
    const key = `${o.dayKey}|${colorOf(o.personId)}`;
    const list = statuses.get(key) ?? [];
    list.push(o.status ?? "upcoming");
    statuses.set(key, list);
  }
  const out = new Map<string, TaskDot[]>();
  for (const [day, list] of colors) {
    out.set(
      day,
      list.map((color) => {
        const s = statuses.get(`${day}|${color}`) ?? [];
        if (s.includes("missed")) return { color, status: "missed" as const };
        if (s.length > 0 && s.every((x) => x === "done")) return { color, status: "done" as const };
        return { color };
      }),
    );
  }
  return out;
}

/** Day key -> the built-in public holiday on it, for every year the range touches, named in `locale`. */
export function holidaysByDay(region: string, from: Date, to: Date, locale: string = "en"): Map<string, Holiday> {
  const fromKey = toLocalDateKey(from);
  const toKey = toLocalDateKey(to);
  const out = new Map<string, Holiday>();
  for (let year = from.getFullYear(); year <= to.getFullYear(); year++) {
    for (const holiday of getHolidays(region, year, locale)) {
      const key = toLocalDateKey(holiday.date);
      if (key >= fromKey && key <= toKey && !out.has(key)) out.set(key, holiday);
    }
  }
  return out;
}

/** A task on one day, shaped to sit in a list of events. */
export interface TaskOccurrence {
  /** Unique per task and day, and never a real event id: `task:<todo id>:<day key>`. */
  id: string;
  todoId: string;
  title: string;
  dayKey: string;
  /** Local midnight of `dayKey`: an all-day item. */
  date: Date;
  color: string;
  personId: string | null;
  /** Shown next to the title: who the task is for. */
  personName: string | null;
  /** How the day stands, for a task that tracks whether it was done (#341). */
  status?: DayStatus;
}

export const TASK_EVENT_PREFIX = "task:";

/** True for an id made by taskOccurrences -- a task in an event list, with no event row behind it. */
export function isTaskEventId(id: string): boolean {
  return id.startsWith(TASK_EVENT_PREFIX);
}

/**
 * Every occurrence of every task between `from` and `to`, on the days
 * taskDayKeys gives, coloured by person, sorted by day then title.
 */
export function taskOccurrences(
  todos: readonly (MarkerTodo & { id: string; title: string })[],
  people: readonly { id: string; color: string; name?: string }[],
  from: Date,
  to: Date,
  unassignedColor: string,
  now: Date = new Date(),
  history?: ReadonlyMap<string, ReadonlyMap<string, WrittenDay>>,
): TaskOccurrence[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const today = toLocalDateKey(now);
  const out: TaskOccurrence[] = [];
  for (const todo of todos) {
    const written = history?.get(todo.id);
    const scheduled = isScheduled(todo);
    for (const dayKey of taskDayKeys(todo, from, to, now, written)) {
      const [y, m, d] = dayKey.split("-").map(Number);
      // A rotating task is that day's person's, past and future.
      const personId = scheduled ? turnPerson(todo, dayKey, written) : todo.person_id ?? null;
      out.push({
        id: `${TASK_EVENT_PREFIX}${todo.id}:${dayKey}`,
        todoId: todo.id,
        title: todo.title,
        dayKey,
        date: new Date(y, m - 1, d),
        color: (personId && byId.get(personId)?.color) || unassignedColor,
        personId,
        personName: (personId && byId.get(personId)?.name) || null,
        ...(scheduled && todo.track_completion ? { status: dayStatus(todo, dayKey, today, written) } : {}),
      });
    }
  }
  return out.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.title.localeCompare(b.title));
}

/**
 * taskOccurrences over several ranges at once -- the month on screen and the
 * week the side panel lists -- with each occurrence once where they overlap,
 * sorted the same way.
 *
 * Separate ranges rather than one span covering both: browsing years ahead, a
 * span from today to the grid built every occurrence in between -- about 39,000
 * items for 30 tasks ten years out, rebuilt on every refetch.
 */
export function taskOccurrencesIn(
  todos: readonly (MarkerTodo & { id: string; title: string })[],
  people: readonly { id: string; color: string; name?: string }[],
  ranges: readonly (readonly [Date, Date])[],
  unassignedColor: string,
  now: Date = new Date(),
  history?: ReadonlyMap<string, ReadonlyMap<string, WrittenDay>>,
): TaskOccurrence[] {
  const byId = new Map<string, TaskOccurrence>();
  for (const [from, to] of ranges) {
    for (const o of taskOccurrences(todos, people, from, to, unassignedColor, now, history)) byId.set(o.id, o);
  }
  return [...byId.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.title.localeCompare(b.title));
}

/**
 * Each task's first occurrence only. An upcoming list shows what comes next;
 * listing every repeat would let one daily chore fill it and push the real
 * events out. Expects the sorted output of taskOccurrences.
 */
export function nextTaskOccurrences(occurrences: readonly TaskOccurrence[]): TaskOccurrence[] {
  const seen = new Set<string>();
  return occurrences.filter((o) => {
    if (seen.has(o.todoId)) return false;
    seen.add(o.todoId);
    return true;
  });
}
