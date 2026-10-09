import { placeFromPhoton, type LocationResult, type PhotonFeature } from "@/lib/location-search";

/**
 * Kinboard's side of the Location field's place search: the request to Photon,
 * made from the server rather than the browser.
 *
 * From the server, Kinboard can do what a public geocoder asks of a client and
 * a browser cannot:
 *
 *   - say who it is. Browsers drop a page's User-Agent header, so a request
 *     from the field reached the service as an anonymous browser;
 *   - answer a repeated search from its cache. A household types the same
 *     dentist, school and grandparents' street over and over, and every pause
 *     in typing used to be a fresh request;
 *   - share one in-flight request between screens asking the same thing.
 *
 * PHOTON_URL points it at another Photon, a self-hosted one say; the default is
 * komoot's public instance, which asks only that use stays reasonable.
 */

export const DEFAULT_PHOTON_URL = "https://photon.komoot.io";
const USER_AGENT = "Kinboard (+https://github.com/svenger87/kinboard)";
const TIMEOUT_MS = 5_000;

/** Search answers change rarely; a day keeps a household's repeats local. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Bounded so a busy install cannot grow it without limit: oldest out first. */
const CACHE_MAX = 500;

export class PhotonError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PhotonError";
  }
}

/** The configured Photon's base URL, without a trailing slash; the public one by default. */
export function photonBaseUrl(env: string | undefined = process.env.PHOTON_URL): string {
  const value = env?.trim();
  if (!value) return DEFAULT_PHOTON_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_PHOTON_URL;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_PHOTON_URL;
  }
}

const cache = new Map<string, { at: number; results: LocationResult[] }>();
const inFlight = new Map<string, Promise<LocationResult[]>>();

/** For tests: start from an empty cache. */
export function clearPhotonCache(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * The places Photon finds for `params` (built by photonSearchParams), from the
 * cache when the same search was made within the last day.
 */
export async function searchPhoton(
  params: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<LocationResult[]> {
  const query = new URLSearchParams([...params.entries()].sort(([a], [b]) => a.localeCompare(b))).toString();
  const url = `${photonBaseUrl()}/api/?${query}`;

  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    // Refresh its place in the eviction order.
    cache.delete(url);
    cache.set(url, hit);
    return hit.results;
  }

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new PhotonError(`Photon answered ${response.status}`, response.status);
    const body = (await response.json()) as { features?: PhotonFeature[] };
    const results = (body.features ?? []).map(placeFromPhoton).filter((r): r is LocationResult => r !== null);

    cache.set(url, { at: now, results });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return results;
  })();

  inFlight.set(url, request);
  try {
    return await request;
  } finally {
    inFlight.delete(url);
  }
}
