/**
 * Per-person color helpers for the redesign.
 *
 * Person colors are arbitrary hex strings stored on `people.color`, so they
 * cannot be expressed as Tailwind accent tokens. We mix them with `transparent`
 * (for tinted backgrounds) or `black` (for darkened text) via CSS `color-mix`,
 * emitting strings meant for an inline `style` prop. Used by PersonAvatar,
 * PersonChip, EventPill, ChecklistItem, TodayStripPill.
 */

/** Faint background tint, ~12% of the color over transparent. */
export function personTint(hex: string, transparentPct = 88): string {
  return `color-mix(in srgb, ${hex}, transparent ${transparentPct}%)`;
}

/** Slightly stronger background tint, ~16% — used by EventPill. */
export function personStrongTint(hex: string, transparentPct = 84): string {
  return `color-mix(in srgb, ${hex}, transparent ${transparentPct}%)`;
}

/** Darkened text color (mix toward black) for legibility on a tinted bg. */
export function personText(hex: string, blackPct = 18): string {
  return `color-mix(in srgb, ${hex}, black ${blackPct}%)`;
}

/**
 * Curated default person palette (Salbei / Leinen redesign). Hex values match
 * the `--person-*` tokens in globals.css. `key` is a stable identifier used for
 * i18n labels (messages → `personColor.<key>`) and as a React list key.
 */
export interface PersonColor {
  key: string;
  hex: string;
}

export const PERSON_COLORS: readonly PersonColor[] = [
  { key: "coral", hex: "#E2664E" },
  { key: "amber", hex: "#D98A2B" },
  { key: "citron", hex: "#8E9B36" },
  { key: "forest", hex: "#3FA56B" },
  { key: "teal", hex: "#2E9BA6" },
  { key: "sky", hex: "#4A8FD6" },
  { key: "indigo", hex: "#6E72C9" },
  { key: "lilac", hex: "#A968C4" },
  { key: "berry", hex: "#D667A0" },
  { key: "clay", hex: "#B07B53" },
] as const;
