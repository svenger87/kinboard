import { familyDateKey } from "@/lib/family-time";
import { keepsSchedule, type TurnFields } from "@/lib/todo-turns";

/**
 * What a `status` PATCH on a task should write, decided once and shared by
 * the route and its tests.
 *
 * Extracted from `/lists/tasks/{item}` (RFC-011 task 1) because the rule has
 * a date-math edge the route must not get to reinvent: completing a
 * recurring task writes `last_completed_day` as a calendar day in the
 * *family's* time zone, matching `app/todos/page.tsx`'s
 * `handleToggleTask` exactly — the points trigger
 * (`migration_zzz_todo_points.sql`) keys an award on that same column, so a
 * route computing the day differently would silently award (or skip) points
 * out of step with the UI.
 *
 * A one-off task is the simple case: `completed` is the only state it has.
 *
 * Reopening (`needs_action`) is where the two kinds diverge for good. A
 * one-off task un-ticks. A plain recurring task has no "day" to un-complete
 * — the UI never asks it to — so the route must refuse rather than guess,
 * and it refuses as a conflict rather than silently doing nothing.
 *
 * A recurring task that takes turns or tracks whether it was done (#341)
 * does have one: the open due day. Clearing `last_completed` asks the
 * database to take that day's "done" back (migration_zzzzzy_todo_turns.sql),
 * with the caller's day alongside so it knows which day "today" is.
 */
export function completionUpdate(
  task: { recurrence: string | null } & TurnFields,
  status: "completed" | "needs_action",
  now: Date,
  timeZone: string,
): { ok: true; update: Record<string, unknown> } | { ok: false; conflict: true } {
  const recurring = (task.recurrence ?? "once") !== "once";

  if (status === "completed") {
    if (recurring) {
      return {
        ok: true,
        update: {
          last_completed: now.toISOString(),
          last_completed_day: familyDateKey(now, timeZone),
          completed: false,
        },
      };
    }
    return { ok: true, update: { completed: true } };
  }

  // status === "needs_action"
  if (recurring && keepsSchedule(task)) {
    return { ok: true, update: { last_completed: null, last_completed_day: familyDateKey(now, timeZone) } };
  }
  if (recurring) {
    return { ok: false, conflict: true };
  }
  return { ok: true, update: { completed: false } };
}
