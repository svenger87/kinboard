import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Image search result
interface ImageSearchResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
}

// Use DuckDuckGo's image search (via their instant answers API)
// This is an unofficial approach but works for product images
async function searchImagesViaDDG(query: string, limit: number = 12): Promise<ImageSearchResult[]> {
  try {
    // DuckDuckGo doesn't have an official image API, so we'll use a simple approach
    // by fetching from their image search endpoint
    const searchQuery = encodeURIComponent(`${query} produkt`);
    const url = `https://duckduckgo.com/?q=${searchQuery}&t=h_&iax=images&ia=images`;

    // For actual image results, we need to use a different approach
    // Let's try the vqd token approach
    const tokenResponse = await fetch(`https://duckduckgo.com/?q=${searchQuery}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const tokenHtml = await tokenResponse.text();
    const vqdMatch = tokenHtml.match(/vqd=['"]([^'"]+)['"]/);

    if (!vqdMatch) {
      console.log("Could not extract DuckDuckGo vqd token");
      return [];
    }

    const vqd = vqdMatch[1];

    // Now fetch actual images
    const imageUrl = `https://duckduckgo.com/i.js?l=de-de&o=json&q=${searchQuery}&vqd=${vqd}&f=,,,,,&p=1`;

    const imageResponse = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    if (!imageResponse.ok) {
      console.error("DuckDuckGo image search failed:", imageResponse.status);
      return [];
    }

    const data = await imageResponse.json();

    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.slice(0, limit).map((result: {
      image: string;
      thumbnail: string;
      title: string;
      source: string;
    }) => ({
      url: result.image,
      thumbnail: result.thumbnail,
      title: result.title || "",
      source: result.source || "",
    }));
  } catch (error) {
    console.error("Error searching images via DuckDuckGo:", error);
    return [];
  }
}

// Alternative: Use Bing Image Search (simpler, more reliable)
async function searchImagesViaBing(query: string, limit: number = 12): Promise<ImageSearchResult[]> {
  try {
    const searchQuery = encodeURIComponent(`${query}`);

    // Bing Image Search scraping (no API key needed)
    const url = `https://www.bing.com/images/search?q=${searchQuery}&form=HDRSC2&first=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      console.error("Bing image search failed:", response.status);
      return [];
    }

    const html = await response.text();

    // Extract image data from the HTML
    // Bing embeds image data in <a> tags with m attribute containing JSON
    const imageRegex = /class="iusc"[^>]*m="([^"]+)"/g;
    const results: ImageSearchResult[] = [];
    let match;

    while ((match = imageRegex.exec(html)) !== null) {
      if (results.length >= limit) break;

      try {
        // Decode HTML entities and parse JSON. `&amp;` MUST decode
        // last — otherwise `&amp;lt;` would become `&lt;` then `<`,
        // double-decoding past the source intent.
        const jsonStr = match[1]
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');

        const data = JSON.parse(jsonStr);

        if (data.murl && data.turl) {
          results.push({
            url: data.murl,
            thumbnail: data.turl,
            title: data.t || "",
            source: data.purl || "",
          });
        }
      } catch {
        // Skip malformed entries
        continue;
      }
    }

    return results;
  } catch (error) {
    console.error("Error searching images via Bing:", error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "12", 10);

  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  // Try Bing first (more reliable), fall back to DuckDuckGo
  let results = await searchImagesViaBing(query, limit);

  if (results.length === 0) {
    results = await searchImagesViaDDG(query, limit);
  }

  return NextResponse.json({
    results,
    total: results.length,
    query,
  });
}
