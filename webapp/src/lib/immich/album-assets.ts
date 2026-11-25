/**
 * The assets of one Immich album — the one place the dashboard widget, the
 * photo viewer and the screensaver read an album from (via
 * /api/immich/photos).
 *
 * Immich has changed how an album's contents are reached:
 *
 *   - Up to v2.x, GET /api/albums/{id} lists the album's `assets[]`.
 *   - v3.0.0 removed that field (immich#27835, "chore!: remove without
 *     assets"); the v3 migration guide sends clients to
 *     POST /api/search/metadata instead.
 *   - search/metadata filters by album with `albumIds: string[]`, available
 *     since v1.135.0. v3.2.0 deprecated it (with `page` and `type`) in favour
 *     of `filter`/`cursor`, but v3.4 still honours it.
 *
 * What made #536 is that this code asked search/metadata for `albumId`, a
 * field Immich has never had. Immich drops fields it does not know instead of
 * rejecting the request, so the "album" search was a search of the entire
 * library, paged to its end: 75,180 assets for a 12-photo album. That path
 * only ran when the album details came without assets, which became every
 * time with v3.
 *
 * A search is now only believed while it stays inside the album's own
 * `assetCount`. More than that and the server cannot have applied the album
 * filter, so the answer is the album's own list if it gave one, or nothing —
 * never the library.
 */

export interface ImmichAsset {
  id: string;
  type: string;
  originalFileName: string;
  localDateTime: string;
  isFavorite: boolean;
}

/** Immich's own ceiling for `size` on search/metadata. */
const PAGE_SIZE = 1000;

/**
 * Enough for any album someone means as a slideshow, and a bound on how long
 * one request can keep a server busy. The screensaver shuffles what it gets.
 */
export const MAX_ALBUM_ASSETS = 10_000;

const TIMEOUT_MS = 20_000;

export async function readImmichAlbumAssets(
  baseUrl: string,
  apiKey: string,
  albumId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImmichAsset[]> {
  const headers = { "x-api-key": apiKey, Accept: "application/json" };

  const albumResponse = await fetchImpl(`${baseUrl}/api/albums/${encodeURIComponent(albumId)}`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!albumResponse.ok) {
    // `${albumId}` is interpolated as a value, not a format specifier.
    console.error(`Immich: album ${albumId} could not be read (HTTP ${albumResponse.status}); showing no photos from it`);
    return [];
  }

  const album = (await albumResponse.json()) as {
    albumName?: string;
    assetCount?: number;
    assets?: ImmichAsset[];
  };
  const assetCount = typeof album.assetCount === "number" ? album.assetCount : 0;
  const listed = Array.isArray(album.assets) ? album.assets : null;

  // v1/v2: the details list the whole album.
  if (listed && listed.length >= assetCount) return listed;
  if (assetCount === 0) return listed ?? [];

  // v3 (or a v1/v2 list that fell short): search the album.
  const wanted = Math.min(assetCount, MAX_ALBUM_ASSETS);
  const found: ImmichAsset[] = [];
  const maxPages = Math.ceil(wanted / PAGE_SIZE);

  for (let page = 1; page <= maxPages; page++) {
    const searchResponse = await fetchImpl(`${baseUrl}/api/search/metadata`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ albumIds: [albumId], type: "IMAGE", page, size: PAGE_SIZE }),
    });

    if (!searchResponse.ok) {
      console.error(
        `Immich: searching album ${albumId} failed (HTTP ${searchResponse.status}); ` +
          (listed ? `using the ${listed.length} assets the album details listed` : "showing no photos from it"),
      );
      return listed ?? [];
    }

    const data = (await searchResponse.json()) as { assets?: { items?: ImmichAsset[]; total?: number } };
    const items = data.assets?.items ?? [];
    const total = data.assets?.total;

    // An album search can never match more than the album holds. If it does,
    // the server ignored `albumIds` (Immich before v1.135, or one that has
    // since removed it) and this is the library.
    if (found.length + items.length > assetCount || (typeof total === "number" && total > assetCount)) {
      console.error(
        `Immich: the search for album ${albumId} ("${album.albumName ?? "?"}", ${assetCount} assets) ` +
          `returned more than the album holds, so this server did not apply the album filter. ` +
          (listed ? `Using the ${listed.length} assets the album details listed.` : "Showing no photos rather than the whole library."),
      );
      return listed ?? [];
    }

    found.push(...items);
    if (items.length < PAGE_SIZE) break;
  }

  if (assetCount > MAX_ALBUM_ASSETS) {
    console.warn(`Immich: album ${albumId} holds ${assetCount} assets; read the first ${found.length}`);
  }
  return found.length > 0 ? found : (listed ?? []);
}
