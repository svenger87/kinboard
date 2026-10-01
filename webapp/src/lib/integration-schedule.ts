import { createAdminClient } from "@/lib/supabase/server";
import { isRealDate } from "@/lib/integration-meal-input";
import { loadTimetables, schoolOn, type SchoolDb } from "@/lib/school-days";

/**
 * `GET /schedule` for assistants (RFC-012 §4): the school timetable, read
 * only. Without `day`, each child's lessons per weekday; with `day`, who has
 * school that date — nobody on a holiday or a weekend, with the reason.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ScheduleResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404; body: { error: string; code: "invalid_request" | "not_found" } };

export async function readSchedule(
  familyId: string,
  query: { personId: string | null; day: string | null },
  timeZone: string,
  db: SchoolDb = createAdminClient(),
): Promise<ScheduleResult> {
  const { personId, day } = query;
  if (personId !== null && !UUID_RE.test(personId)) {
    return { status: 400, body: { error: "`person_id` must be a uuid", code: "invalid_request" } };
  }
  if (day !== null && !isRealDate(day)) {
    return { status: 400, body: { error: "`day` must be a YYYY-MM-DD date", code: "invalid_request" } };
  }

  if (personId !== null) {
    // Another family's person, a binned one and a made-up id all read the
    // same: not here.
    const { data, error } = await (db as any)
      .from("people")
      .select("id")
      .eq("id", personId)
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { status: 404, body: { error: "no such person in this family", code: "not_found" } };
  }

  const options = personId !== null ? { personId } : {};
  if (day === null) {
    return { status: 200, body: { children: await loadTimetables(familyId, options, db) } };
  }
  return { status: 200, body: { ...(await schoolOn(familyId, day, timeZone, options, db)) } };
}
