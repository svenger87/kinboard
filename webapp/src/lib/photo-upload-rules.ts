/**
 * What the photo library accepts. RFC-009 §5.
 *
 * Separate from the route so the browser can refuse a file before spending a
 * minute uploading it, and so the boundaries are testable without a request.
 */

/**
 * Formats `sharp` can be relied on to decode in the builds we ship.
 *
 * Deliberately not HEIC: see `checkPhotoUpload`.
 */
export const ACCEPTED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

/**
 * 25MB. Comfortably above a 12MP phone photo and a 45MP raw-ish JPEG, well
 * below the point where one upload stalls a wall panel on domestic wifi.
 * Larger than the 5MB the recipe bucket allows, because that one holds a
 * thumbnail of a dinner and this one holds the photographs themselves.
 */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

export type PhotoUploadCheck =
  | { ok: true }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "heic"; type: string }
  | { ok: false; reason: "type"; type: string; accepted: readonly string[] }
  | { ok: false; reason: "size"; size: number; maxBytes: number };

export function checkPhotoUpload(file: { type: string; size: number }): PhotoUploadCheck {
  if (!file.size) return { ok: false, reason: "empty" };

  // HEIC gets its own answer rather than falling into "unsupported type".
  // iPhones shoot it by default, so for a large share of the people who asked
  // for this feature it is not an edge case but every photo they own — and
  // "invalid file type" would read as Kinboard being broken rather than as a
  // format it cannot yet read.
  if (HEIC_TYPES.includes(file.type)) {
    return { ok: false, reason: "heic", type: file.type };
  }

  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "type", type: file.type, accepted: ACCEPTED_PHOTO_TYPES };
  }

  // Inclusive: a file of exactly the advertised maximum is not "too large".
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, reason: "size", size: file.size, maxBytes: MAX_PHOTO_BYTES };
  }

  return { ok: true };
}
