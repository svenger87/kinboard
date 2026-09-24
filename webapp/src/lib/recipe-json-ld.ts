export interface SchemaOrgRecipe {
  "@type": string | string[];
  name?: string;
  description?: string;
  image?: string | string[] | { url: string }[];
  author?: string | { name?: string } | { name?: string }[];
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  recipeYield?: string | number | (string | number)[] | { value?: string | number };
  recipeIngredient?: string[];
  recipeInstructions?:
    | string
    | string[]
    | { "@type": string; text?: string; name?: string }[];
  recipeCuisine?: string | string[];
  recipeCategory?: string | string[];
  keywords?: string | string[];
  aggregateRating?: {
    ratingValue?: number | string;
    ratingCount?: number | string;
    reviewCount?: number | string;
  };
  nutrition?: {
    calories?: string;
    [key: string]: string | undefined;
  };
  video?: { name?: string; thumbnailUrl?: string };
}

export function parseRecipeYield(yield_: SchemaOrgRecipe["recipeYield"]): number {
  const value = Array.isArray(yield_) ? yield_[0] : typeof yield_ === "object" ? yield_?.value : yield_;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 4;
  if (typeof value !== "string") return 4;

  const match = value.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}

function isRecipeType(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isRecipeType);
  return typeof value === "string" && /(?:^|[/#])Recipe$/.test(value);
}

function findRecipe(data: unknown): SchemaOrgRecipe | null {
  const pending: unknown[] = [data];
  const seen = new Set<object>();

  while (pending.length > 0 && seen.size < 50_000) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) pending.push(value[index]);
      continue;
    }

    const item = value as Record<string, unknown>;
    if (isRecipeType(item["@type"])) return item as unknown as SchemaOrgRecipe;
    // A recipe can be in @graph, an array at the root, or nested in a
    // mainEntity/itemListElement wrapper. Only object values can contain it.
    const children = Object.values(item);
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (child && typeof child === "object") pending.push(child);
    }
  }

  return null;
}

/** Find the first Schema.org Recipe in a page's JSON-LD scripts. */
export function extractRecipeFromHtml(html: string): SchemaOrgRecipe | null {
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;

  while ((match = scripts.exec(html)) !== null) {
    // HTML permits quoted and unquoted attribute values. Several recipe sites,
    // including Love and Lemons, use type=application/ld+json without quotes.
    const type = match[1].match(/(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if ((type?.[1] ?? type?.[2] ?? type?.[3])?.toLowerCase() !== "application/ld+json") continue;

    try {
      const recipe = findRecipe(JSON.parse(match[2].trim()));
      if (recipe) return recipe;
    } catch {
      // A malformed JSON-LD script must not hide a valid one later on.
    }
  }

  return null;
}
