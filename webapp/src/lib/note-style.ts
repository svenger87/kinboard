/**
 * Presentational sticky-note styling for the Notes board (Salbei/Leinen redesign).
 *
 * The `notes` table only stores { id, family_id, content, created_at, updated_at }
 * (+ an untyped `pinned` column). There is NO per-note color or rotation column,
 * and adding one is out of scope for a visual redesign (would need a DB migration).
 * So we DERIVE a stable warm-pastel tint + a small rotation deterministically from
 * the note id: same id always yields the same look, with no persistence required.
 *
 * Tints are returned as CSS color strings (warm soft pastels). They are mixed with
 * `transparent` so they sit gently over the page background and read in both light
 * and dark mode. Consumers apply them via an inline `backgroundColor` style.
 */

/** Warm-pastel base hues (HSL). Soft, family-friendly, deliberately low-chroma. */
const NOTE_HUES: readonly { h: number; s: number; l: number }[] = [
  { h: 45, s: 70, l: 72 }, // butter
  { h: 18, s: 65, l: 74 }, // peach
  { h: 340, s: 55, l: 78 }, // rose
  { h: 90, s: 45, l: 72 }, // sage-lime
  { h: 200, s: 55, l: 76 }, // sky
  { h: 280, s: 45, l: 80 }, // lilac
] as const;

/** djb2-style string hash → unsigned 32-bit int. Deterministic and dependency-free. */
function hashId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 33) ^ id.charCodeAt(i);
  }
  return hash >>> 0;
}

export interface NoteStyle {
  /** Background color string (mixes the pastel with transparent for theme blending). */
  tintVar: string;
  /** Rotation in degrees, in [-1.5, 1.4]. */
  rotateDeg: number;
}

/**
 * Deterministic per-note presentational style. Stable for a given id.
 * - tint: one of NOTE_HUES, mixed ~45% with transparent so it tints rather than blocks.
 * - rotation: spread across [-1.5deg, 1.4deg] derived from a second hash slice.
 */
export function noteStyle(id: string): NoteStyle {
  const h = hashId(id);
  const hue = NOTE_HUES[h % NOTE_HUES.length];
  // Rotation: map another slice of the hash to [-1.5, 1.4].
  const rotBucket = (h >> 8) % 30; // 0..29
  const rotateDeg = Math.round((-1.5 + (rotBucket / 29) * 2.9) * 10) / 10;
  const tintVar = `color-mix(in srgb, hsl(${hue.h} ${hue.s}% ${hue.l}%), transparent 45%)`;
  return { tintVar, rotateDeg };
}
