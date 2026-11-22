"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { requireFamilyId } from "./use-supabase-queries";
import { useBringSettings } from "./use-bring";
import { useState, useCallback, useMemo, useEffect } from "react";
import { parseShoppingInput } from "@/lib/shopping-input";

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
  const { data: bringSettings } = useBringSettings();
  const debouncedQuery = useDebounce(query, 300);
  const useBringCategories = bringSettings?.syncCategories !== false;

  return useQuery({
    // The flag is in the key: flipping the switch has to re-fetch, or the
    // suggestions keep their old categories until the cache expires.
    queryKey: [
      ...catalogQueryKeys.search(family?.id ?? "", debouncedQuery),
      useBringCategories,
    ],
    queryFn: async (): Promise<CatalogSearchResult[]> => {
      if (!debouncedQuery || debouncedQuery.length < 2) {
        return [];
      }

      const params = new URLSearchParams({
        q: debouncedQuery,
        family_id: requireFamilyId(family),
        limit: "20",
      });
      // Settings → Bring! → "Adopt Bring! categories". With it off, a
      // suggestion's category comes from our own keyword detection instead of
      // the Bring! section it happens to sit in. The switch previously did
      // nothing at all.
      if (bringSettings?.syncCategories === false) {
        params.set("bring_categories", "0");
      }

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

/** What a barcode lookup found: the product, or that nobody knows it. */
export type BarcodeLookup = { status: "found"; product: BarcodeResult } | { status: "unknown"; barcode: string };

/**
 * A product by its barcode (api/catalog/barcode): the family's own catalog,
 * then Open Food Facts and its sister databases, named in `lang` where they
 * have it. For the shopping list's scanner, which asks once per scan.
 */
export async function lookupBarcode(familyId: string, barcode: string, lang: string): Promise<BarcodeLookup> {
  const params = new URLSearchParams({ barcode, family_id: familyId, lang });
  const response = await fetch(`/api/catalog/barcode?${params}`);
  if (response.status === 404) return { status: "unknown", barcode };
  if (!response.ok) throw new Error(`barcode lookup failed: ${response.status}`);
  const data = await response.json();
  return { status: "found", product: data.product as BarcodeResult };
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

// Parsing moved to a server-safe lib so the Integration API can use the same
// rules; re-exported so existing imports keep working.
export { parseShoppingInput, type ParsedShoppingItem } from "@/lib/shopping-input";

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
