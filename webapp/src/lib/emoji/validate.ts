/**
 * Is this one emoji an icon may be? (task icons, reward icons)
 *
 * One grapheme -- Intl.Segmenter, so a long ZWJ sequence (a family, a kiss
 * with two skin tones), a keycap or a skin-tone variant counts as the one
 * emoji it is, and "🍦🍦" or "TV" do not -- and a member of the set the picker
 * is built from (emoji-set.json, scripts/generate-emoji-data.mjs): Unicode's
 * emoji up to the version the picker offers, without flags or bare
 * components. It must be the emoji, not the text character it is built on:
 * "🗑️" passes and "🗑" (text by default, no U+FE0F) does not; a selector an
 * emoji does not need is dropped. canonicalEmoji() answers with the fully
 * qualified form the set holds, which is what gets stored.
 *
 * Server-side only: the set is ~47 KB. The picker never needs it -- it offers
 * nothing else.
 */

import EMOJI from "./emoji-set.json";

/** The emoji without variation selectors. */
export function bareEmoji(value: string): string {
  return value.replace(/[\uFE0E\uFE0F]/g, "");
}

/** Bare form (no variation selectors) to the fully qualified emoji. */
const BY_BARE: ReadonlyMap<string, string> = new Map((EMOJI as string[]).map((e) => [bareEmoji(e), e]));

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;

/** Exactly one grapheme. */
export function isOneGrapheme(value: string): boolean {
  if (!value) return false;
  if (!segmenter) return [...value].length === 1;
  let n = 0;
  for (const _ of segmenter.segment(value)) if (++n > 1) return false;
  return n === 1;
}

/** The emoji as stored (fully qualified), or null when the value is not exactly one emoji of the set. */
export function canonicalEmoji(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v !== value || !isOneGrapheme(v)) return null;
  const canonical = BY_BARE.get(bareEmoji(v));
  if (!canonical) return null;
  // A selector the emoji needs must be there: "©" and "🗑" alone are text,
  // "©️" and "🗑️" the emoji. One it does not need ("📚" + U+FE0F) is dropped.
  const selectors = (s: string) => s.match(/\uFE0F/g)?.length ?? 0;
  return selectors(v) >= selectors(canonical) ? canonical : null;
}

export function isEmojiIcon(value: unknown): value is string {
  return canonicalEmoji(value) !== null;
}

/** How many emoji the set holds (for tests). */
export const EMOJI_COUNT = BY_BARE.size;
