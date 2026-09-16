/**
 * How a photo should be drawn into a space that is not its shape. RFC-009 §3.4.
 *
 * Every photo surface used to be `object-cover`, which is the right default and
 * the wrong absolute: a 16:9 wall panel cropped a portrait phone photo to its
 * middle third. `contain` everywhere is not the fix either — it letterboxes a
 * perfectly ordinary 4:3 holiday picture on a television for no reason.
 *
 * So: fill the screen while the two shapes roughly agree, and stop cropping
 * once they plainly do not.
 */

export type PhotoFit = "cover" | "contain";

/**
 * How far apart the two aspect ratios may be before cropping stops being
 * worth it, as a fraction of the smaller over the larger.
 *
 * 0.6 puts the boundary between "4:3 on 16:9" (0.75, still filled — a normal
 * photograph on a normal screen) and "1:1 on 16:9" (0.5625, contained —
 * covering it would discard about 44% of the height). Portrait-on-landscape,
 * the case this exists for, comes out at 0.42 or lower.
 */
const AGREEMENT_THRESHOLD = 0.6;

/** A usable aspect ratio from stored dimensions, or null when there isn't one. */
export function aspectOf(
  width: number | null | undefined,
  height: number | null | undefined,
): number | null {
  if (!width || !height) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return width / height;
}

export function choosePhotoFit(photoAspect: number, containerAspect: number): PhotoFit {
  // A source that cannot say how big its photos are keeps the behaviour it has
  // always had, rather than being letterboxed on the strength of a zero.
  if (!Number.isFinite(photoAspect) || !Number.isFinite(containerAspect)) return "cover";
  if (photoAspect <= 0 || containerAspect <= 0) return "cover";

  // Smaller over larger, so the answer does not depend on which way round the
  // mismatch runs — a portrait photo on a landscape panel and a landscape
  // photo on a portrait kiosk are the same problem.
  const ratio = photoAspect / containerAspect;
  const agreement = Math.min(ratio, 1 / ratio);

  return agreement >= AGREEMENT_THRESHOLD ? "cover" : "contain";
}
