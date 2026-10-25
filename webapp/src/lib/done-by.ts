/**
 * "Who did it?" when a task is ticked (migration_zzzzzzzzzzzzz_todo_done_by.sql).
 *
 * A task's points went to whoever it was assigned to, or whose turn it was,
 * so Jonas doing Mira's dishes earned Mira the points. A tick on the board or
 * the tasks page now asks who did it, and the answer travels with the tick as
 * `done_by`; the database awards the points to that person.
 *
 * Asked only where the answer changes something: a task worth points, in a
 * family of more than one. Everything else ticks in one tap, as before.
 */

export interface DoneByPerson {
  id: string;
  name: string;
  is_child: boolean;
}

/** Ask "who did it?" for this tick? Only for a tick worth points, with someone to choose between. */
export function asksWhoDidIt(task: { points?: number | null }, people: readonly unknown[]): boolean {
  return (task.points ?? 0) > 0 && people.length > 1;
}

/**
 * The order the picker offers people in: whoever the task is for (assignee,
 * or whose turn it is) first, as the likely answer; then the other children,
 * who are who the points are for; then the adults. Otherwise as given.
 */
export function doneByOrder<P extends DoneByPerson>(people: readonly P[], expectedId: string | null): P[] {
  const rank = (p: P) => (p.id === expectedId ? 0 : p.is_child ? 1 : 2);
  return people
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}
