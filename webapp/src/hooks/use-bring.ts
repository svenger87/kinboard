"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetting, useUpdateSetting } from "./use-supabase-queries";

export interface BringCredentials {
  uuid: string;
  email: string;
  name: string;
  defaultListId: string;
  accessToken: string;
  refreshToken: string;
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

  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const response = await fetch("/api/bring/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
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
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
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
  const updateSetting = useUpdateSetting();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await updateSetting.mutateAsync({
        key: "bring_settings",
        value: DEFAULT_SETTINGS,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bring"] });
    },
  });
}

export function useBringLists() {
  const { data: settings } = useBringSettings();
  const credentials = settings?.credentials;

  return useQuery({
    queryKey: ["bring", "lists", credentials?.uuid],
    queryFn: async (): Promise<BringList[]> => {
      if (!credentials) return [];

      const response = await fetch("/api/bring/lists", {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "X-Bring-UUID": credentials.uuid,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch lists");
      }

      return response.json();
    },
    enabled: !!credentials,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useBringItems(listId?: string | null) {
  const { data: settings } = useBringSettings();
  const credentials = settings?.credentials;
  const effectiveListId = listId || settings?.selectedListId;

  return useQuery({
    queryKey: ["bring", "items", effectiveListId],
    queryFn: async () => {
      if (!credentials || !effectiveListId) return { items: [], recentItems: [] };

      const response = await fetch(`/api/bring/items?listId=${effectiveListId}`, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch items");
      }

      return response.json();
    },
    enabled: !!credentials && !!effectiveListId,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes
  });
}

export function useBringAddItem() {
  const { data: settings } = useBringSettings();
  const credentials = settings?.credentials;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, itemName, specification }: { listId: string; itemName: string; specification?: string }) => {
      if (!credentials) throw new Error("Not authenticated");

      const response = await fetch("/api/bring/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.accessToken}`,
        },
        body: JSON.stringify({ listId, itemName, specification }),
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
  const { data: settings } = useBringSettings();
  const credentials = settings?.credentials;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, itemName }: { listId: string; itemName: string }) => {
      if (!credentials) throw new Error("Not authenticated");

      const response = await fetch(`/api/bring/items?listId=${listId}&itemName=${encodeURIComponent(itemName)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
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
