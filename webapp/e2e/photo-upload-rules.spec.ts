import { test, expect } from "@playwright/test";
import {
  checkPhotoUpload,
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
} from "../src/lib/photo-upload-rules";

/** RFC-009 §5. What the upload route accepts, and what it says when it won't. */

test("an ordinary jpeg is accepted", () => {
  expect(checkPhotoUpload({ type: "image/jpeg", size: 3_000_000 })).toEqual({ ok: true });
});

test("a file over the size cap is refused, and says the cap", () => {
  const result = checkPhotoUpload({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 });
  if (result.ok || result.reason !== "size") throw new Error("expected a size rejection");
  expect(result.maxBytes).toBe(MAX_PHOTO_BYTES);
  expect(result.size).toBe(MAX_PHOTO_BYTES + 1);
});

test("a file exactly at the cap is accepted — the boundary is inclusive", () => {
  expect(checkPhotoUpload({ type: "image/jpeg", size: MAX_PHOTO_BYTES })).toEqual({ ok: true });
});

test("HEIC is refused by name, not as a generic failure", () => {
  // iPhones shoot HEIC by default and sharp's prebuilt binaries usually
  // cannot decode it. Telling somebody "invalid file" about every photo on
  // their phone is the difference between a limitation and a broken feature.
  const result = checkPhotoUpload({ type: "image/heic", size: 2_000_000 });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.reason).toBe("heic");
});

test("heif is treated as the same case as heic", () => {
  const result = checkPhotoUpload({ type: "image/heif", size: 2_000_000 });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.reason).toBe("heic");
});

test("something that is not an image at all is refused as a type", () => {
  const result = checkPhotoUpload({ type: "application/pdf", size: 1000 });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.reason).toBe("type");
});

test("a disguised upload is judged on its declared type, not its name", () => {
  // The route never sees a trustworthy filename; type is what it gates on.
  const result = checkPhotoUpload({ type: "text/html", size: 500 });
  expect(result.ok).toBe(false);
});

test("an empty file is refused rather than stored as a zero-byte photo", () => {
  const result = checkPhotoUpload({ type: "image/jpeg", size: 0 });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.reason).toBe("empty");
});

test("the accepted list is exactly what sharp can be relied on to read", () => {
  expect(ACCEPTED_PHOTO_TYPES).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif"]);
});
