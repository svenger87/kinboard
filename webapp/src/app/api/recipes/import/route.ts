import { NextRequest, NextResponse } from "next/server";
import { validateExternalUrl } from "@/lib/validate-external-url";

// Schema.org Recipe type
interface SchemaOrgRecipe {
  "@type": "Recipe" | string;
  name?: string;
  description?: string;
  image?: string | string[] | { url: string }[];
  author?: string | { name?: string } | { name?: string }[];
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  recipeYield?: string | number;
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

// Parsed recipe result
interface ParsedRecipe {
  title: string;
  description: string | null;
  source_url: string;
  source_domain: string;
  image_url: string | null;
  servings: number;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  difficulty: "einfach" | "mittel" | "schwer" | null;
  instructions: { step: number; text: string }[];
  ingredients: {
    name: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
    category: string | null;
    sort_order: number;
  }[];
}

// Parse ISO 8601 duration (e.g., "PT30M", "PT1H30M") to minutes
function parseDuration(duration: string | undefined): number | null {
  if (!duration) return null;

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return null;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 60 + minutes + Math.round(seconds / 60);
}

// Parse yield string to number (e.g., "4 Portionen" -> 4)
function parseYield(yield_: string | number | undefined): number {
  if (!yield_) return 4;
  if (typeof yield_ === "number") return yield_;

  const match = yield_.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}

// Get image URL from various formats
function getImageUrl(
  image: string | string[] | { url: string }[] | undefined
): string | null {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    const first = image[0];
    if (typeof first === "string") return first;
    if (typeof first === "object" && first.url) return first.url;
  }
  return null;
}

// Schema.org HowToStep/HowToSection types
interface HowToStep {
  "@type"?: string;
  text?: string;
  name?: string;
  description?: string;
  itemListElement?: HowToStep[];
}

// Parse instructions from various formats including HowToSection/HowToStep
function parseInstructions(
  instructions:
    | string
    | string[]
    | HowToStep[]
    | undefined
): { step: number; text: string }[] {
  if (!instructions) return [];

  if (typeof instructions === "string") {
    // Split by newlines or numbered steps
    const steps = instructions
      .split(/(?:\r?\n)+|(?:\d+\.\s*)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return steps.map((text, i) => ({ step: i + 1, text }));
  }

  if (Array.isArray(instructions)) {
    const result: { step: number; text: string }[] = [];
    let stepNumber = 1;

    // Recursive function to extract steps from nested structures
    const extractSteps = (items: (string | HowToStep)[]): void => {
      for (const item of items) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (trimmed.length > 0) {
            result.push({ step: stepNumber++, text: trimmed });
          }
        } else if (typeof item === "object" && item !== null) {
          // Handle HowToSection with nested itemListElement
          if (item["@type"] === "HowToSection" && Array.isArray(item.itemListElement)) {
            extractSteps(item.itemListElement);
          }
          // Handle HowToStep or generic objects with text/name/description
          else if (item.text || item.name || item.description) {
            const text = (item.text || item.description || item.name || "").trim();
            if (text.length > 0) {
              result.push({ step: stepNumber++, text });
            }
          }
          // Handle itemListElement at the top level (some sites nest steps this way)
          else if (Array.isArray(item.itemListElement)) {
            extractSteps(item.itemListElement);
          }
        }
      }
    };

    extractSteps(instructions);
    return result;
  }

  return [];
}

// Parse ingredient string to structured data
// Examples:
// - "200 g Mehl" -> { quantity: 200, unit: "g", name: "Mehl" }
// - "1 TL Salz" -> { quantity: 1, unit: "TL", name: "Salz" }
// - "Pfeffer" -> { quantity: null, unit: null, name: "Pfeffer" }
// - "2-3 Zwiebeln, gewürfelt" -> { quantity: 2.5, unit: null, name: "Zwiebeln", notes: "gewürfelt" }
function parseIngredient(text: string): {
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
} {
  let cleaned = text.trim();
  let notes: string | null = null;

  // Extract notes in parentheses
  const parenMatch = cleaned.match(/\(([^)]+)\)/);
  if (parenMatch) {
    notes = parenMatch[1].trim();
    cleaned = cleaned.replace(parenMatch[0], "").trim();
  }

  // Extract notes after comma
  const commaIndex = cleaned.indexOf(",");
  if (commaIndex > 0) {
    const potentialNotes = cleaned.substring(commaIndex + 1).trim();
    if (potentialNotes.length > 0 && potentialNotes.length < 50) {
      notes = notes ? `${notes}, ${potentialNotes}` : potentialNotes;
      cleaned = cleaned.substring(0, commaIndex).trim();
    }
  }

  // Common unit patterns (German)
  const unitPatterns = [
    // Weight
    { regex: /^(\d+(?:[.,]\d+)?)\s*(kg|g|gramm)\s+/i, unit: (m: string) => (m.toLowerCase() === "kg" ? "kg" : "g") },
    // Volume
    { regex: /^(\d+(?:[.,]\d+)?)\s*(l|liter|ml|milliliter)\s+/i, unit: (m: string) => (m.toLowerCase().startsWith("l") ? "L" : "ml") },
    // Spoons
    { regex: /^(\d+(?:[.,]\d+)?)\s*(el|esslöffel)\s+/i, unit: () => "EL" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(tl|teelöffel)\s+/i, unit: () => "TL" },
    // Pieces
    { regex: /^(\d+(?:[.,]\d+)?)\s*(stück|stk\.?)\s+/i, unit: () => "Stück" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(packung|pack|pkg\.?|päckchen)\s+/i, unit: () => "Packung" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(dose|dosen)\s+/i, unit: () => "Dose" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(glas|gläser)\s+/i, unit: () => "Glas" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(flasche|flaschen)\s+/i, unit: () => "Flasche" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(bund|bündel)\s+/i, unit: () => "Bund" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(scheibe|scheiben)\s+/i, unit: () => "Scheiben" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(prise|prisen)\s+/i, unit: () => "Prise" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(becher)\s+/i, unit: () => "Becher" },
    { regex: /^(\d+(?:[.,]\d+)?)\s*(tasse|tassen)\s+/i, unit: () => "Tasse" },
    // Range (e.g., "2-3")
    { regex: /^(\d+)\s*[-–]\s*(\d+)\s+/i, unit: () => null },
    // Just number
    { regex: /^(\d+(?:[.,]\d+)?)\s+/i, unit: () => null },
  ];

  for (const pattern of unitPatterns) {
    const match = cleaned.match(pattern.regex);
    if (match) {
      let quantity: number;
      if (match[2] && /^\d+$/.test(match[2])) {
        // Range: average of the two numbers
        quantity = (parseFloat(match[1]) + parseFloat(match[2])) / 2;
      } else {
        quantity = parseFloat(match[1].replace(",", "."));
      }
      const unit = match[2] && !/^\d+$/.test(match[2]) ? pattern.unit(match[2]) : null;
      const name = cleaned.replace(match[0], "").trim();

      return {
        name: name || cleaned,
        quantity,
        unit,
        notes,
      };
    }
  }

  // No quantity/unit found
  return {
    name: cleaned,
    quantity: null,
    unit: null,
    notes,
  };
}

// Estimate difficulty based on various factors
function estimateDifficulty(
  recipe: SchemaOrgRecipe
): "einfach" | "mittel" | "schwer" | null {
  const totalMinutes = parseDuration(recipe.totalTime);
  const ingredientCount = recipe.recipeIngredient?.length || 0;
  const instructionCount = Array.isArray(recipe.recipeInstructions)
    ? recipe.recipeInstructions.length
    : 1;

  // Simple heuristics
  if (totalMinutes && totalMinutes <= 30 && ingredientCount <= 6) return "einfach";
  if (totalMinutes && totalMinutes > 90) return "schwer";
  if (ingredientCount > 15 || instructionCount > 10) return "schwer";
  if (ingredientCount > 10 || instructionCount > 6) return "mittel";

  return "mittel";
}

// Extract recipe from HTML using JSON-LD
function extractRecipeFromHtml(html: string): SchemaOrgRecipe | null {
  // Find all JSON-LD scripts
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonContent = match[1].trim();
      const data = JSON.parse(jsonContent);

      // Handle single object or array
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        // Direct recipe
        if (item["@type"] === "Recipe" || item["@type"]?.includes?.("Recipe")) {
          return item as SchemaOrgRecipe;
        }

        // Recipe in @graph
        if (item["@graph"]) {
          const graphItems = Array.isArray(item["@graph"]) ? item["@graph"] : [item["@graph"]];
          for (const graphItem of graphItems) {
            if (graphItem["@type"] === "Recipe" || graphItem["@type"]?.includes?.("Recipe")) {
              return graphItem as SchemaOrgRecipe;
            }
          }
        }
      }
    } catch (e) {
      // JSON parse error, try next script
      continue;
    }
  }

  return null;
}

// Get domain from URL
function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace("www.", "");
  } catch {
    return "unknown";
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    // SSRF guard — reject non-http(s) schemes (file://, javascript:,
    // data:) and literal private/loopback IPs in the host. Returns
    // 400 with a stable error code; downstream tooling can surface a
    // user-facing message keyed off `reason`. (CodeQL #21 closure.)
    const validated = validateExternalUrl(url);
    if (!validated.ok) {
      return NextResponse.json(
        { error: "Invalid URL format", reason: validated.reason },
        { status: 400 }
      );
    }
    const parsedUrl = validated.url;

    // Fetch the page (12s timeout — recipes are typically small HTML).
    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FamilyCalendar/1.0)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${response.status}` },
        { status: 400 }
      );
    }

    const html = await response.text();

    // Extract recipe from JSON-LD
    const schemaRecipe = extractRecipeFromHtml(html);

    if (!schemaRecipe) {
      return NextResponse.json(
        { error: "No recipe found on this page. The site may not support structured recipe data." },
        { status: 404 }
      );
    }

    // Parse the recipe
    const parsedRecipe: ParsedRecipe = {
      title: schemaRecipe.name || "Unbenanntes Rezept",
      description: schemaRecipe.description || null,
      source_url: url,
      source_domain: getDomain(url),
      image_url: getImageUrl(schemaRecipe.image),
      servings: parseYield(schemaRecipe.recipeYield),
      prep_time_minutes: parseDuration(schemaRecipe.prepTime),
      cook_time_minutes: parseDuration(schemaRecipe.cookTime),
      total_time_minutes: parseDuration(schemaRecipe.totalTime),
      difficulty: estimateDifficulty(schemaRecipe),
      instructions: parseInstructions(schemaRecipe.recipeInstructions),
      ingredients: (schemaRecipe.recipeIngredient || []).map((ing, index) => ({
        ...parseIngredient(ing),
        category: null, // Could be enhanced with category detection
        sort_order: index,
      })),
    };

    // Calculate total time if not provided
    if (!parsedRecipe.total_time_minutes && (parsedRecipe.prep_time_minutes || parsedRecipe.cook_time_minutes)) {
      parsedRecipe.total_time_minutes =
        (parsedRecipe.prep_time_minutes || 0) + (parsedRecipe.cook_time_minutes || 0);
    }

    return NextResponse.json(parsedRecipe);
  } catch (error) {
    console.error("Error importing recipe:", error);
    return NextResponse.json(
      { error: "Failed to import recipe", details: String(error) },
      { status: 500 }
    );
  }
}
