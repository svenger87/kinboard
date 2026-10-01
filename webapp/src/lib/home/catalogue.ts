/**
 * The household's catalogue, as an assistant may see it — RFC-011 §4.1.
 *
 * "Catalogue only": an assistant reaches an entity only if this family put it
 * in its catalogue (`catalogue_items`, `kind = 'ha_entity'`). Everything else
 * is "not found", so an assistant cannot learn which entities exist in Home
 * Assistant beyond what the household chose to show.
 *
 * The room is the linked `rooms` row's name. `catalogue_items.room` (text) is
 * deliberately not used: since RFC-007 it is the legacy recovery copy the
 * catalogue screen no longer writes, so falling back to it would resurrect a
 * room the household cleared (see `migration_rooms.sql`).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { ENTITY_ID } from "@/lib/home/policy";
import { CatalogueUnavailable } from "@/lib/home/errors";

export interface CatalogueEntity {
  entityId: string;
  /** The household's name for it, not Home Assistant's. */
  name: string;
  room: string | null;
}

/** Large enough for any real household, small enough to bound one state read. */
export const MAX_CATALOGUE_ENTITIES = 500;
const MAX_ENTITY_ID = 255;

const COLUMNS = "family_id, kind, entity_id, name, rooms(name, family_id)";

/**
 * Rows → entities, re-checking in code what the query already filtered on.
 *
 * Pure, so the filtering is tested without a database. The family and kind
 * checks repeat the query's `.eq`s on purpose: this list decides which
 * entities an assistant may touch, and a query edited later must not be able
 * to widen it on its own. A room linked across families (which the session
 * routes do not allow, but nothing in the schema forbids) is dropped rather
 * than shown.
 */
export function toCatalogueEntities(rows: unknown, familyId: string): CatalogueEntity[] {
  if (!Array.isArray(rows)) return [];
  const out: CatalogueEntity[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    if (!row || row.family_id !== familyId || row.kind !== "ha_entity") continue;
    const entityId = row.entity_id;
    if (typeof entityId !== "string" || entityId.length > MAX_ENTITY_ID || !ENTITY_ID.test(entityId)) continue;
    const room = row.rooms as { name?: unknown; family_id?: unknown } | null | undefined;
    out.push({
      entityId,
      name: typeof row.name === "string" ? row.name : entityId,
      room: room && room.family_id === familyId && typeof room.name === "string" ? room.name : null,
    });
  }
  return out;
}

/** This family's catalogue entities, in display order. Throws `CatalogueUnavailable`. */
export async function catalogueEntities(familyId: string): Promise<CatalogueEntity[]> {
  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("catalogue_items")
    .select(COLUMNS)
    .eq("family_id", familyId)
    .eq("kind", "ha_entity")
    .order("position", { ascending: true })
    .order("name", { ascending: true })
    .limit(MAX_CATALOGUE_ENTITIES);
  if (error) throw new CatalogueUnavailable();
  return toCatalogueEntities(data, familyId);
}

/** One entity of this family's catalogue, or null. Throws `CatalogueUnavailable`. */
export async function catalogueEntity(familyId: string, entityId: string): Promise<CatalogueEntity | null> {
  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("catalogue_items")
    .select(COLUMNS)
    .eq("family_id", familyId)
    .eq("kind", "ha_entity")
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) throw new CatalogueUnavailable();
  return toCatalogueEntities(data ? [data] : [], familyId)[0] ?? null;
}
