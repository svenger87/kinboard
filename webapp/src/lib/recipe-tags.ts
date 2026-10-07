/**
 * Make the recipe's tags exactly `names`.
 *
 * Tags were half-wired: the tables, the query key, the filter chips on the
 * recipes page and the export/import round-trip all existed, but nothing
 * ever wrote a row into recipe_tag_assignments. Creating a recipe created
 * the tag and forgot to link it; editing one dropped the tags entirely. So
 * every tag chip filtered to an empty list.
 *
 * Names are matched case-insensitively against the family's existing tags,
 * so "Vegan" and "vegan" don't become two chips for the same thing.
 *
 * Shared by the recipe pages (hooks/use-recipes.ts, the browser client) and
 * the Integration API's recipe create (lib/integration-recipes.ts, the
 * service-role client). Every read here filters on `familyId` itself, so it
 * is family-scoped with either client.
 */
export async function syncRecipeTags(
  // The recipe hooks use an untyped client throughout; matching that rather
  // than introducing a second convention here.
  supabase: any,
  familyId: string,
  recipeId: string,
  names: string[],
): Promise<void> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))];

  if (wanted.length === 0) {
    const { error } = await supabase
      .from("recipe_tag_assignments")
      .delete()
      .eq("recipe_id", recipeId);
    if (error) throw error;
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("recipe_tags")
    .select("id, name")
    .eq("family_id", familyId);
  if (existingError) throw existingError;

  const byName = new Map<string, string>(
    ((existing ?? []) as Array<{ id: string; name: string }>).map((tag) => [
      tag.name.toLowerCase(),
      tag.id,
    ]),
  );

  const missing = wanted.filter((name) => !byName.has(name.toLowerCase()));
  if (missing.length > 0) {
    const { data: created, error: createError } = await supabase
      .from("recipe_tags")
      .insert(missing.map((name) => ({ family_id: familyId, name })))
      .select("id, name");
    if (createError) throw createError;
    for (const tag of (created ?? []) as Array<{ id: string; name: string }>) {
      byName.set(tag.name.toLowerCase(), tag.id);
    }
  }

  const tagIds = wanted
    .map((name) => byName.get(name.toLowerCase()))
    .filter((id): id is string => Boolean(id));

  // Drop the assignments that are no longer wanted, then add the rest. The
  // primary key is (recipe_id, tag_id), so re-adding an existing one would
  // conflict — upsert with ignoreDuplicates keeps this idempotent.
  const { error: pruneError } = await supabase
    .from("recipe_tag_assignments")
    .delete()
    .eq("recipe_id", recipeId)
    .not("tag_id", "in", `(${tagIds.join(",")})`);
  if (pruneError) throw pruneError;

  const { error: linkError } = await supabase
    .from("recipe_tag_assignments")
    .upsert(
      tagIds.map((tagId) => ({ recipe_id: recipeId, tag_id: tagId })),
      { onConflict: "recipe_id,tag_id", ignoreDuplicates: true },
    );
  if (linkError) throw linkError;
}
