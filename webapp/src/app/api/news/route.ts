import { NextRequest, NextResponse } from "next/server";
import DOMPurify from "isomorphic-dompurify";
import {
  NEWS_PROVIDERS,
  DEFAULT_NEWS_SOURCES,
  getProvider,
  type NewsProvider,
} from "@/lib/news-providers";
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

const MAX_ITEMS_PER_SOURCE = 15;
const MAX_ITEMS_TOTAL = 40;

function decodeHtmlEntities(text: string): string {
  // Decode `&amp;` LAST. Decoding it first would convert `&amp;lt;`
  // (literal "&lt;" — which the original feed wanted shown as text)
  // into `&lt;` and then into `<`, double-decoding past the original
  // intent. Doing it last preserves single-pass-decode semantics.
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtml(text: string): string {
  // DOMPurify with empty allow-lists strips ALL tags + attributes
  // robustly — including pathological inputs like `<scr<x>ipt>` that
  // a single-pass regex (`<[^>]*>`) leaves dangerous after one
  // replacement. Used for RSS title/description text on the news
  // widget; output is rendered as React text (not innerHTML), but
  // defense-in-depth.
  const stripped = DOMPurify.sanitize(text, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
  return stripped.replace(/\s+/g, " ").trim();
}

function parseRss(xml: string, provider: NewsProvider): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title =
      itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
      itemXml.match(/<title>(.*?)<\/title>/)?.[1] ||
      "";
    const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] || "";
    const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
    const description =
      itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ||
      itemXml.match(/<description>(.*?)<\/description>/)?.[1] ||
      "";

    const enclosureUrl =
      itemXml.match(/<enclosure[^>]*url="([^"]*\.(jpg|jpeg|png|webp)[^"]*)"/i)?.[1] ||
      itemXml.match(/<enclosure[^>]*url="([^"]*)"/)?.[1] ||
      "";
    const mediaContent = itemXml.match(/<media:content[^>]*url="([^"]*)"/)?.[1] || "";
    const mediaThumbnail = itemXml.match(/<media:thumbnail[^>]*url="([^"]*)"/)?.[1] || "";
    const imgInDescription = description.match(/src="([^"]*\.(jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || "";
    const image = enclosureUrl || mediaContent || mediaThumbnail || imgInDescription || "";

    const category =
      itemXml.match(/<category><!\[CDATA\[(.*?)\]\]><\/category>/)?.[1] ||
      itemXml.match(/<category[^>]*>(.*?)<\/category>/)?.[1] ||
      "";

    if (title) {
      items.push({
        title: decodeHtmlEntities(title),
        link: link.trim(),
        pubDate,
        description: stripHtml(decodeHtmlEntities(description)),
        image,
        category: decodeHtmlEntities(category),
        source: provider.id,
        sourceName: provider.name,
      });
    }

    if (items.length >= MAX_ITEMS_PER_SOURCE) break;
  }

  return items;
}

async function fetchProvider(provider: NewsProvider): Promise<NewsItem[]> {
  const cached = providerCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  try {
    const response = await fetch(provider.url, {
      headers: { "User-Agent": "Kinboard/1.0 (+https://kinboard.app)" },
      next: { revalidate: 600 },
      // 10s connection budget — slow feeds shouldn't block the others
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Stale cache wins over hard failure
      return cached?.items ?? [];
    }
    const xml = await response.text();
    const items = parseRss(xml, provider);
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

  // Resolve & sanitize: drop unknown IDs silently, fall back to defaults if empty
  const providers: NewsProvider[] = requested
    .map(getProvider)
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

