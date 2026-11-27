import { comparePriority } from "@/lib/todo-priority";
import { isRecurring } from "@/lib/todo-recurrence";

/**
 * The Tasks widget's two sections, as the Events widget groups by day:
 * "today" is what is to be done today, "upcoming" is the rest.
 */
export type TaskSection = "today" | "upcoming";

interface WidgetTask {
  due_date?: string | null;
  priority?: string | null;
  recurrence?: string | null;
  created_at: string | null;
}

const dayOf = (todo: WidgetTask): string | null => (todo.due_date ? todo.due_date.slice(0, 10) : null);

/** Past its due date and still open. */
export function isOverdue(todo: WidgetTask, today: string): boolean {
  const due = dayOf(todo);
  return due !== null && due < today;
}

/**
 * Today: a task due today or overdue, and any repeating task that is open,
 * since an open repeating task has come round and is due now (isTodoOpen).
 * Upcoming: a task due after today, or with no date.
 */
export function sectionOf(todo: WidgetTask, today: string): TaskSection {
  if (isRecurring(todo)) return "today";
  const due = dayOf(todo);
  return due !== null && due <= today ? "today" : "upcoming";
}

/**
 * The open tasks in the order the widget lists them, each with its section.
 *
 * Today first: overdue ones, then those due today, then the repeating ones;
 * upcoming by due date, tasks without one last; each by priority, then the
 * oldest first.
 */
export function widgetTasks<T extends WidgetTask>(open: readonly T[], today: string): { section: TaskSection; todo: T }[] {
  const rank = (todo: T, section: TaskSection): number => {
    if (section === "upcoming") return 0;
    if (isOverdue(todo, today)) return 0;
    return dayOf(todo) === today ? 1 : 2;
  };
  return open
    .map((todo) => ({ section: sectionOf(todo, today), todo }))
    .sort((a, b) => {
      if (a.section !== b.section) return a.section === "today" ? -1 : 1;
      const byRank = rank(a.todo, a.section) - rank(b.todo, b.section);
      if (byRank !== 0) return byRank;
      if (a.section === "upcoming") {
        const da = dayOf(a.todo);
        const db = dayOf(b.todo);
        if (da !== db) return da === null ? 1 : db === null ? -1 : da.localeCompare(db);
      }
      return comparePriority(a.todo, b.todo) || (a.todo.created_at ?? "").localeCompare(b.todo.created_at ?? "");
    });
}
