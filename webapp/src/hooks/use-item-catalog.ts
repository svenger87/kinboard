"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { requireFamilyId } from "./use-supabase-queries";
import { useState, useCallback, useMemo, useEffect } from "react";

// Types
export interface CatalogSearchResult {
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

export interface BarcodeResult {
  id: string | null;
  name: string;
  brand: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  barcode: string;
  source: "local" | "openfoodfacts";
  default_unit: string | null;
  quantity: string | null;
  nutrition: Record<string, number> | null;
}

// Query keys
export const catalogQueryKeys = {
  search: (familyId: string, query: string) =>
    ["item-catalog", "search", familyId, query] as const,
  barcode: (familyId: string, barcode: string) =>
    ["item-catalog", "barcode", familyId, barcode] as const,
  all: (familyId: string) => ["item-catalog", familyId] as const,
};

/**
 * Hook to search the item catalog
 * Searches local catalog first, then Open Food Facts
 */
export function useCatalogSearch(query: string, options?: { enabled?: boolean }) {
  const { family } = useFamilyStore();
  const debouncedQuery = useDebounce(query, 300);

  return useQuery({
    queryKey: catalogQueryKeys.search(family?.id ?? "", debouncedQuery),
    queryFn: async (): Promise<CatalogSearchResult[]> => {
      if (!debouncedQuery || debouncedQuery.length < 2) {
        return [];
      }

      const params = new URLSearchParams({
        q: debouncedQuery,
        family_id: requireFamilyId(family),
        limit: "20",
      });

      const response = await fetch(`/api/catalog/search?${params}`);
      if (!response.ok) {
        throw new Error("Failed to search catalog");
      }

      const data = await response.json();
      return data.results;
    },
    enabled: (options?.enabled ?? true) && !!family?.id && debouncedQuery.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to lookup a product by barcode
 */
export function useBarcodeLookup(barcode: string | null) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: catalogQueryKeys.barcode(family?.id ?? "", barcode ?? ""),
    queryFn: async (): Promise<BarcodeResult | null> => {
      if (!barcode || barcode.length < 8) {
        return null;
      }

      const params = new URLSearchParams({
        barcode,
        family_id: requireFamilyId(family),
      });

      const response = await fetch(`/api/catalog/barcode?${params}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error("Failed to lookup barcode");
      }

      const data = await response.json();
      return data.product;
    },
    enabled: !!family?.id && !!barcode && barcode.length >= 8,
    staleTime: 1000 * 60 * 60, // 1 hour (product data doesn't change often)
  });
}

/**
 * Hook to save an item to the local catalog
 */
export function useSaveToCatalog() {
  const { family } = useFamilyStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: Partial<CatalogSearchResult>) => {
      const response = await fetch("/api/catalog/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family?.id,
          name: item.name,
          barcode: item.barcode,
          image_url: item.image_url,
          thumbnail_url: item.thumbnail_url,
          category: item.category,
          source: item.source || "custom",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save to catalog");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: catalogQueryKeys.all(requireFamilyId(family)),
      });
    },
  });
}

/**
 * Hook providing autocomplete functionality with debouncing
 */
export function useItemAutocomplete() {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: suggestions, isLoading } = useCatalogSearch(searchTerm);

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchTerm("");
  }, []);

  return {
    searchTerm,
    suggestions: suggestions || [],
    isLoading,
    handleSearch,
    clearSearch,
  };
}

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

/**
 * Hook that provides parsing functionality
 */
export function useParseShoppingInput() {
  return useMemo(() => ({ parse: parseShoppingInput }), []);
}

// Debounce hook
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
