import { NextRequest, NextResponse } from "next/server";

// Chefkoch search result type
interface ChefkochSearchResult {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  rating: number;
  ratingCount: number;
  difficulty: string;
  prepTime: number | null;
  sourceUrl: string;
  sourceDomain: string;
}

// Chefkoch API response types
interface ChefkochRecipeResult {
  id: string;
  title: string;
  subtitle?: string;
  previewImageUrlTemplate?: string;
  rating?: {
    rating: number;
    numVotes: number;
  };
  difficulty?: number;
  preparationTime?: number;
  totalTime?: number;
  isPlus?: boolean;
}

interface ChefkochSearchResponse {
  count: number;
  results: Array<{
    recipe: ChefkochRecipeResult;
  }>;
}

// Map Chefkoch difficulty to German labels
function mapDifficulty(difficulty: number | undefined): string {
  switch (difficulty) {
    case 1:
      return "einfach";
    case 2:
      return "mittel";
    case 3:
      return "schwer";
    default:
      return "mittel";
  }
}

// Get image URL from template
function getImageUrl(template: string | undefined): string | null {
  if (!template) return null;
  // Chefkoch uses templates like "https://img.chefkoch-cdn.de/rezepte/{id}/bilder/{imageId}/<format>/{imageFile}"
  // The <format> placeholder needs to be replaced with actual dimensions
  return template
    .replace("<format>", "crop-600x400")
    .replace("%3Cformat%3E", "crop-600x400")
    .replace("{format}", "crop-600x400")
    .replace("{crop}", "crop-600x400")
    .replace("{index}", "1")
    .replace(/{w}/g, "600")
    .replace(/{h}/g, "400");
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  try {
    // Use Chefkoch's internal search API
    const apiUrl = new URL("https://api.chefkoch.de/v2/search-gateway/recipes");
    apiUrl.searchParams.set("query", query);
    apiUrl.searchParams.set("limit", String(limit));
    apiUrl.searchParams.set("offset", String(offset));
    apiUrl.searchParams.set("orderBy", "1"); // Relevance

    const response = await fetch(apiUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        "Accept-Language": "de-DE,de;q=0.9",
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!response.ok) {
      console.error("Chefkoch API error:", response.status);
      // Fallback: Try web scraping approach
      return await searchChefkochFallback(query, limit);
    }

    const data: ChefkochSearchResponse = await response.json();

    const results: ChefkochSearchResult[] = data.results
      .filter((item) => !item.recipe.isPlus) // Filter out premium recipes
      .map((item) => ({
        id: item.recipe.id,
        title: item.recipe.title,
        subtitle: item.recipe.subtitle || "",
        imageUrl: getImageUrl(item.recipe.previewImageUrlTemplate),
        rating: item.recipe.rating?.rating || 0,
        ratingCount: item.recipe.rating?.numVotes || 0,
        difficulty: mapDifficulty(item.recipe.difficulty),
        prepTime: item.recipe.totalTime || item.recipe.preparationTime || null,
        sourceUrl: `https://www.chefkoch.de/rezepte/${item.recipe.id}`,
        sourceDomain: "chefkoch.de",
      }));

    return NextResponse.json({
      results,
      total: data.count,
      query,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error searching Chefkoch:", error);
    // Try fallback
    return await searchChefkochFallback(query, limit);
  }
}

// Fallback: Scrape search results from web page
async function searchChefkochFallback(
  query: string,
  limit: number
): Promise<NextResponse> {
  try {
    const webUrl = `https://www.chefkoch.de/rs/s0/${encodeURIComponent(query)}/Rezepte.html`;

    const response = await fetch(webUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
        "Accept-Language": "de-DE,de;q=0.9",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to search recipes" },
        { status: 500 }
      );
    }

    const html = await response.text();

    // Extract recipe data from JSON-LD
    const results: ChefkochSearchResult[] = [];
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const items = Array.isArray(data) ? data : data["@graph"] || [data];

        for (const item of items) {
          if (item["@type"] === "ItemList" && item.itemListElement) {
            for (const listItem of item.itemListElement) {
              if (listItem.item && results.length < limit) {
                const recipe = listItem.item;
                results.push({
                  id: recipe.url?.split("/").pop()?.split("-")[0] || "",
                  title: recipe.name || "",
                  subtitle: "",
                  imageUrl: typeof recipe.image === "string" ? recipe.image : recipe.image?.url || null,
                  rating: recipe.aggregateRating?.ratingValue || 0,
                  ratingCount: recipe.aggregateRating?.ratingCount || 0,
                  difficulty: "mittel",
                  prepTime: null,
                  sourceUrl: recipe.url || "",
                  sourceDomain: "chefkoch.de",
                });
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    return NextResponse.json({
      results,
      total: results.length,
      query,
      limit,
      offset: 0,
    });
  } catch (error) {
    console.error("Fallback search error:", error);
    return NextResponse.json(
      { error: "Failed to search recipes" },
      { status: 500 }
    );
  }
}
