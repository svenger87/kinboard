/**
 * Deep-merge `override` onto `base`, returning a new object of `base`'s shape.
 * Leaf values from `override` win; keys present only in `base` are kept. Used to
 * overlay a locale's messages on top of English so any untranslated key falls
 * back to the English string instead of rendering as a missing-key error.
 *
 * Message bundles contain only nested objects and string leaves (no arrays).
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>
): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      out[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
