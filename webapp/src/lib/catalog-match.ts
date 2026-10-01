/**
 * Batch-match item names against the family's catalogue and the Bring!
 * public catalogue — moved verbatim out of POST /api/catalog/match so the
 * Integration API can do for an assistant what the recipe page does through
 * that route: give each ingredient a category, a picture and a catalogue id.
 *
 * The session route keeps its own session and family checks and calls this;
 * its behaviour is unchanged. The local catalogue and the Bring! catalogue
 * are parameters with production defaults, so the rules are tested without
 * a database or the network.
 *
 * Only `familyId`'s rows (plus the global ones) are read; the caller is
 * responsible for that being the authenticated family.
 */

import { createAdminClient } from "@/lib/supabase/server";

// Bring! catalog URL for German locale
const BRING_CATALOG_URL = "https://web.getbring.com/locale/catalog.de-DE.json";

// Cache for Bring! catalog (in-memory, refreshed hourly)
let bringCatalogCache: BringCatalogItem[] | null = null;
let bringCatalogCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export interface BringCatalogItem {
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

export interface CatalogMatch {
  id: string | null;
  name: string;
  category: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  source: string;
}

/** The columns of an item_catalog row the match reads. */
export interface LocalCatalogItem {
  id: string;
  name: string;
  category: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
}

// Map Bring! section names to our shopping categories
export function mapBringSectionToCategory(sectionName: string): string {
  const sectionMap: Record<string, string> = {
    "Obst & Gemüse": "obst_gemuese",
    "Milch & Käse": "milchprodukte",
    "Brot & Gebäck": "backwaren",
    "Fleisch & Fisch": "fleisch",
    "Getränke": "getraenke",
    "Tiefkühl": "tiefkuehl",
    "Frühstück": "fruehstueck",
    "Brotaufstriche & Aufstriche": "fruehstueck",
    "Müsli & Cerealien": "fruehstueck",
    "Süßigkeiten & Snacks": "suessigkeiten",
    "Snacks": "suessigkeiten",
    "Süßwaren": "suessigkeiten",
    "Fertiggerichte": "vorrat",
    "Gewürze & Saucen": "vorrat",
    "Pasta & Reis": "vorrat",
    "Backen": "vorrat",
    "Öl & Essig": "vorrat",
    "Teigwaren": "vorrat",
    "Konserven": "vorrat",
    "Haushalt": "haushalt",
    "Drogerie": "drogerie",
    "Baby": "drogerie",
    "Haustier": "tierbedarf",
    "Tierbedarf": "tierbedarf",
  };

  return sectionMap[sectionName] || "sonstiges";
}

// Fetch and cache Bring! catalog
async function getBringCatalog(): Promise<BringCatalogItem[]> {
  const now = Date.now();

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

    bringCatalogCache = items;
    bringCatalogCacheTime = now;

    return items;
  } catch (error) {
    console.error("Error fetching Bring! catalog:", error);
    return bringCatalogCache || [];
  }
}

// Fuzzy match a single item name against catalog
export function fuzzyMatch(
  itemName: string,
  catalogName: string
): { match: boolean; score: number } {
  const a = itemName.toLowerCase().trim();
  const b = catalogName.toLowerCase().trim();

  // Exact match
  if (a === b) {
    return { match: true, score: 100 };
  }

  // One contains the other as a complete word
  if (b.startsWith(a + " ") || b.endsWith(" " + a) || b.includes(" " + a + " ")) {
    return { match: true, score: 80 };
  }
  if (a.startsWith(b + " ") || a.endsWith(" " + b) || a.includes(" " + b + " ")) {
    return { match: true, score: 80 };
  }

  // Starts with
  if (b.startsWith(a) || a.startsWith(b)) {
    return { match: true, score: 70 };
  }

  // Contains
  if (b.includes(a) || a.includes(b)) {
    return { match: true, score: 50 };
  }

  return { match: false, score: 0 };
}

/**
 * The family's own and the global catalogue rows, most popular first, or
 * null when the query errored (the route skipped the local step then, too).
 */
async function loadLocalCatalog(familyId: string): Promise<LocalCatalogItem[] | null> {
  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("item_catalog")
    .select("*")
    .or(`family_id.eq.${familyId},family_id.is.null`)
    .order("popularity", { ascending: false });
  if (error || !data) return null;
  return data as LocalCatalogItem[];
}

export interface CatalogMatchDeps {
  loadLocal?: (familyId: string) => Promise<LocalCatalogItem[] | null>;
  loadBring?: () => Promise<BringCatalogItem[]>;
}

/**
 * Match each name, keyed by its lower-cased, trimmed form; null where
 * nothing scored 50 or more. The local catalogue is searched first (it has
 * pictures and the family's own data), Bring! for whatever is left. A local
 * catalogue failure is logged and falls through to Bring!; a Bring! catalogue
 * that cannot be fetched is an empty one.
 */
export async function matchCatalogItems(
  familyId: string | null | undefined,
  items: string[],
  deps: CatalogMatchDeps = {},
): Promise<Record<string, CatalogMatch | null>> {
  const loadLocal = deps.loadLocal ?? loadLocalCatalog;
  const loadBring = deps.loadBring ?? getBringCatalog;

  const matches: Record<string, CatalogMatch | null> = {};

  // Initialize all items as null (no match)
  for (const item of items) {
    matches[item.toLowerCase().trim()] = null;
  }

  // 1. Search local catalog first (has images and custom data)
  if (familyId) {
    try {
      const localItems = await loadLocal(familyId);

      if (localItems) {
        for (const item of items) {
          const normalizedItem = item.toLowerCase().trim();
          if (matches[normalizedItem]) continue; // Already matched

          let bestMatch: { item: LocalCatalogItem; score: number } | null = null;

          for (const catalogItem of localItems) {
            const { match, score } = fuzzyMatch(item, catalogItem.name);
            if (match && (!bestMatch || score > bestMatch.score)) {
              bestMatch = { item: catalogItem, score };
            }
            // If we found an exact match, stop searching
            if (score === 100) break;
          }

          if (bestMatch && bestMatch.score >= 50) {
            matches[normalizedItem] = {
              id: bestMatch.item.id,
              name: bestMatch.item.name,
              category: bestMatch.item.category,
              image_url: bestMatch.item.image_url,
              thumbnail_url: bestMatch.item.thumbnail_url,
              source: "local",
            };
          }
        }
      }
    } catch (error) {
      console.error("Error searching local catalog:", error);
    }
  }

  // 2. Search Bring! catalog for remaining unmatched items
  const bringCatalog = await loadBring();

  for (const item of items) {
    const normalizedItem = item.toLowerCase().trim();
    if (matches[normalizedItem]) continue; // Already matched from local catalog

    let bestMatch: { item: BringCatalogItem; score: number } | null = null;

    for (const bringItem of bringCatalog) {
      const { match, score } = fuzzyMatch(item, bringItem.name);
      if (match && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { item: bringItem, score };
      }
      if (score === 100) break;
    }

    if (bestMatch && bestMatch.score >= 50) {
      matches[normalizedItem] = {
        id: null, // Bring! items don't have local IDs
        name: bestMatch.item.name,
        category: mapBringSectionToCategory(bestMatch.item.sectionName),
        image_url: null,
        thumbnail_url: null,
        source: "bring",
      };
    }
  }

  return matches;
}
