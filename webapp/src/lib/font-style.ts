/**
 * The font styles a family can pick (Settings → Design → Font style): each
 * is a display + text pairing. The choice is a family setting of its own
 * (`font_style`, `{ style }`); hooks/use-font-style.ts lands it on <body>
 * as `data-font-style`, and globals.css points --font-display / --font-sans
 * at the picked pair's variables (src/app/fonts.ts). The mono face stays
 * Space Mono in every style.
 */
export type FontStyleId = "classic" | "rounded" | "clean" | "serif";

export interface FontStyleSettings {
  style: FontStyleId;
}

/** What a family that never touched the setting gets: the original pairing. */
export const DEFAULT_FONT_STYLE_SETTINGS: FontStyleSettings = { style: "classic" };

export interface FontStyle {
  id: FontStyleId;
  /** The style's display-face variable (src/app/fonts.ts). */
  displayVariable: string;
  /** The style's text-face variable. Serif reuses the classic text face. */
  sansVariable: string;
  /** The pairing's typeface names, shown under the style's name in the picker. */
  pairing: string;
}

export const FONT_STYLES: readonly FontStyle[] = [
  {
    id: "classic",
    displayVariable: "--font-display-classic",
    sansVariable: "--font-sans-classic",
    pairing: "Bricolage Grotesque · Hanken Grotesk",
  },
  {
    id: "rounded",
    displayVariable: "--font-display-rounded",
    sansVariable: "--font-sans-rounded",
    pairing: "Fredoka · Quicksand",
  },
  {
    id: "clean",
    displayVariable: "--font-display-clean",
    sansVariable: "--font-sans-clean",
    pairing: "Inter",
  },
  {
    id: "serif",
    displayVariable: "--font-display-serif",
    sansVariable: "--font-sans-classic",
    pairing: "Fraunces · Hanken Grotesk",
  },
];

export function isFontStyleId(value: unknown): value is FontStyleId {
  return value === "classic" || value === "rounded" || value === "clean" || value === "serif";
}

/** The saved value's style, or classic for anything unusable. */
export function fontStyleOf(settings: FontStyleSettings | null | undefined): FontStyleId {
  return isFontStyleId(settings?.style) ? settings.style : "classic";
}
