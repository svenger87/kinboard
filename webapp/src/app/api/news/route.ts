import { NextResponse } from "next/server";

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  image?: string;
  category?: string;
}

// Cache news for 10 minutes
let cachedNews: NewsItem[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Der Spiegel RSS feed (includes images)
const RSS_URL = "https://www.spiegel.de/schlagzeilen/index.rss";

export async function GET() {
  try {
    // Return cached news if still valid
    if (cachedNews && Date.now() - cacheTimestamp < CACHE_DURATION) {
      return NextResponse.json({ news: cachedNews });
    }

    // Fetch RSS feed
    const response = await fetch(RSS_URL, {
      headers: {
        "User-Agent": "FamilyCalendar/1.0",
      },
      next: { revalidate: 600 }, // Cache for 10 minutes
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed: ${response.status}`);
    }

    const xml = await response.text();

    // Parse RSS XML
    const items: NewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];

      const title = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
                    itemXml.match(/<title>(.*?)<\/title>/)?.[1] || "";
      const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] || "";
      const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
      const description = itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ||
                          itemXml.match(/<description>(.*?)<\/description>/)?.[1] || "";

      // Extract image from enclosure or media:content (try multiple patterns)
      const enclosureUrl = itemXml.match(/<enclosure[^>]*url="([^"]*\.(jpg|jpeg|png|webp)[^"]*)"/i)?.[1] ||
                           itemXml.match(/<enclosure[^>]*url="([^"]*)"/)?.[1] || "";
      const mediaContent = itemXml.match(/<media:content[^>]*url="([^"]*)"/)?.[1] || "";
      const mediaThumbnail = itemXml.match(/<media:thumbnail[^>]*url="([^"]*)"/)?.[1] || "";
      const imgInDescription = description.match(/src="([^"]*\.(jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || "";
      const image = enclosureUrl || mediaContent || mediaThumbnail || imgInDescription || "";

      // Extract category (try multiple patterns)
      const category = itemXml.match(/<category><!\[CDATA\[(.*?)\]\]><\/category>/)?.[1] ||
                       itemXml.match(/<category[^>]*>(.*?)<\/category>/)?.[1] || "";

      if (title) {
        items.push({
          title: decodeHtmlEntities(title),
          link,
          pubDate,
          description: stripHtml(decodeHtmlEntities(description)),
          image,
          category: decodeHtmlEntities(category),
        });
      }

      // Limit to 10 items
      if (items.length >= 10) break;
    }

    // Update cache
    cachedNews = items;
    cacheTimestamp = Date.now();

    return NextResponse.json({ news: items });
  } catch (error) {
    console.error("News fetch error:", error);

    // Return cached news if available, even if stale
    if (cachedNews) {
      return NextResponse.json({ news: cachedNews, stale: true });
    }

    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 500 }
    );
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}
