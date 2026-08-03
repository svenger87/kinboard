// Catalog of news sources Kinboard knows how to fetch. RSS-only for now;
// users pick a subset on /settings/news. The maintainer's deployment
// originally defaulted to Der Spiegel — kept as the fallback when no
// `news_sources` setting exists yet.

export interface NewsProvider {
  id: string;
  name: string;
  url: string;
  /** Display language; used for grouping in the picker UI */
  lang: "de" | "en";
  /** Optional homepage for the "what is this source?" affordance */
  homepage?: string;
}

export const NEWS_PROVIDERS: NewsProvider[] = [
  // German
  {
    id: "spiegel",
    name: "Der Spiegel",
    url: "https://www.spiegel.de/schlagzeilen/index.rss",
    lang: "de",
    homepage: "https://www.spiegel.de/",
  },
  {
    id: "tagesschau",
    name: "Tagesschau",
    url: "https://www.tagesschau.de/index~rss2.xml",
    lang: "de",
    homepage: "https://www.tagesschau.de/",
  },
  {
    id: "zeit",
    name: "Die Zeit",
    url: "https://newsfeed.zeit.de/index",
    lang: "de",
    homepage: "https://www.zeit.de/",
  },
  {
    id: "heise",
    name: "heise online",
    url: "https://www.heise.de/rss/heise-atom.xml",
    lang: "de",
    homepage: "https://www.heise.de/",
  },
  {
    id: "sueddeutsche",
    name: "Süddeutsche Zeitung",
    url: "https://rss.sueddeutsche.de/alles",
    lang: "de",
    homepage: "https://www.sueddeutsche.de/",
  },
  // English
  {
    id: "bbc",
    name: "BBC News",
    url: "http://feeds.bbci.co.uk/news/rss.xml",
    lang: "en",
    homepage: "https://www.bbc.com/news",
  },
  {
    id: "guardian",
    name: "The Guardian",
    url: "https://www.theguardian.com/international/rss",
    lang: "en",
    homepage: "https://www.theguardian.com/",
  },
  {
    id: "nyt",
    name: "NYT Home",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    lang: "en",
    homepage: "https://www.nytimes.com/",
  },
  {
    id: "hn",
    name: "Hacker News",
    url: "https://news.ycombinator.com/rss",
    lang: "en",
    homepage: "https://news.ycombinator.com/",
  },
  {
    id: "ars-technica",
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    lang: "en",
    homepage: "https://arstechnica.com/",
  },
];

export const DEFAULT_NEWS_SOURCES: string[] = ["spiegel"];

export function getProvider(id: string): NewsProvider | undefined {
  return NEWS_PROVIDERS.find((p) => p.id === id);
}

// ── Custom feeds ────────────────────────────────────────────────────
//
// Families can add their own RSS/Atom URLs on /settings/news. They live
// in the `news_custom_feeds` setting rather than this catalog, which
// stays a curated list the maintainer vouches for.
//
// The distinction matters for more than tidiness. Both server-side
// fetches — the feed itself and reader mode — are constrained to hosts
// derived from sources. For catalog entries that set is fixed and
// audited; for custom feeds it is whatever a family typed, so those
// hosts are only ever trusted for the family that added them. See
// api/news/article/route.ts.

export const CUSTOM_FEED_PREFIX = "custom:";

export interface CustomFeed {
  /** Always prefixed `custom:` so it can't collide with a catalog id. */
  id: string;
  name: string;
  url: string;
}

export function isCustomFeedId(id: string): boolean {
  return id.startsWith(CUSTOM_FEED_PREFIX);
}

/**
 * Present a custom feed with the same shape as a catalog provider, so
 * the fetch path doesn't need to care which kind it's handling.
 *
 * `lang` is a display hint used only for grouping in the picker; custom
 * feeds have no reliable language, so they group separately in the UI
 * and this value is never shown.
 */
export function customFeedAsProvider(feed: CustomFeed): NewsProvider {
  let homepage: string | undefined;
  try {
    homepage = new URL(feed.url).origin;
  } catch {
    homepage = undefined;
  }
  return { id: feed.id, name: feed.name, url: feed.url, lang: "en", homepage };
}

/**
 * Widen a feed host to the domain its articles probably live on.
 *
 * Feeds are usually served from a subdomain — `feeds.example.com` — while
 * the articles they link to sit on `example.com` or `www.example.com`.
 * Allowing only the literal feed host would make reader mode fail on most
 * custom feeds, so one label is stripped.
 *
 * Not stripped when that would leave a public suffix: `bbc.co.uk` must not
 * widen to `co.uk`, which would allow every British site at once. Two
 * labels ending in a country-code TLD are treated as the registrable
 * domain and left alone. This is a deliberate approximation of the Public
 * Suffix List — pulling in the real list for a self-hosted family
 * dashboard's optional feed feature isn't worth the dependency, and
 * erring toward "don't widen" only costs a fallback to opening the link.
 */
const SUFFIX_LABELS = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "gouv"]);

export function parentDomain(host: string): string | null {
  const labels = host.split(".");
  if (labels.length < 3) return null;

  const parent = labels.slice(1);
  if (parent.length === 2 && parent[1].length <= 3 && SUFFIX_LABELS.has(parent[0])) {
    return null;
  }
  return parent.join(".");
}

/** Hosts reader mode may fetch on behalf of a family that added feeds. */
export function customFeedHosts(feeds: ReadonlyArray<CustomFeed>): string[] {
  const hosts = new Set<string>();
  for (const f of feeds) {
    let host: string;
    try {
      host = new URL(f.url).hostname.toLowerCase();
    } catch {
      // A malformed stored URL contributes no host rather than throwing;
      // it simply never matches, which is the safe direction.
      continue;
    }
    hosts.add(host);
    const parent = parentDomain(host);
    if (parent) hosts.add(parent);
  }
  return [...hosts];
}

