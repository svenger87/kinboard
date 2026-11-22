/**
 * Product lookup by barcode in the Open Food Facts family of databases:
 * open, worldwide and crowd-sourced (https://world.openfoodfacts.org). Food
 * first, then its sister databases for cosmetics, pet food and everything
 * else, so a shampoo or a bag of cat food is found too.
 */

/** The shopping categories a product can land in (lib/shopping-categories). */
export type ShoppingCategory =
  | "obst_gemuese"
  | "milchprodukte"
  | "backwaren"
  | "fleisch"
  | "getraenke"
  | "tiefkuehl"
  | "fruehstueck"
  | "suessigkeiten"
  | "vorrat"
  | "haushalt"
  | "drogerie"
  | "tierbedarf"
  | "sonstiges";

export interface OpenFactsProduct {
  name: string;
  brand: string | null;
  quantity: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  category: ShoppingCategory | null;
  barcode: string;
  /** Which database knew it. */
  database: OpenFactsDatabase;
}

export type OpenFactsDatabase = "food" | "beauty" | "petfood" | "products";

/** In the order they are asked. */
export const OPEN_FACTS_DATABASES: ReadonlyArray<{ id: OpenFactsDatabase; base: string }> = [
  { id: "food", base: "https://world.openfoodfacts.org" },
  { id: "beauty", base: "https://world.openbeautyfacts.org" },
  { id: "petfood", base: "https://world.openpetfoodfacts.org" },
  { id: "products", base: "https://world.openproductsfacts.org" },
];

/**
 * Open Food Facts asks every app to name itself, with a way to reach it,
 * in the User-Agent: https://openfoodfacts.github.io/openfoodfacts-server/api/
 */
export const OPEN_FACTS_USER_AGENT = "Kinboard (+https://github.com/svenger87/kinboard)";

const CATEGORY_TAGS: ReadonlyArray<[string, ShoppingCategory]> = [
  ["en:fruits", "obst_gemuese"],
  ["en:vegetables", "obst_gemuese"],
  ["en:fresh-fruits", "obst_gemuese"],
  ["en:fresh-vegetables", "obst_gemuese"],
  ["en:frozen-foods", "tiefkuehl"],
  ["en:ice-creams-and-sorbets", "tiefkuehl"],
  ["en:dairies", "milchprodukte"],
  ["en:milks", "milchprodukte"],
  ["en:cheeses", "milchprodukte"],
  ["en:yogurts", "milchprodukte"],
  ["en:butters", "milchprodukte"],
  ["en:breads", "backwaren"],
  ["en:pastries", "backwaren"],
  ["en:meats", "fleisch"],
  ["en:fishes", "fleisch"],
  ["en:seafood", "fleisch"],
  ["en:poultry", "fleisch"],
  ["en:beverages", "getraenke"],
  ["en:waters", "getraenke"],
  ["en:juices", "getraenke"],
  ["en:sodas", "getraenke"],
  ["en:breakfasts", "fruehstueck"],
  ["en:breakfast-cereals", "fruehstueck"],
  ["en:spreads", "fruehstueck"],
  ["en:chocolates", "suessigkeiten"],
  ["en:confectioneries", "suessigkeiten"],
  ["en:sweet-snacks", "suessigkeiten"],
  ["en:biscuits-and-cakes", "suessigkeiten"],
  ["en:pastas", "vorrat"],
  ["en:rices", "vorrat"],
  ["en:canned-foods", "vorrat"],
  ["en:condiments", "vorrat"],
  ["en:sauces", "vorrat"],
  ["en:cleaning-products", "haushalt"],
];

/** Our category for a product's tags; what isn't food goes by the database it came from. */
export function categoryFor(tags: readonly string[] | undefined, database: OpenFactsDatabase): ShoppingCategory | null {
  for (const tag of tags ?? []) {
    const hit = CATEGORY_TAGS.find(([t]) => t === tag);
    if (hit) return hit[1];
  }
  if (database === "beauty") return "drogerie";
  if (database === "petfood") return "tierbedarf";
  if (database === "products") return "haushalt";
  return tags && tags.length > 0 ? "sonstiges" : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * The product in one API answer, named in `lang` where the database has it,
 * else in its main language. Null when it has no product or no name at all.
 */
export function parseOpenFacts(data: unknown, lang: string, database: OpenFactsDatabase, barcode: string): OpenFactsProduct | null {
  const d = data as { status?: number; product?: Record<string, unknown> } | null;
  if (!d || d.status !== 1 || !d.product) return null;
  const p = d.product;
  const name =
    str(p[`product_name_${lang}`]) ??
    str(p.product_name) ??
    str(p[`generic_name_${lang}`]) ??
    str(p.generic_name) ??
    str(p.product_name_en);
  if (!name) return null;
  const brand = str(p.brands)?.split(",")[0]?.trim() ?? null;
  return {
    name,
    brand,
    quantity: str(p.quantity),
    image_url: str(p.image_url),
    thumbnail_url: str(p.image_thumb_url) ?? str(p.image_small_url),
    category: categoryFor(Array.isArray(p.categories_tags) ? (p.categories_tags as string[]) : undefined, database),
    barcode: str(p.code) ?? barcode,
    database,
  };
}

/** One database's API URL for a barcode, asking only for the fields we use. */
export function openFactsUrl(base: string, barcode: string, lang: string): string {
  const fields = [
    "code",
    "product_name",
    `product_name_${lang}`,
    "product_name_en",
    "generic_name",
    `generic_name_${lang}`,
    "brands",
    "quantity",
    "image_url",
    "image_small_url",
    "image_thumb_url",
    "categories_tags",
  ].join(",");
  return `${base}/api/v2/product/${encodeURIComponent(barcode)}?lc=${encodeURIComponent(lang)}&fields=${fields}`;
}

/**
 * Asks the databases in turn until one knows the barcode. A database that
 * fails (down, slow) counts as not knowing it, so the next one is asked.
 */
export async function lookupOpenFacts(
  barcode: string,
  lang: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenFactsProduct | null> {
  for (const db of OPEN_FACTS_DATABASES) {
    try {
      const response = await fetchImpl(openFactsUrl(db.base, barcode, lang), {
        headers: { "User-Agent": OPEN_FACTS_USER_AGENT },
        signal: AbortSignal.timeout(6000),
        next: { revalidate: 86400 },
      } as RequestInit);
      if (!response.ok) continue;
      const product = parseOpenFacts(await response.json(), lang, db.id, barcode);
      if (product) return product;
    } catch {
      // next database
    }
  }
  return null;
}
