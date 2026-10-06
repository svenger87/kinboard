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
