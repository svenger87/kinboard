/**
 * Drawn avatars: which species have art, and the one question every screen
 * asks -- draw this, or show the classic picture?
 *
 * A species without a module here (cat, astronaut, plant, wizard for now)
 * shows its classic SVG whatever style is stored, so a style chosen today
 * keeps working the day its drawings arrive.
 */

import type { AvatarSpecies } from "../types";
import { dragon } from "./dragon";
import type { SpeciesArt } from "./skeleton";
import { isDrawnStyle, type AvatarStyle, type DrawnStyle } from "./styles";

export * from "./styles";
export { drawCreature, resolveStyle, type CreatureLook, type CreatureMood, type SpeciesArt } from "./skeleton";

const DRAWN_SPECIES: Readonly<Record<string, SpeciesArt>> = { dragon };

export function speciesArt(species: AvatarSpecies): SpeciesArt | null {
  return Object.prototype.hasOwnProperty.call(DRAWN_SPECIES, species) ? DRAWN_SPECIES[species] : null;
}

export function hasDrawnArt(species: AvatarSpecies): boolean {
  return speciesArt(species) !== null;
}

/**
 * The style a creature is actually shown in: the stored one when the species
 * has drawings for it, "classic" otherwise (and for anything unknown).
 */
export function effectiveStyle(species: AvatarSpecies, style: AvatarStyle | string | null | undefined): AvatarStyle {
  return isDrawnStyle(style) && hasDrawnArt(species) ? (style as DrawnStyle) : "classic";
}

/** The classic picture for a species and stage. */
export function classicAvatarSrc(species: AvatarSpecies, tier: number): string {
  return `/pocket-money/avatars/${species}-${tier}.svg`;
}
