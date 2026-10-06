/**
 * The avatar catalogue (plugins/pocket-money/catalog/avatars.json), typed,
 * and what it says about classic pictures. No React here, so API routes can
 * import it without pulling in the drawings.
 */

import avatarCatalog from "@/plugins/pocket-money/catalog/avatars.json";
import type { AvatarSpecies } from "../types";

export interface CatalogStage {
  tier: number;
  nameKey: string;
  src?: string;
}
export interface CatalogSpecies {
  id: string;
  labelKey: string;
  drawn?: boolean;
  stages: ReadonlyArray<CatalogStage>;
}
/** The catalogue, typed: a drawn-only species has stages without a picture. */
export const AVATAR_CATALOG: ReadonlyArray<CatalogSpecies> = avatarCatalog.species as ReadonlyArray<CatalogSpecies>;

const CLASSIC_PICTURES: ReadonlySet<string> = new Set(
  AVATAR_CATALOG.filter((s) => s.stages.every((st) => typeof st.src === "string")).map((s) => s.id),
);

/** Whether a species has the classic picture set in public/pocket-money/avatars/. */
export function hasClassicArt(species: AvatarSpecies): boolean {
  return CLASSIC_PICTURES.has(species);
}
