import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { BRING_TO_LOCAL_CATEGORY, detectCategory } from "@/lib/shopping-categories";

// Bring! catalog URL for German locale
const BRING_CATALOG_URL = "https://web.getbring.com/locale/catalog.de-DE.json";

// Cache for Bring! catalog (in-memory, refreshed hourly)
let bringCatalogCache: BringCatalogItem[] | null = null;
let bringCatalogCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Bring! catalog types
interface BringCatalogItem {
  itemId: string;
  name: string;
  sectionId: string;
  sectionName: string;
}

interface RawCatalogSection {
  sectionId: string;
  name: string;
  items: { itemId: string; name: string }[];
}

interface RawCatalogResponse {
  language: string;
  catalog: {
    sections: RawCatalogSection[];
  };
}

// Local catalog item type (until types are regenerated)
interface LocalCatalogItem {
  id: string;
  family_id: string | null;
  name: string;
  name_normalized: string;
  barcode: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  default_unit: string | null;
  default_quantity: number | null;
  nutrition_json: Record<string, number> | null;
  source: string;
  popularity: number;
  created_at: string;
}

interface CatalogSearchResult {
  id: string | null;
  name: string;
  image_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  barcode: string | null;
  source: "local" | "openfoodfacts" | "bring" | "custom";
  default_unit: string | null;
  popularity: number;
}

// Map Bring! section names to our shopping categories
// Uses shared BRING_TO_LOCAL_CATEGORY map, falls back to keyword detection
function mapBringSectionToCategory(
  sectionName: string,
  itemName?: string,
  useBringCategories = true,
): string {
  const mapped = useBringCategories ? BRING_TO_LOCAL_CATEGORY[sectionName] : undefined;
  if (mapped) return mapped;

  // Fall back to keyword-based detection if item name provided
  if (itemName) return detectCategory(itemName);

  return "sonstiges";
}

// Fetch and cache Bring! catalog
async function getBringCatalog(): Promise<BringCatalogItem[]> {
  const now = Date.now();

  // Return cached data if still valid
  if (bringCatalogCache && now - bringCatalogCacheTime < CACHE_TTL) {
    return bringCatalogCache;
  }

  try {
    const response = await fetch(BRING_CATALOG_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      console.error("Failed to fetch Bring! catalog:", response.status);
      return bringCatalogCache || [];
    }

    const rawData: RawCatalogResponse = await response.json();
    const items: BringCatalogItem[] = [];

    if (rawData.catalog?.sections) {
      for (const section of rawData.catalog.sections) {
        if (section.items && Array.isArray(section.items)) {
          for (const item of section.items) {
            items.push({
              itemId: item.itemId,
              name: item.name,
              sectionId: section.sectionId,
              sectionName: section.name,
            });
          }
        }
      }
    }

    // Update cache
    bringCatalogCache = items;
    bringCatalogCacheTime = now;
    console.log(`Bring! catalog loaded: ${items.length} items`);

    return items;
  } catch (error) {
    console.error("Error fetching Bring! catalog:", error);
    return bringCatalogCache || [];
  }
}

// Search Bring! catalog
async function searchBringCatalog(
  query: string,
  limit: number = 15,
  useBringCategories = true,
): Promise<CatalogSearchResult[]> {
  const catalog = await getBringCatalog();
  const normalizedQuery = query.toLowerCase().trim();

  // Score and filter results
  const scored = catalog
    .map((item) => {
      const name = item.name.toLowerCase();
      let score = 0;

      // Exact match
      if (name === normalizedQuery) {
        score = 100;
      }
      // Starts with query
      else if (name.startsWith(normalizedQuery)) {
        score = 80;
      }
      // Contains query as a word
      else if (name.includes(` ${normalizedQuery}`) || name.includes(`${normalizedQuery} `)) {
        score = 60;
      }
      // Contains query
      else if (name.includes(normalizedQuery)) {
        score = 40;
      }

      return { item, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((r) => ({
    id: null,
    name: r.item.name,
    image_url: null,
    thumbnail_url: null,
    category: mapBringSectionToCategory(r.item.sectionName, r.item.name, useBringCategories),
    barcode: null,
    source: "bring" as const,
    default_unit: null,
    popularity: r.score,
  }));
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const familyId = searchParams.get("family_id");
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  // "Adopt Bring! categories" — off means classify by our own keywords
  // instead of by the section the item sits in on Bring!.
  const useBringCategories = searchParams.get("bring_categories") !== "0";

  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  const results: CatalogSearchResult[] = [];
  const existingNames = new Set<string>();
  const normalizedQuery = query.toLowerCase().trim();
  let hasExactLocalMatch = false;

  // 1. Search local catalog FIRST (family-specific custom items with images)
  if (familyId) {
    try {
      const supabase = await createAdminClient();

      // Search family-specific and global items
       
      const { data: localItems, error } = await (supabase as any)
        .from("item_catalog")
        .select("*")
        .or(`family_id.eq.${familyId},family_id.is.null`)
        .ilike("name_normalized", `%${normalizedQuery}%`)
        .order("popularity", { ascending: false })
        .limit(10);

      if (!error && localItems) {
        for (const item of localItems as LocalCatalogItem[]) {
          const nameLower = item.name.toLowerCase();
          if (!existingNames.has(nameLower)) {
            existingNames.add(nameLower);
            // Check if this is an exact match
            if (nameLower === normalizedQuery) {
              hasExactLocalMatch = true;
            }
            results.push({
              id: item.id,
              name: item.name,
              image_url: item.image_url,
              thumbnail_url: item.thumbnail_url,
              category: item.category,
              barcode: item.barcode,
              source: item.source as "local" | "openfoodfacts" | "bring" | "custom",
              default_unit: item.default_unit,
              popularity: item.popularity + 500, // Boost local items
            });
          }
        }
      }
    } catch (error) {
      console.error("Error searching local catalog:", error);
    }
  }

  // 2. Add "Quick Add" option ONLY if no exact match in local catalog
  // This allows users to quickly add new items, but not duplicate existing ones
  if (!hasExactLocalMatch) {
    const quickAddItem: CatalogSearchResult = {
      id: null,
      name: query.trim(),
      image_url: null,
      thumbnail_url: null,
      category: null,
      barcode: null,
      source: "custom",
      default_unit: null,
      popularity: 1000, // High priority
    };
    results.unshift(quickAddItem); // Add at beginning
    existingNames.add(normalizedQuery);
  }

  // 3. Search Bring! catalog (curated German grocery items)
  if (results.length < limit) {
    const bringResults = await searchBringCatalog(query, limit, useBringCategories);

    for (const item of bringResults) {
      const nameLower = item.name.toLowerCase();
      if (!existingNames.has(nameLower)) {
        existingNames.add(nameLower);
        results.push(item);
      }
    }
  }

  // Sort: local items with images first, then quick add, then Bring! items
  results.sort((a, b) => {
    // Local items with images get highest priority
    const aHasImage = !!(a.thumbnail_url || a.image_url);
    const bHasImage = !!(b.thumbnail_url || b.image_url);
    if (aHasImage && !bHasImage) return -1;
    if (!aHasImage && bHasImage) return 1;
    // Quick add (custom without id) comes next
    const aIsQuickAdd = a.source === "custom" && !a.id;
    const bIsQuickAdd = b.source === "custom" && !b.id;
    if (aIsQuickAdd && !bIsQuickAdd) return -1;
    if (!aIsQuickAdd && bIsQuickAdd) return 1;
    // Local items (with id) before Bring!
    if (a.id && !b.id) return -1;
    if (!a.id && b.id) return 1;
    // Then by popularity/score
    return b.popularity - a.popularity;
  });

  return NextResponse.json({
    results: results.slice(0, limit),
    total: results.length,
    query,
  });
}

// Save an item from Open Food Facts to local catalog
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { family_id, name, barcode, image_url, thumbnail_url, category, source } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const supabase = await createAdminClient();
     
    const supabaseAny = supabase as any;

    // Check if item already exists
    const normalizedName = name.toLowerCase().trim();
    const { data: existing } = await supabaseAny
      .from("item_catalog")
      .select("id, popularity")
      .eq("name_normalized", normalizedName)
      .or(`family_id.eq.${family_id},family_id.is.null`)
      .single();

    if (existing) {
      // Update existing item with new data (category, image, etc.) and increment popularity
      const updateData: Record<string, unknown> = {
        popularity: (existing.popularity || 0) + 1,
      };

      // Only update fields that were provided
      if (category !== undefined) updateData.category = category;
      if (image_url !== undefined) updateData.image_url = image_url;
      if (thumbnail_url !== undefined) updateData.thumbnail_url = thumbnail_url;
      if (barcode !== undefined) updateData.barcode = barcode;

      await supabaseAny
        .from("item_catalog")
        .update(updateData)
        .eq("id", existing.id);

      return NextResponse.json({ id: existing.id, created: false, updated: true });
    }

    // Create new catalog item
    const { data: newItem, error } = await supabaseAny
      .from("item_catalog")
      .insert({
        family_id: family_id || null,
        name,
        name_normalized: normalizedName,
        barcode: barcode || null,
        image_url: image_url || null,
        thumbnail_url: thumbnail_url || null,
        category: category || null,
        source: source || "custom",
        popularity: 1,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating catalog item:", error);
      return NextResponse.json(
        { error: "Failed to create catalog item" },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: newItem.id, created: true });
  } catch (error) {
    console.error("Error in POST /api/catalog/search:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
