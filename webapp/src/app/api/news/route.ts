import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_NEWS_SOURCES,
  getProvider,
  isCustomFeedId,
  customFeedAsProvider,
  type NewsProvider,
} from "@/lib/news-providers";
import { loadCustomFeeds } from "@/lib/news-custom-feeds";
import { parseFeed } from "@/lib/rss-parser";
import { validateExternalUrl } from "@/lib/validate-external-url";
import { safeFetch } from "@/lib/safe-fetch";
import { isDemoMode, getDemoNewsItems } from "@/lib/demo-news";

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  image?: string;
  category?: string;
  /** ID of the news provider, e.g. "spiegel". Lets the UI badge each item. */
  source: string;
  /** Display name of the source */
  sourceName: string;
}

// Per-provider cache so swapping sources doesn't invalidate everything.
// 10-minute TTL keeps RSS publishers happy and ensures fresh-enough news.
const PROVIDER_CACHE_TTL_MS = 10 * 60 * 1000;
const providerCache: Map<string, { items: NewsItem[]; expiresAt: number }> = new Map();

// Raised from 15/40. Fifteen headlines per source is roughly a day for a
// wire service, which meant a household with two sources ran out of news
// by evening. Publishers commonly ship 50-100 items per feed, so this
// takes more of what has already been fetched rather than fetching more.
const MAX_ITEMS_PER_SOURCE = 50;
const MAX_ITEMS_TOTAL = 150;

/**
 * Feed parsing moved to `lib/rss-parser` when custom feeds arrived —
 * the discovery endpoint needs the same logic, and the inline version
 * only understood RSS `<item>`, so any Atom feed a user added would
 * have come back empty with nothing to explain why.
 */
function toNewsItems(xml: string, provider: NewsProvider): NewsItem[] {
  const feed = parseFeed(xml, MAX_ITEMS_PER_SOURCE);
  if (!feed) return [];
  return feed.items.map((item) => ({
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    description: item.description,
    image: item.image,
    category: item.category,
    source: provider.id,
    sourceName: provider.name,
  }));
}

async function fetchProvider(provider: NewsProvider): Promise<NewsItem[]> {
  const cached = providerCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  // Catalog URLs are compiled in; custom ones came from a settings row
  // and are re-checked on every fetch. See lib/news-custom-feeds.ts.
  if (isCustomFeedId(provider.id) && !validateExternalUrl(provider.url).ok) {
    return [];
  }

  try {
    // Catalog feeds could use plain fetch, but routing both through the
    // same call means a custom feed can never be the one that skips the
    // address check by accident.
    const response = await safeFetch(provider.url, {
      headers: { "User-Agent": "Kinboard/1.0 (+https://kinboard.app)" },
      // 10s connection budget — slow feeds shouldn't block the others
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Stale cache wins over hard failure
      return cached?.items ?? [];
    }
    const xml = await response.text();
    const items = toNewsItems(xml, provider);
    providerCache.set(provider.id, {
      items,
      expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
    });
    return items;
  } catch (err) {
    console.error(`[news] fetch ${provider.id} failed:`, err);
    return cached?.items ?? [];
  }
}

export async function GET(request: NextRequest) {
  // On public-demo deployments (KINBOARD_DEMO_FAMILY_CODE set on the
  // server), short-circuit with synthetic articles instead of fetching
  // real RSS. Avoids re-displaying copyrighted publisher content to
  // anonymous demo visitors. Self-hosters running their own household
  // never hit this branch.
  if (isDemoMode()) {
    const items = getDemoNewsItems();
    const providerSet = new Map<string, { id: string; name: string; lang: string }>();
    for (const item of items) {
      providerSet.set(item.source, { id: item.source, name: item.sourceName, lang: "en" });
    }
    return NextResponse.json({
      news: items,
      providers: [...providerSet.values()],
    });
  }

  const sourcesParam = request.nextUrl.searchParams.get("sources");
  const requested = sourcesParam
    ? sourcesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_NEWS_SOURCES;

  // Custom ids only mean something in the context of a family, so they
  // resolve against that family's saved feeds. Without a family_id they
  // simply don't resolve, and are dropped like any unknown id.
  const familyId = request.nextUrl.searchParams.get("family_id") ?? "";
  const custom = requested.some(isCustomFeedId) ? await loadCustomFeeds(familyId) : [];

  // Resolve & sanitize: drop unknown IDs silently, fall back to defaults if empty
  const providers: NewsProvider[] = requested
    .map((id) => {
      if (!isCustomFeedId(id)) return getProvider(id);
      const feed = custom.find((f) => f.id === id);
      return feed ? customFeedAsProvider(feed) : undefined;
    })
    .filter((p): p is NewsProvider => Boolean(p));
  const effective = providers.length > 0
    ? providers
    : DEFAULT_NEWS_SOURCES.map(getProvider).filter((p): p is NewsProvider => Boolean(p));

  if (effective.length === 0) {
    return NextResponse.json({ news: [], providers: [] });
  }

  // Parallel fetch
  const results = await Promise.all(effective.map(fetchProvider));
  const merged = results.flat();

  // Dedupe by canonical link, sort newest-first, cap
  const seen = new Set<string>();
  const deduped: NewsItem[] = [];
  for (const item of merged) {
    if (!item.link || seen.has(item.link)) continue;
    seen.add(item.link);
    deduped.push(item);
  }
  deduped.sort((a, b) => {
    const ad = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bd = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return bd - ad;
  });

  return NextResponse.json({
    news: deduped.slice(0, MAX_ITEMS_TOTAL),
    providers: effective.map((p) => ({ id: p.id, name: p.name, lang: p.lang })),
  });
}

