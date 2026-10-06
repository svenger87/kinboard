import { isRecurring, isTodoOpen, type RecurringFields } from "@/lib/todo-recurrence";

export interface TodoCounts {
  total: number;
  /** Still to do: what the Home widget and the nav badge count (isTodoOpen). */
  open: number;
  /** The rest: one-offs ticked off, and recurring tasks done until they come round again. */
  done: number;
  /** One-offs ticked off: the rows "Delete completed" removes. A recurring row is never one. */
  completed: number;
  recurring: number;
}

/**
 * The Tasks page's counts. A recurring task's row never says `completed` --
 * it comes round again -- so counting rows called one done this morning,
 * next due tomorrow, open and not done all day.
 */
export function todoCounts(todos: readonly RecurringFields[], now: Date = new Date()): TodoCounts {
  const open = todos.filter((todo) => isTodoOpen(todo, now)).length;
  return {
    total: todos.length,
    open,
    done: todos.length - open,
    completed: todos.filter((todo) => todo.completed).length,
    recurring: todos.filter((todo) => isRecurring(todo)).length,
  };
}

/** The Tasks page's status filter, by the same rule as todoCounts. */
export function matchesStatus(todo: RecurringFields, status: string, now: Date = new Date()): boolean {
  if (status === "active") return isTodoOpen(todo, now);
  if (status === "completed") return !isTodoOpen(todo, now);
  return true;
}
