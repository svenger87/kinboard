import { generateJoinCode } from "@/lib/utils";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/** The holiday region every new family starts with: none, and nobody chose it. */
export const NO_HOLIDAY_REGION = Object.freeze({ code: null, chosen: false });

/**
 * Insert a new family, together with the rows it must never exist without.
 *
 * join_code is UNIQUE; a collision (23505) is retried rather than failing
 * the setup, the same pattern as the import route.
 *
 * RFC-014 §4.2 (plan ruling 8): a new family has no holiday region until
 * someone picks one, and says so with an explicit `{ code: null, chosen:
 * false }` row. That row is what keeps the holiday_region migration -- which
 * runs on every boot -- from handing the family Niedersachsen at the next
 * restart, so a family is not created without it: if the row cannot be
 * written, the family is deleted again and the caller gets an error. Nothing
 * else exists for the family yet at that point, and `settings` cascades
 * from `families`, so that one delete undoes the whole request.
 *
 * An upsert, not an insert: should the backfill run between the two writes,
 * the family still ends with "no region" rather than the backfill's guess.
 *
 * `db` is the admin client (it bypasses RLS); every write names the family.
 */
export async function insertFamilyWithRegion(
  db: any,
  name: string,
): Promise<{ family: { id: string } } | { error: string }> {
  let family: { id: string } | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 5 && !family; attempt++) {
    const { data, error } = await db
      .from("families")
      .insert({ name, join_code: generateJoinCode() })
      .select()
      .single();

    if (!error) {
      family = data as { id: string };
      break;
    }
    // 23505 is unique_violation — a code collision, worth retrying.
    if ((error as { code?: string }).code !== "23505") {
      lastError = error.message;
      break;
    }
  }

  if (!family) return { error: lastError ?? "could not create family" };

  const { error: regionError } = await db
    .from("settings")
    .upsert(
      { family_id: family.id, key: SETTINGS_KEYS.holidayRegion, value: NO_HOLIDAY_REGION },
      { onConflict: "family_id,key" },
    );
  if (regionError) {
    console.error("[family-create] could not write holiday_region, removing the family:", regionError.message);
    const { error: rollbackError } = await db.from("families").delete().eq("id", family.id);
    if (rollbackError) {
      console.error("[family-create] could not remove the family again:", rollbackError.message);
    }
    return { error: "could not create family" };
  }

  return { family };
}
