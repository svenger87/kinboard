/**
 * Free-text shopping input → name, quantity, unit and notes.
 *
 * Pure and server-safe: the shopping pages parse what a person types with it,
 * and the Integration API parses what an assistant sends with the same rules,
 * so "2 kg Bananen" becomes the same row whichever way it arrives. It used to
 * live in the "use client" catalogue hook, which a route handler cannot import.
 */

/**
 * Parse natural language input into structured item data
 * Examples:
 * - "2kg Kartoffeln" -> { quantity: 2, unit: "kg", name: "Kartoffeln" }
 * - "3 Äpfel Bio" -> { quantity: 3, unit: "Stück", name: "Äpfel", notes: "Bio" }
 * - "Milch 1L" -> { quantity: 1, unit: "L", name: "Milch" }
 */
export interface ParsedShoppingItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

const UNIT_PATTERNS = [
  // Weight patterns
  { regex: /(\d+(?:[.,]\d+)?)\s*(kg|g|gramm)\b/i, unit: (m: string) => m.toLowerCase() === "kg" || m.toLowerCase() === "gramm" ? m : "g" },
  // Volume patterns
  { regex: /(\d+(?:[.,]\d+)?)\s*(l|liter|ml|milliliter)\b/i, unit: (m: string) => m.toLowerCase().startsWith("l") ? "L" : "ml" },
  // Spoon patterns (German)
  { regex: /(\d+(?:[.,]\d+)?)\s*(el|esslöffel|tl|teelöffel)\b/i, unit: (m: string) => m.toLowerCase().startsWith("e") ? "EL" : "TL" },
  // Count patterns
  { regex: /(\d+(?:[.,]\d+)?)\s*(stück|stk\.?|st\.?)\b/i, unit: () => "Stück" },
  { regex: /(\d+(?:[.,]\d+)?)\s*(packung|pack|pkg\.?|päckchen)\b/i, unit: () => "Packung" },
  { regex: /(\d+(?:[.,]\d+)?)\s*(dose|dosen)\b/i, unit: () => "Dose" },
  { regex: /(\d+(?:[.,]\d+)?)\s*(glas|gläser)\b/i, unit: () => "Glas" },
  { regex: /(\d+(?:[.,]\d+)?)\s*(flasche|flaschen)\b/i, unit: () => "Flasche" },
  { regex: /(\d+(?:[.,]\d+)?)\s*(bund|bündel)\b/i, unit: () => "Bund" },
  { regex: /(\d+(?:[.,]\d+)?)\s*(scheibe|scheiben)\b/i, unit: () => "Scheiben" },
  // Standalone number (implies pieces)
  { regex: /^(\d+)\s+(?!kg|g|l|ml|el|tl)/i, unit: () => "Stück" },
];

// Common note keywords (German)
const NOTE_KEYWORDS = [
  "bio", "frisch", "tiefgekühlt", "tk", "regional", "ohne", "mit",
  "groß", "klein", "reif", "unreif", "ganz", "geschnitten", "gehackt",
];

export function parseShoppingInput(input: string): ParsedShoppingItem {
  let text = input.trim();
  let quantity: number | null = null;
  let unit: string | null = null;
  let notes: string | null = null;

  // Try to match quantity and unit patterns
  for (const pattern of UNIT_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      quantity = parseFloat(match[1].replace(",", "."));
      unit = pattern.unit(match[2]);
      text = text.replace(match[0], "").trim();
      break;
    }
  }

  // Extract notes (common keywords or text in parentheses)
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    notes = parenMatch[1].trim();
    text = text.replace(parenMatch[0], "").trim();
  } else {
    // Check for note keywords at the end
    const words = text.split(/\s+/);
    const noteWords: string[] = [];

    while (words.length > 1) {
      const lastWord = words[words.length - 1].toLowerCase();
      if (NOTE_KEYWORDS.some((kw) => lastWord.includes(kw))) {
        noteWords.unshift(words.pop()!);
      } else {
        break;
      }
    }

    if (noteWords.length > 0) {
      notes = noteWords.join(" ");
      text = words.join(" ");
    }
  }

  // Clean up the name
  const name = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.\s]+|[,.\s]+$/g, "");

  return {
    name: name || input.trim(),
    quantity,
    unit,
    notes,
  };
}
