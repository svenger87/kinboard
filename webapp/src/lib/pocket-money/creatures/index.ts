/**
 * Drawn avatars: which species have art, and the one question every screen
 * asks -- draw this, or show the classic picture?
 *
 * A species without a module here (astronaut, plant, wizard for now) shows
 * its classic SVG whatever style is stored, so a style chosen today keeps
 * working the day its drawings arrive.
 *
 * The other way round, the creatures added with the workshop (rex, unicorn,
 * princess, ...) have no classic pictures at all. For them "classic" means
 * their Gumdrop drawing, standing still: Classic has always been the still
 * picture, and that is what it stays (see classicIsDrawn()).
 */

import type { AvatarSpecies } from "../types";
import { axolotl } from "./axolotl";
import { bunny } from "./bunny";
import { cat } from "./cat";
import { dragon } from "./dragon";
import { fox } from "./fox";
import { owl } from "./owl";
import { penguin } from "./penguin";
import { prince } from "./prince";
import { princess } from "./princess";
import { rex } from "./rex";
import { robot } from "./robot";
import { stego } from "./stego";
import { trike } from "./trike";
import { unicorn } from "./unicorn";
import type { SpeciesArt } from "./skeleton";
import { hasClassicArt } from "./catalog";
import { isDrawnStyle, type AvatarStyle, type DrawnStyle } from "./styles";

export * from "./styles";
export * from "./catalog";
export { drawCreature, resolveStyle, type CreatureLook, type CreatureMood, type OriginKind, type SpeciesArt } from "./skeleton";

const DRAWN_SPECIES: Readonly<Record<string, SpeciesArt>> = {
  dragon,
  cat,
  axolotl,
  owl,
  robot,
  unicorn,
  fox,
  penguin,
  bunny,
  rex,
  trike,
  stego,
  princess,
  prince,
};

/** Every species drawn in code, in the workshop's order. */
export const DRAWN_SPECIES_IDS: ReadonlyArray<string> = Object.keys(DRAWN_SPECIES);


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

/**
 * Classic, for a species that only exists drawn: its Gumdrop drawing, still.
 * True when the style shown is classic and there is no picture to show.
 */
export function classicIsDrawn(species: AvatarSpecies, style: AvatarStyle | string | null | undefined): boolean {
  return effectiveStyle(species, style) === "classic" && !hasClassicArt(species) && hasDrawnArt(species);
}

/** The classic picture for a species and stage. */
export function classicAvatarSrc(species: AvatarSpecies, tier: number): string {
  return `/pocket-money/avatars/${species}-${tier}.svg`;
}
