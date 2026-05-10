/**
 * Web image search backend for goal-image-search.
 *
 * Used as a fallback when the curated `item_catalog` doesn't have a
 * good match for what the kid wants — particularly for brand-new toys,
 * specific LEGO sets, video games, etc. that wouldn't ship in a
 * curated dataset.
 *
 * Backend: DuckDuckGo's image search. No API key required, no signup —
 * fits the kinboard self-hosting model. Endpoint is unofficial (same
 * tier as our Stonks plugin's yahoo-finance2 dependency); on failure
 * the API route falls back to catalog-only without surfacing an error.
 *
 * The two-step "vqd token" dance is what every DDG-image scraper does
 * — first hit the HTML page to grab the token, then post it back on
 * the JSON endpoint. Token rotates per-query and expires fast, so
 * caching the token is not worth the complexity.
 */

// DDG 403s bare-fetch UAs. Mimicking a real browser is what the
// duck-duck-scrape ecosystem all does.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface WebImageResult {
  url: string;
  title: string;
}

export async function searchWebImages(
  query: string,
  limit = 12,
): Promise<WebImageResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const encoded = encodeURIComponent(q);

  // Step 1: scrape the vqd token off the HTML response. Capture the
  // session cookie — DDG ties step-2 access to it.
  const tokenRes = await fetch(
    `https://duckduckgo.com/?q=${encoded}&iar=images&iax=images&ia=images`,
    { headers: { "User-Agent": UA } },
  );
  if (!tokenRes.ok) return [];
  const html = await tokenRes.text();
  const vqdMatch =
    html.match(/vqd=["']([\d-]+)["']/) || html.match(/vqd=([\d-]+)&/);
  if (!vqdMatch) return [];
  const vqd = vqdMatch[1];

  // Concatenate set-cookie values into a single Cookie header. Node's
  // native fetch surfaces them all (newline-joined) on .get; lower-level
  // raw access would be cleaner but isn't part of the standard.
  const setCookie = tokenRes.headers.get("set-cookie") ?? "";
  const cookieHeader = setCookie
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // Step 2: hit the JSON endpoint. Browser-like UA + Referer + the
  // session cookie from step 1 — without all three DDG returns 403.
  const jsonRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqd}&f=,,,,,&p=1`,
    {
      headers: {
        "User-Agent": UA,
        Referer: "https://duckduckgo.com/",
        "X-Requested-With": "XMLHttpRequest",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    },
  );
  if (!jsonRes.ok) return [];

  const data = (await jsonRes.json()) as {
    results?: Array<{ image?: string; title?: string; thumbnail?: string }>;
  };

  return (data.results ?? [])
    .filter((r): r is { image: string; title: string; thumbnail?: string } =>
      Boolean(r.image && r.title),
    )
    .slice(0, limit)
    .map((r) => ({ url: r.image, title: r.title }));
}
