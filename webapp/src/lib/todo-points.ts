/**
 * Task points, as the screens count them.
 *
 * The database awards them (docker/migration_zzz_todo_points.sql, extended by
 * migration_zzzzzy_todo_turns.sql): a child's task with points writes one
 * `todo_point_awards` row per completion, and un-ticking takes it back. A
 * child's total is the sum of their rows -- the tasks page, the tasks widget
 * and a child's profile all count it here, so they cannot disagree.
 */

export interface PointAward {
  person_id: string;
  points: number;
}

interface PointsTask {
  points?: number | null;
  person_id?: string | null;
  rotation_person_ids?: string[] | null;
}

/** The points a person has collected: the sum of their awards. */
export function pointsTotal(awards: readonly PointAward[], personId: string): number {
  let total = 0;
  for (const award of awards) if (award.person_id === personId) total += award.points;
  return total;
}

/**
 * Whether a child's profile shows their points: they have collected some, or
 * a task with points is theirs -- assigned to them, or one they take turns on.
 * A child with neither (a family that never uses points) sees no "0 points".
 */
export function showsPoints(
  person: { id: string; is_child?: boolean | null },
  awards: readonly PointAward[],
  todos: readonly PointsTask[] | null | undefined,
): boolean {
  if (!person.is_child) return false;
  if (awards.some((award) => award.person_id === person.id)) return true;
  return (todos ?? []).some(
    (todo) =>
      (todo.points ?? 0) > 0 &&
      (todo.person_id === person.id || (todo.rotation_person_ids ?? []).includes(person.id)),
  );
}
