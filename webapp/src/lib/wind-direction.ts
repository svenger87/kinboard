/** The eight compass points, clockwise from north; the keys of `weather.compass.*`. */
export const COMPASS_POINTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/**
 * The compass point a meteorological direction names: where the wind comes
 * FROM, degrees clockwise from north, as OpenWeatherMap's `wind.deg` gives it.
 * 350° and 10° are both north; null for a missing or non-finite value.
 */
export function compassPoint(deg: number | undefined | null): CompassPoint | null {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
  const normalised = ((deg % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalised / 45) % 8];
}

/**
 * The rotation for an up-pointing arrow so it points the way the wind blows:
 * downwind, opposite to where it comes from. A north wind (0°) blows south, so
 * the arrow turns 180°. This is how weather maps and apps draw it.
 */
export function windArrowRotation(deg: number): number {
  return (((deg + 180) % 360) + 360) % 360;
}
