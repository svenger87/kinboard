/**
 * How a child's avatar is drawn (pocket_money_accounts.avatar_style).
 *
 * "classic" is the static SVG set in public/pocket-money/avatars/, and the
 * default: an account that never chose keeps looking exactly as before. The
 * other three are drawn in code by ./skeleton.tsx and a species module, and
 * only swap colours, outlines and lighting -- the shapes are the species'.
 *
 * The palettes are the approved prototype's, unchanged.
 */

export const AVATAR_STYLES = ["classic", "gumdrop", "sticker", "storybook"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

/** The styles drawn in code: every style but classic. */
export type DrawnStyle = Exclude<AvatarStyle, "classic">;
export const DRAWN_STYLES: ReadonlyArray<DrawnStyle> = ["gumdrop", "sticker", "storybook"];

export function isAvatarStyle(value: unknown): value is AvatarStyle {
  return typeof value === "string" && (AVATAR_STYLES as ReadonlyArray<string>).includes(value);
}

/** A stored style as a restore should write it: one of the four, or classic. */
export function restorableAvatarStyle(value: unknown): AvatarStyle {
  return isAvatarStyle(value) ? value : "classic";
}

export function isDrawnStyle(value: unknown): value is DrawnStyle {
  return typeof value === "string" && (DRAWN_STYLES as ReadonlyArray<string>).includes(value);
}

export interface Palette {
  body: string;
  /** Storybook only: the near stop of the body's radial gradient (the body colour when unset). */
  bodyHi?: string;
  /** Storybook only: the far stop of the body's radial gradient. */
  body2?: string;
  belly: string;
  wing: string;
  wingIn: string;
  horn: string;
  spot: string;
  cheek: string;
  eye: string;
  shell: string;
  shellSpot: string;
  /** The creature's third colour: ears, mane, crest, gills, a scarf. */
  accent?: string;
  /** People only: skin tone and hair colour. */
  skin?: string;
  hair?: string;
}

export interface StyleSpec {
  pal: Palette;
  /** Outline colour, or null for no outlines. */
  stroke: string | null;
  /** A white sticker edge and a soft drop shadow around the whole creature. */
  sticker: boolean;
  /** A gradient body, a warm glow behind and a few stars. */
  glow: boolean;
}

export const STYLES: Record<DrawnStyle, StyleSpec> = {
  // Soft, round shapes with no outlines. Reads well from across the kitchen.
  gumdrop: {
    pal: { body: "#6FCF97", belly: "#FFF4C7", wing: "#56B6E8", wingIn: "#9AD7F5", horn: "#FFC857", spot: "#3FA877", cheek: "#FF8FA3", eye: "#2A2438", shell: "#FFF7E3", shellSpot: "#9BDDB8" },
    stroke: null,
    sticker: false,
    glow: false,
  },
  // Thick outlines and a white sticker edge, like a collectible. The
  // strongest at small sizes.
  sticker: {
    pal: { body: "#FF8A5B", belly: "#FFE3B8", wing: "#FFB547", wingIn: "#FFD68A", horn: "#FFF1D6", spot: "#E8613A", cheek: "#FF5C8A", eye: "#2B2340", shell: "#FFFDF6", shellSpot: "#FFB08E" },
    stroke: "#2B2340",
    sticker: true,
    glow: false,
  },
  // Soft gradients, a gentle glow and a few stars, closest to a picture book.
  storybook: {
    pal: { body: "#8C7AE6", body2: "#5B4BC4", belly: "#F2E9FF", wing: "#F6A6D7", wingIn: "#FBD3EC", horn: "#FFE08A", spot: "#B9AEF5", cheek: "#FF9FC7", eye: "#231B45", shell: "#EEE9FF", shellSpot: "#C7BDF7" },
    stroke: null,
    sticker: false,
    glow: true,
  },
};

// ---------------------------------------------------------------------------
// A creature's own colours
// ---------------------------------------------------------------------------

/**
 * The colours a creature is drawn in whatever the style: the workshop's
 * creatures (all but the dragon, which keeps a palette per style) have their
 * own body, tummy and accent, and the style only changes outlines, the
 * sticker edge and the lighting. A person has a skin tone and a hair colour
 * instead of an accent.
 */
export interface SpeciesColors {
  body: string;
  belly: string;
  accent: string;
  skin?: string;
  hair?: string;
}

const EYE = "#2A2438";
const CHEEK = "#FF8FA3";
const HORN = "#FFC857";
const SHELL = "#FFF7E3";

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
const toHex = (v: number[]) => "#" + v.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();

/** Darker by a fraction (the workshop's shade()). */
export function shade(hex: string, f: number): string {
  return toHex(channels(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * (1 - f))))));
}

/** Lighter by a fraction, towards white (the workshop's tint()). */
export function tint(hex: string, f: number): string {
  return toHex(channels(hex).map((v) => Math.round(v + (255 - v) * f)));
}

/** A whole palette from a creature's own colours, as the workshop derives it. */
export function paletteFromColors(c: SpeciesColors): Palette {
  return {
    body: c.body,
    bodyHi: tint(c.body, 0.12),
    body2: shade(c.body, 0.32),
    belly: c.belly,
    wing: c.accent,
    wingIn: tint(c.accent, 0.45),
    horn: HORN,
    spot: shade(c.body, 0.22),
    cheek: CHEEK,
    eye: EYE,
    shell: SHELL,
    shellSpot: tint(c.accent, 0.45),
    accent: c.accent,
    skin: c.skin,
    hair: c.hair,
  };
}
