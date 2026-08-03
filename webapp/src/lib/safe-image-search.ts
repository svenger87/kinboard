import { getMergedSetting } from "@/lib/integration-secrets";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/**
 * Image search for family-facing surfaces (shopping-list item photos,
 * pocket-money goal pictures).
 *
 * Kinboard runs on a kitchen wall that children use unsupervised. The
 * job here is not "find the best picture" — it is "never put something
 * on that screen that shouldn't be there, and don't silently degrade
 * into doing so". Everything below follows from that.
 *
 * ## What went wrong before
 *
 * The previous implementation scraped HTML search pages: Bing first,
 * DuckDuckGo as a fallback. Both failure modes bit at once.
 *
 *   - Bing was asked for images with **no SafeSearch parameter at all**,
 *     and it changed what it serves cookie-less scrapers. The request
 *     went from ~35 parseable results to ~1, so in practice every search
 *     fell through to the fallback.
 *   - The DuckDuckGo fallback depends on scraping a per-query `vqd`
 *     token out of a JavaScript shell page and replaying it against an
 *     undocumented JSON endpoint. When that token no longer corresponds
 *     to the query, the endpoint answers with results for *something
 *     else* — unrelated, unfiltered images.
 *
 * That combination is what put random and adult images on the shopping
 * page. Both scrapers are gone.
 *
 * ## What replaces them
 *
 * Documented JSON APIs only. None has a per-query token to go stale,
 * all return structured JSON, and a failure is a failure rather than a
 * silent switch to unfiltered content.
 *
 *   1. **Open Food Facts** (`mode: "product"`) — a community grocery
 *      database with real product front-of-pack photos. This is the
 *      right answer for a shopping list, and it is safe *by
 *      construction*: a food product database has no adult content to
 *      return, so safety doesn't depend on a classifier at all.
 *   2. **Unsplash** (`content_filter=high`) — only when the family has
 *      already configured an access key for the screensaver. Curated
 *      photography, best relevance for toys and general objects.
 *   3. **Openverse** (`mature=false`) — the WordPress Foundation's
 *      openly-licensed media index. No API key, so it always works, and
 *      it covers the non-grocery items Open Food Facts doesn't carry.
 *
 * Provider order is chosen per call by `mode`: a shopping-list lookup
 * wants a product shot, a pocket-money goal wants a nice picture of a
 * LEGO set.
 *
 * ## Rules
 *
 * - **Fail closed.** A provider that errors contributes nothing. There
 *   is deliberately no unfiltered source to fall back to; an empty state
 *   is a mild annoyance, unfiltered results are the bug being fixed.
 * - **Defence in depth.** Upstream safety filters are somebody else's
 *   classifier and they have off days, so results are additionally
 *   screened against a host and phrase denylist and must be https.
 * - **Kill switch.** `KINBOARD_IMAGE_SEARCH=off` disables web image
 *   search entirely without a redeploy.
 */

export interface SafeImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
}

export interface SafeImageSearchOptions {
  limit?: number;
  /** Enables the Unsplash provider when that family has a key stored. */
  familyId?: string;
  /**
   * `"product"` puts Open Food Facts first — use it for the shopping
   * list, where the useful answer is a photo of the actual packet.
   * `"general"` skips it — use it for pocket-money goals, which are
   * toys and games Open Food Facts doesn't carry.
   */
  mode?: "product" | "general";
}

const REQUEST_TIMEOUT_MS = 10_000;

const USER_AGENT =
  "Kinboard/1.x image search (+https://github.com/svenger87/kinboard)";

/**
 * Hosts that are never appropriate here — a backstop for when an
 * upstream filter misses something, not a comprehensive blocklist.
 * Matched on the domain suffix so subdomains are covered.
 */
const BLOCKED_HOST_SUFFIXES: ReadonlyArray<string> = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "redtube.com",
  "youporn.com",
  "xhamster.com",
  "onlyfans.com",
  "rule34.xxx",
  "e621.net",
  "nhentai.net",
  "4chan.org",
  "8kun.top",
  "kym-cdn.com",
  "knowyourmeme.com",
  "9gag.com",
  "ifunny.co",
  "memegenerator.net",
  "imgflip.com",
];

/** Disqualifying TLDs regardless of host. */
const BLOCKED_TLDS: ReadonlyArray<string> = [".xxx", ".adult", ".porn", ".sex"];

/**
 * Phrases that disqualify a result by title or source URL.
 *
 * Deliberately short and unambiguous. These run against grocery and toy
 * searches, so a broad list would reject legitimate results — "cock"
 * would eat cocktail glasses, "ass" would eat Kaffeetasse. Matched on
 * word boundaries for the same reason.
 */
const BLOCKED_PHRASES: ReadonlyArray<string> = [
  "porn",
  "porno",
  "nsfw",
  "xxx",
  "hentai",
  "nude",
  "nudes",
  "naked",
  "nackt",
  "erotic",
  "erotik",
  "fetish",
  "fetisch",
  "escort",
  "camgirl",
  "sexcam",
  "onlyfans",
  "boobs",
  "titten",
  "lingerie",
  "dessous",
  "sextoy",
  "sexspielzeug",
  "vibrator",
  "dildo",
  "meme",
  "memes",
];

// \p{L} rather than \w so accented letters count as word characters and
// "Sexcam" inside a German compound is still caught at a real boundary.
const BLOCKED_PHRASE_RE = new RegExp(
  `(^|[^\\p{L}])(${BLOCKED_PHRASES.join("|")})([^\\p{L}]|$)`,
  "iu",
);

/** Web image search turned off for this deployment. */
export function imageSearchDisabled(): boolean {
  return (process.env.KINBOARD_IMAGE_SEARCH ?? "").toLowerCase() === "off";
}

function isBlockedUrl(rawUrl: string): boolean {
  let host: string;
  try {
    const parsed = new URL(rawUrl);
    // https only: the app is served over https in any real deployment,
    // a mixed-content image would be blocked by the browser anyway, and
    // it removes a class of sketchy host for free.
    if (parsed.protocol !== "https:") return true;
    host = parsed.hostname.toLowerCase();
  } catch {
    return true;
  }

  if (BLOCKED_TLDS.some((tld) => host.endsWith(tld))) return true;
  return BLOCKED_HOST_SUFFIXES.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

/** Final gate every result passes before it can reach a screen. */
function isAllowed(result: SafeImageResult): boolean {
  if (isBlockedUrl(result.url)) return false;
  if (result.thumbnail && isBlockedUrl(result.thumbnail)) return false;
  return ![result.title, result.source].some(
    (value) => value && BLOCKED_PHRASE_RE.test(value),
  );
}

/**
 * Fold a string to bare lowercase letters and digits.
 *
 * Diacritics and punctuation are stripped so a search for "Loreal"
 * matches a product titled "L'Oréal", and "Spuelmittel" is at least in
 * the same shape as "Spülmittel".
 */
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The query tokens worth matching on.
 *
 * Tokens shorter than three characters are dropped — "of", "die", "3"
 * match everything and would make the relevance check meaningless.
 */
export function relevanceTokens(query: string): string[] {
  return normalizeForMatch(query)
    .split(" ")
    .filter((token) => token.length >= 3);
}

/**
 * Does this result plausibly answer the query?
 *
 * This is the check that would have caught the original incident. The
 * old DuckDuckGo fallback replayed a stale per-query token and got back
 * results for *something else entirely*; the sibling Open Food Facts
 * endpoints silently ignore `search_terms` and return the whole
 * database. Both failures look like success at the HTTP layer — a 200
 * with a full result set — and are only visible by asking whether the
 * results have anything to do with what was typed.
 *
 * One matching token is enough: "Loreal Haarspray" should still match a
 * product called just "Haarspray". Queries with no usable tokens (all
 * tokens under three characters) skip the check rather than reject
 * everything.
 */
function isRelevant(result: SafeImageResult, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${normalizeForMatch(result.title)} ${normalizeForMatch(result.source)}`;
  return tokens.some((token) => haystack.includes(token));
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface UnsplashSearchResponse {
  results?: Array<{
    description: string | null;
    alt_description: string | null;
    urls?: { regular?: string; small?: string };
    links?: { html?: string };
  }>;
}

/**
 * Unsplash search, gated on the family's existing screensaver key.
 *
 * `content_filter=high` is Unsplash's strictest setting and is the
 * documented way to exclude anything not safe for a general audience.
 */
async function searchUnsplash(
  query: string,
  limit: number,
  familyId: string,
): Promise<SafeImageResult[]> {
  const settings = await getMergedSetting<{ access_key?: string }>(
    familyId,
    SETTINGS_KEYS.unsplash,
  );
  const accessKey = settings?.access_key;
  if (!accessKey) return [];

  const params = new URLSearchParams({
    query,
    per_page: String(Math.min(limit, 30)),
    content_filter: "high",
    orientation: "squarish",
  });

  const data = await fetchJson<UnsplashSearchResponse>(
    `https://api.unsplash.com/search/photos?${params.toString()}`,
    { Authorization: `Client-ID ${accessKey}` },
  );

  return (data.results ?? []).flatMap((photo) => {
    const url = photo.urls?.regular;
    const thumbnail = photo.urls?.small ?? url;
    if (!url || !thumbnail) return [];
    return [
      {
        url,
        thumbnail,
        title: photo.description ?? photo.alt_description ?? query,
        source: photo.links?.html ?? "https://unsplash.com",
      },
    ];
  });
}

interface OpenFoodFactsResponse {
  hits?: Array<{
    code?: string;
    product_name?: string;
    product_name_de?: string;
    brands?: string[] | string;
    image_front_url?: string;
    image_front_small_url?: string;
    image_url?: string;
    image_small_url?: string;
  }>;
}

/**
 * Open Food Facts product search, via the Search-a-licious endpoint.
 *
 * Note the host: `search.openfoodfacts.org`, not the main site. The
 * legacy `world.openfoodfacts.org/cgi/search.pl` endpoint (and the v2
 * `/api/v2/search`) currently answer 503 under load — Search-a-licious
 * is the supported search path and is the one that stays up.
 *
 * Products without a front image are dropped rather than shown with a
 * placeholder: an entry you can't visually identify is worse than one
 * fewer option.
 */
async function searchOpenFoodFacts(
  query: string,
  limit: number,
): Promise<SafeImageResult[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.min(limit * 2, 40)),
    langs: "de,en",
  });

  const data = await fetchJson<OpenFoodFactsResponse>(
    `https://search.openfoodfacts.org/search?${params.toString()}`,
  );

  return (data.hits ?? []).flatMap((hit) => {
    const url = hit.image_front_url ?? hit.image_url;
    if (!url) return [];

    // `brands` comes back as an array from Search-a-licious but as a
    // comma-joined string from other Open Food Facts endpoints.
    const brand = Array.isArray(hit.brands)
      ? hit.brands[0]
      : typeof hit.brands === "string"
        ? hit.brands.split(",")[0]
        : undefined;
    const name = hit.product_name_de ?? hit.product_name ?? query;
    const title = brand ? `${brand.trim()} ${name}`.trim() : name;

    return [
      {
        url,
        thumbnail: hit.image_front_small_url ?? hit.image_small_url ?? url,
        title,
        source: hit.code
          ? `https://world.openfoodfacts.org/product/${hit.code}`
          : "https://world.openfoodfacts.org",
      },
    ];
  });
}

interface OpenverseSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    thumbnail?: string;
    foreign_landing_url?: string;
  }>;
}

/**
 * Openverse search — no API key, which is what makes image search work
 * out of the box on a fresh self-host.
 *
 * `mature=false` is the default but is passed explicitly: this is a
 * safety-critical parameter and it should be visible at the call site,
 * not inherited.
 */
async function searchOpenverse(
  query: string,
  limit: number,
): Promise<SafeImageResult[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.min(limit * 2, 40)),
    mature: "false",
    // Photographs match "what does this product look like" far better
    // than the diagrams and scans that otherwise dominate.
    category: "photograph",
  });

  const data = await fetchJson<OpenverseSearchResponse>(
    `https://api.openverse.org/v1/images/?${params.toString()}`,
  );

  return (data.results ?? []).flatMap((image) => {
    const url = image.url;
    if (!url) return [];
    return [
      {
        url,
        thumbnail: image.thumbnail ?? url,
        title: image.title ?? query,
        source: image.foreign_landing_url ?? "https://openverse.org",
      },
    ];
  });
}

/**
 * Search for images safe to show on a family screen.
 *
 * Returns [] rather than throwing — every caller renders an empty state
 * on failure, and no failure path leads to unfiltered content.
 */
export async function searchSafeImages(
  query: string,
  { limit = 12, familyId, mode = "general" }: SafeImageSearchOptions = {},
): Promise<SafeImageResult[]> {
  if (imageSearchDisabled()) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const guard =
    (name: string) =>
    (error: unknown): SafeImageResult[] => {
      console.error(`[image-search] ${name} failed:`, error);
      return [];
    };

  // Providers run concurrently; a slow or broken one costs its own
  // results, never the whole search. Order here is the order results
  // are presented in, because dedupe below keeps the first occurrence.
  const providers: Array<Promise<SafeImageResult[]>> = [];

  if (mode === "product") {
    providers.push(searchOpenFoodFacts(q, limit).catch(guard("Open Food Facts")));
  }
  if (familyId) {
    providers.push(searchUnsplash(q, limit, familyId).catch(guard("Unsplash")));
  }
  providers.push(searchOpenverse(q, limit).catch(guard("Openverse")));

  const settled = await Promise.all(providers);
  const tokens = relevanceTokens(q);

  const seen = new Set<string>();
  const out: SafeImageResult[] = [];
  for (const result of settled.flat()) {
    if (out.length >= limit) break;
    if (seen.has(result.url)) continue;
    if (!isAllowed(result)) continue;
    if (!isRelevant(result, tokens)) continue;
    seen.add(result.url);
    out.push(result);
  }

  return out;
}
