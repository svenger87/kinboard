"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetting, useUpdateSetting } from "./use-supabase-queries";
import { useFamilyStore } from "@/stores/family-store";

export interface BringCredentials {
  uuid: string;
  email: string;
  name: string;
  defaultListId: string;
  expiresAt: number;
}

export interface BringList {
  id: string;
  name: string;
  theme?: string;
}

export interface BringItem {
  name: string;
  specification: string;
  completed: boolean;
}

export interface BringSettings {
  credentials: BringCredentials | null;
  selectedListId: string | null;
  autoSync: boolean;
  twoWaySync: boolean;
  syncCategories: boolean;
}

// Bring! Catalog types
export interface BringCatalogItem {
  itemId: string;
  name: string;
  sectionId: string;
  sectionName: string;
}

export interface BringCatalog {
  sections: string[];
  articles: BringCatalogItem[];
  totalItems: number;
}

import { BRING_TO_LOCAL_CATEGORY, detectCategory } from "@/lib/shopping-categories";

const DEFAULT_SETTINGS: BringSettings = {
  credentials: null,
  selectedListId: null,
  autoSync: true,
  twoWaySync: true,
  syncCategories: true,
};

export function useBringSettings() {
  return useSetting<BringSettings>("bring_settings", DEFAULT_SETTINGS);
}

export function useBringLogin() {
  const queryClient = useQueryClient();
  const updateSetting = useUpdateSetting();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch("/api/bring/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, family_id: family.id }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Login failed");
      }

      return response.json();
    },
    onSuccess: async (data) => {
      const credentials: BringCredentials = {
        uuid: data.uuid,
        email: data.email,
        name: data.name,
        defaultListId: data.defaultListId,
        expiresAt: Date.now() + data.expiresIn * 1000,
      };

      // Get current settings and update with credentials
      const currentSettings = queryClient.getQueryData<BringSettings>(["setting", "bring_settings"]) || DEFAULT_SETTINGS;

      await updateSetting.mutateAsync({
        key: "bring_settings",
        value: {
          ...currentSettings,
          credentials,
          selectedListId: data.defaultListId,
        },
      });

      queryClient.invalidateQueries({ queryKey: ["bring"] });
    },
  });
}

export function useBringLogout() {
  const { family } = useFamilyStore();
  const updateSetting = useUpdateSetting();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Clear the secrets row (and the setting) server-side; then restore
      // the default non-secret settings shape for the UI.
      if (family?.id) {
        await fetch("/api/settings", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ family_id: family.id, key: "bring_settings" }),
        });
      }
      await updateSetting.mutateAsync({
        key: "bring_settings",
        value: DEFAULT_SETTINGS,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bring"] });
      queryClient.invalidateQueries({ queryKey: ["setting", "bring_settings"] });
    },
  });
}

export function useBringLists() {
  const { family } = useFamilyStore();
  const { data: settings } = useBringSettings();
  const credentials = settings?.credentials;

  return useQuery({
    queryKey: ["bring", "lists", credentials?.uuid],
    queryFn: async (): Promise<BringList[]> => {
      if (!credentials || !family?.id) return [];

      const response = await fetch(`/api/bring/lists?family_id=${family.id}`);

      if (!response.ok) {
        throw new Error("Failed to fetch lists");
      }

      return response.json();
    },
    enabled: !!credentials && !!family?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useBringItems(listId?: string | null) {
  const { family } = useFamilyStore();
  const { data: settings } = useBringSettings();
  const credentials = settings?.credentials;
  const effectiveListId = listId || settings?.selectedListId;

  return useQuery({
    queryKey: ["bring", "items", effectiveListId],
    queryFn: async () => {
      if (!credentials || !effectiveListId || !family?.id) return { items: [], recentItems: [] };

      const response = await fetch(`/api/bring/items?listId=${effectiveListId}&family_id=${family.id}`);

      if (!response.ok) {
        throw new Error("Failed to fetch items");
      }

      return response.json();
    },
    enabled: !!credentials && !!effectiveListId && !!family?.id,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes
  });
}

export function useBringAddItem() {
  const { family } = useFamilyStore();
  const { data: settings } = useBringSettings();
  const credentials = settings?.credentials;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, itemName, specification }: { listId: string; itemName: string; specification?: string }) => {
      if (!credentials || !family?.id) throw new Error("Not authenticated");

      const response = await fetch("/api/bring/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ listId, itemName, specification, family_id: family.id }),
      });

      if (!response.ok) {
        throw new Error("Failed to add item");
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bring", "items", variables.listId] });
    },
  });
}

export function useBringRemoveItem() {
  const { family } = useFamilyStore();
  const { data: settings } = useBringSettings();
  const credentials = settings?.credentials;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, itemName }: { listId: string; itemName: string }) => {
      if (!credentials || !family?.id) throw new Error("Not authenticated");

      const response = await fetch(`/api/bring/items?listId=${listId}&itemName=${encodeURIComponent(itemName)}&family_id=${family.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to remove item");
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bring", "items", variables.listId] });
    },
  });
}

export function useUpdateBringSettings() {
  const updateSetting = useUpdateSetting();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<BringSettings>) => {
      const currentSettings = queryClient.getQueryData<BringSettings>(["setting", "bring_settings"]) || DEFAULT_SETTINGS;

      await updateSetting.mutateAsync({
        key: "bring_settings",
        value: { ...currentSettings, ...updates },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setting", "bring_settings"] });
    },
  });
}

// Catalog hook - fetches and caches the Bring! product catalog
export function useBringCatalog(locale: string = "de-DE") {
  return useQuery({
    queryKey: ["bring", "catalog", locale],
    queryFn: async (): Promise<BringCatalog> => {
      const response = await fetch(`/api/bring/catalog?locale=${locale}`);

      if (!response.ok) {
        throw new Error("Failed to fetch catalog");
      }

      return response.json();
    },
    staleTime: 24 * 60 * 60 * 1000, // 24 hours - catalog rarely changes
    gcTime: 7 * 24 * 60 * 60 * 1000, // Keep in cache for 7 days
  });
}

// Helper function to get the local category for a Bring! item
// Tries Bring! catalog first, then falls back to keyword-based detection
export function getBringItemCategory(
  itemName: string,
  catalog: BringCatalog | undefined
): string {
  if (catalog) {
    // Find the item in the catalog
    const catalogItem = catalog.articles.find(
      (article) => article.name.toLowerCase() === itemName.toLowerCase()
    );

    if (catalogItem) {
      const mapped = BRING_TO_LOCAL_CATEGORY[catalogItem.sectionName];
      if (mapped) return mapped;
    }
  }

  // Fall back to keyword-based detection
  return detectCategory(itemName);
}

// Helper to get suggested items from the catalog (for autocomplete)
export function useBringItemSuggestions(searchTerm: string) {
  const { data: catalog } = useBringCatalog();

  if (!catalog || !searchTerm || searchTerm.length < 2) {
    return [];
  }

  const search = searchTerm.toLowerCase();
  return catalog.articles
    .filter((article) => article.name.toLowerCase().includes(search))
    .slice(0, 10)
    .map((article) => ({
      name: article.name,
      category: BRING_TO_LOCAL_CATEGORY[article.sectionName] || detectCategory(article.name),
      sectionName: article.sectionName,
    }));
}
