/**
 * Random photos from an Immich library — what /api/immich/photos shows when
 * no album is picked (the dashboard widget and the photo viewer).
 *
 * How Immich hands out random assets, from its own OpenAPI spec
 * (open-api/immich-openapi-specs.json at each tag):
 *
 *   - POST /api/search/random, body `{ size, type, ... }`: added in v1.116.0
 *     (immich#12741), present in every version since, up to v3.4.1. `size` is
 *     1..1000. v1.116.0 alone answered with a search result
 *     (`{ assets: { items } }`); from v1.117.0 it is a plain array. v3.2.0
 *     marks `type` deprecated in favour of `filter`, but still honours it.
 *   - GET /api/assets/random?count=: the older way, deprecated in v1.116.0
 *     and removed in v3.0.0 (immich#27780).
 *   - POST /api/search/metadata sorts by `order`, which is only ever
 *     `asc` or `desc` — never random, so it is no substitute.
 *
 * There has never been a GET /api/search/random, which is what the route
 * asked for until now: every Immich answered 404, the route passed the 404
 * on, and the Photos card, the Photos page and the Photos entry in the bar
 * all came up empty.
 *
 * So: one POST /api/search/random asking for images only, which every Immich
 * from v1.116 on understands. Only when that endpoint does not exist (404 or
 * 405, an Immich older than v1.116) is GET /api/assets/random tried. Anything
 * else that goes wrong gives no photos and a log line, never an error page —
 * and the library is never paged.
 */

import type { ImmichAsset } from "./album-assets";

/** Immich's own ceiling for `size` on search/random. */
export const MAX_RANDOM_ASSETS = 1000;

/** What to ask for when the caller set no limit — Immich's own default since v3.2. */
export const DEFAULT_RANDOM_ASSETS = 250;

const TIMEOUT_MS = 20_000;

/** How many random assets to ask Immich for, given the route's `limit` (0 = none). */
export function randomAssetCount(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_RANDOM_ASSETS;
  return Math.min(Math.floor(limit), MAX_RANDOM_ASSETS);
}

function assetsFrom(body: unknown): ImmichAsset[] | null {
  if (Array.isArray(body)) return body as ImmichAsset[];
  // v1.116.0 answered search/random with a search result.
  const items = (body as { assets?: { items?: unknown } } | null)?.assets?.items;
  return Array.isArray(items) ? (items as ImmichAsset[]) : null;
}

export async function readImmichRandomAssets(
  baseUrl: string,
  apiKey: string,
  count: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ImmichAsset[]> {
  const headers = { "x-api-key": apiKey, Accept: "application/json" };
  const size = randomAssetCount(count);

  try {
    const response = await fetchImpl(`${baseUrl}/api/search/random`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ size, type: "IMAGE" }),
    });

    if (response.ok) {
      const assets = assetsFrom(await response.json());
      if (assets) return assets.filter((asset) => asset.type === "IMAGE");
      console.error("Immich: search/random answered in a shape Kinboard does not know; showing no random photos");
      return [];
    }

    if (response.status !== 404 && response.status !== 405) {
      console.error(`Immich: random photos could not be read (search/random, HTTP ${response.status}); showing none`);
      return [];
    }

    // No search/random: an Immich older than v1.116. assets/random cannot be
    // told to leave videos out, so ask for twice as many and keep the images.
    const legacy = await fetchImpl(`${baseUrl}/api/assets/random?count=${Math.min(size * 2, MAX_RANDOM_ASSETS)}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!legacy.ok) {
      console.error(
        `Immich: this server has neither search/random (HTTP ${response.status}) nor assets/random ` +
          `(HTTP ${legacy.status}); showing no random photos`,
      );
      return [];
    }
    const assets = assetsFrom(await legacy.json());
    return (assets ?? []).filter((asset) => asset.type === "IMAGE").slice(0, size);
  } catch (err) {
    console.error("Immich: random photos could not be read; showing none:", err);
    return [];
  }
}
