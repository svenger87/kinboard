// Photos handed out recently, per family, newest last. The random endpoint
// draws from a limited set of top matches per term, so without this the
// same pictures come back hour after hour. Kept in memory: a restart just
// forgets, which costs a few repeats and nothing else. Around five hours
// of fetches at ~60 photos each.
const RECENT_LIMIT = 300;
const recentlyShown = new Map<string, string[]>();

export function recentPhotoIds(familyId: string): Set<string> {
  return new Set(recentlyShown.get(familyId) ?? []);
}

export function rememberPhotos(familyId: string, ids: string[]): void {
  const list = [...(recentlyShown.get(familyId) ?? []), ...ids];
  recentlyShown.set(familyId, list.slice(-RECENT_LIMIT));
}

/**
 * Prefer photos not handed out recently. When a month's terms are too
 * narrow to fill the pool with new ones, recent photos make up the rest:
 * a repeat beats a screensaver cycling five pictures.
 */
export function preferFresh<T extends { id: string }>(
  photos: T[],
  recent: ReadonlySet<string>,
  minPool: number,
): T[] {
  const fresh = photos.filter((p) => !recent.has(p.id));
  if (fresh.length >= minPool) return fresh;
  const stale = photos.filter((p) => recent.has(p.id));
  return [...fresh, ...stale.slice(0, minPool - fresh.length)];
}
