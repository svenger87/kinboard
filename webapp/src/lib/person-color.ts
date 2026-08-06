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

/**
 * Person colour rendered as *text*, legible in both themes.
 *
 * This used to mix a fixed 18% toward black regardless of theme, which is
 * exactly backwards in dark mode: it moved the text toward the background.
 * Measured across the palette it landed at 2.1-3.4:1 on a dark card (audit
 * KB-09). The mix target and amount now come from CSS variables that flip with
 * the theme, so no component needs to know which theme is active.
 *
 * The amounts (38% toward black in light, 28% toward white in dark) were
 * derived by computing the worst case across all ten palette colours against a
 * 16% tint of the same hue; 34%/20% are the minimums that clear 4.5:1, and the
 * shipped values carry headroom for custom colours outside the palette.
 */
export function personText(hex: string): string {
  return `color-mix(in srgb, ${hex}, var(--person-text-mix) var(--person-text-amount))`;
}

/**
 * Black or white, whichever is legible ON an opaque fill of `hex` — for text
 * sitting directly on a person's colour, as avatar initials do.
 *
 * PersonAvatar hard-coded `text-white`, which measured 2.15:1 on the seeded
 * amber and fails for every colour in the curated palette (audit KB-09).
 * Choosing by relative luminance gives at worst 4.91:1 across the palette.
 */
export function personOn(hex: string): string {
  const m = hex.trim().replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // contrast against black is (L+0.05)/0.05; against white 1.05/(L+0.05)
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#ffffff";
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

/**
 * The palette key for a stored hex, or null for a colour outside the palette.
 * People are shown the colour's *name*; the hex is a storage detail and was
 * being rendered verbatim on a family-facing screen (audit KB-16).
 */
export function personColorKey(hex: string): string | null {
  const target = hex.trim().toLowerCase();
  return PERSON_COLORS.find((c) => c.hex.toLowerCase() === target)?.key ?? null;
}
