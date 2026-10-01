import type { createAdminClient } from "@/lib/supabase/server";
import { matchPersonForEvent, type PersonMappingRule } from "@/lib/calendar-person-matcher";

/**
 * Who a synced Google event is for.
 *
 * Kinboard writes the assignee into the event's private extended property
 * `person_id` (the screens via /api/google/events, assistants via the
 * Integration API), and sync reads it back. But the property lives in
 * Google, where Kinboard does not control it: anyone who can edit a shared
 * Google calendar can set it, and two families connected to the same
 * calendar each read what the other wrote. The `events.person_id` foreign
 * key only checks that the person exists *somewhere*, so an unchecked value
 * put another family's person on this family's event. Now it is used only
 * when it names one of this family's people who is not in the recycle bin;
 * anything else is ignored and the event is assigned as if the property
 * were absent: the calendar's own person, then the mapping rules.
 */

type Db = ReturnType<typeof createAdminClient>;

/** Ids of the family's people who are not in the recycle bin. Throws on a database error. */
export async function familyPersonIds(db: Db, familyId: string): Promise<Set<string>> {
  const { data, error } = await (db as any)
    .from("people")
    .select("id")
    .eq("family_id", familyId)
    .is("deleted_at", null);
  if (error) throw error;
  return new Set(((data ?? []) as { id: string }[]).map((p) => p.id));
}

export function syncedEventPersonId(args: {
  /** `extendedProperties.private.person_id` as Google returned it. */
  fromGoogle: unknown;
  familyPeople: Set<string>;
  calendarPersonId: string | undefined;
  title: string | null | undefined;
  mappingRules: PersonMappingRule[];
}): string | undefined {
  const { fromGoogle, familyPeople, calendarPersonId, title, mappingRules } = args;
  if (typeof fromGoogle === "string" && familyPeople.has(fromGoogle)) return fromGoogle;
  if (calendarPersonId) return calendarPersonId;
  if (mappingRules.length > 0) return matchPersonForEvent(title ?? "", mappingRules) || undefined;
  return undefined;
}
