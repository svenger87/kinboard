/**
 * Which children the dashboard gives their own Stundenplan card to.
 *
 * Only children who actually have lessons. A schedule row is not enough:
 * `useUpsertSchedule` updates rows and never deletes them, so clearing the
 * last lesson from a day leaves `time_slots: []` behind — a child whose
 * timetable was removed would otherwise keep a "Kein Unterricht heute" tile
 * on the wall forever, and so would every pre-schooler in the family.
 */

interface PersonLike {
  id: string;
  is_child?: boolean | null;
}

interface ScheduleLike {
  person_id?: string | null;
  time_slots?: unknown;
}

export function timetabledChildren<P extends PersonLike>(
  people: P[] | undefined | null,
  schedules: ScheduleLike[] | undefined | null,
): P[] {
  if (!people || !schedules) return [];

  const withLessons = new Set(
    schedules
      .filter((s) => Array.isArray(s.time_slots) && s.time_slots.length > 0)
      .map((s) => s.person_id)
      .filter((id): id is string => !!id),
  );

  // People order, not schedule order: the cards should line up with the
  // family list the rest of the dashboard shows.
  return people.filter((p) => p.is_child && withLessons.has(p.id));
}
