"use client";

import { useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingItem } from "@/types/database";
import { LocalShoppingItem, generateLocalId, SyncStatus } from "@/types/offline";
import {
  useCreateShoppingItem,
  useUpdateShoppingItem,
  useDeleteShoppingItem,
  queryKeys,
  requireFamilyId,
} from "./use-supabase-queries";
import { useOfflineCachedQuery } from "./use-offline-cache";
import { useOfflineQueue } from "./use-offline-queue";
import { useOnlineStatus } from "./use-online-status";
import { useFamilyStore } from "@/stores/family-store";
import { createClient } from "@/lib/supabase/client";
import {
  saveLocalItem,
  getLocalItems,
  removeLocalItem,
  removeQueueOperationsForLocalId,
  cacheQueryData,
} from "@/lib/offline-db";

/**
 * Extended shopping item with sync status metadata
 */
export interface OfflineShoppingItem extends ShoppingItem {
  _syncStatus: SyncStatus;
  _localId?: string;
}

/**
 * Hook to get shopping items with offline cache support.
 * Merges server/cached items with local offline items.
 */
export function useOfflineShoppingItems() {
  const { family } = useFamilyStore();
  const familyId = family?.id ?? "";
  const { queueStats } = useOfflineQueue();
  const supabase = createClient();

  // Use offline-cached query instead of raw useShoppingItems
  const {
    data: serverItems,
    isLoading,
    error,
    refetch,
    isFromCache,
  } = useOfflineCachedQuery<ShoppingItem[]>(
    queryKeys.shoppingItems(familyId),
    async () => {
       
      const { data, error } = await (supabase as any)
        .from("shopping_items")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as ShoppingItem[];
    },
    {
      table: "shopping_items",
      enabled: !!familyId,
      gcTime: 60 * 60 * 1000, // Keep shopping data cached for 1 hour
    }
  );

  // Merge server items with local pending items
  const items = useMemo((): OfflineShoppingItem[] => {
    const result: OfflineShoppingItem[] = (serverItems ?? []).map((item) => ({
      ...item,
      _syncStatus: "synced" as SyncStatus,
    }));

    return result;
  }, [serverItems]);

  const hasPendingSync = queueStats.pendingCount > 0 || queueStats.failedCount > 0;

  return {
    items,
    isLoading,
    error,
    refetch,
    isFromCache,
    hasPendingSync,
    pendingCount: queueStats.pendingCount,
    failedCount: queueStats.failedCount,
  };
}

/**
 * Create shopping item with offline support
 */
export function useOfflineCreateShoppingItem() {
  const { isOnline } = useOnlineStatus();
  const { addOperation } = useOfflineQueue();
  const createMutation = useCreateShoppingItem();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (item: {
      name: string;
      category?: string;
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      image_url?: string | null;
      catalog_item_id?: string | null;
      recipe_id?: string | null;
      added_by?: string | null;
    }) => {
      if (isOnline) {
        return createMutation.mutateAsync(item);
      }

      // Offline: create local item and queue operation
      const localId = generateLocalId();
      const localItem: LocalShoppingItem = {
        id: localId,
        family_id: requireFamilyId(family),
        name: item.name,
        checked: false,
        category: item.category || null,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        notes: item.notes ?? null,
        image_url: item.image_url ?? null,
        catalog_item_id: item.catalog_item_id ?? null,
        recipe_id: item.recipe_id ?? null,
        added_by: item.added_by ?? null,
        bring_item_id: null,
        created_at: new Date().toISOString(),
        _localId: localId,
        _syncStatus: "pending",
      };

      await saveLocalItem(localId, "shopping_items", requireFamilyId(family), localItem);
      await addOperation("create", "shopping_items", {
        localId,
        payload: item,
      });

      // Optimistically add to cache
      const familyId = requireFamilyId(family);
      const qk = queryKeys.shoppingItems(familyId);
      const updatedItems = queryClient.setQueryData<ShoppingItem[]>(
        qk,
        (old) => [localItem as ShoppingItem, ...(old ?? [])]
      );

      // Persist to IndexedDB
      if (updatedItems) {
        cacheQueryData(JSON.stringify(qk), "shopping_items", updatedItems).catch(() => {});
      }

      return localItem as ShoppingItem;
    },
    onSuccess: () => {
      if (isOnline) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.shoppingItems(requireFamilyId(family)),
        });
      }
    },
  });
}

/**
 * Update shopping item with offline support
 */
export function useOfflineUpdateShoppingItem() {
  const { isOnline } = useOnlineStatus();
  const { addOperation } = useOfflineQueue();
  const updateMutation = useUpdateShoppingItem();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<ShoppingItem> & { id: string }) => {
      const familyId = requireFamilyId(family);
      const qk = queryKeys.shoppingItems(familyId);

      // Always optimistically update TanStack cache
      const updatedItems = queryClient.setQueryData<ShoppingItem[]>(
        qk,
        (old) => {
          if (!old) return old;
          return old.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          );
        }
      );

      // Also persist optimistic update to IndexedDB cache so offline reads stay current
      if (updatedItems) {
        cacheQueryData(JSON.stringify(qk), "shopping_items", updatedItems).catch(() => {});
      }

      if (isOnline) {
        return updateMutation.mutateAsync({ id, ...updates });
      }

      // Offline: queue the update
      await addOperation("update", "shopping_items", {
        serverId: id,
        payload: updates,
      });

      return { id, ...updates } as ShoppingItem;
    },
  });
}

/**
 * Delete shopping item with offline support
 */
export function useOfflineDeleteShoppingItem() {
  const { isOnline } = useOnlineStatus();
  const { addOperation } = useOfflineQueue();
  const deleteMutation = useDeleteShoppingItem();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
      const familyId = requireFamilyId(family);
      const qk = queryKeys.shoppingItems(familyId);

      // Optimistically remove from cache
      const updatedItems = queryClient.setQueryData<ShoppingItem[]>(
        qk,
        (old) => {
          if (!old) return old;
          return old.filter((item) => item.id !== id);
        }
      );

      // Persist to IndexedDB cache
      if (updatedItems) {
        cacheQueryData(JSON.stringify(qk), "shopping_items", updatedItems).catch(() => {});
      }

      if (id.startsWith("local_")) {
        await removeLocalItem(id);
        // Also cancel the still-pending "create" (and any "update") queue
        // ops for this id — otherwise sync later re-creates the item we
        // just "deleted", duplicating it alongside any undo re-create.
        await removeQueueOperationsForLocalId(id);
        return;
      }

      if (isOnline) {
        return deleteMutation.mutateAsync(id);
      }

      await addOperation("delete", "shopping_items", {
        serverId: id,
        payload: {},
      });
    },
  });
}

/**
 * Toggle shopping item checked status with offline support
 */
export function useOfflineToggleShoppingItem() {
  const updateMutation = useOfflineUpdateShoppingItem();

  return useMutation({
    mutationFn: async ({ id, checked }: { id: string; checked: boolean }) => {
      return updateMutation.mutateAsync({ id, checked });
    },
  });
}

/**
 * Convenience hook that returns all offline-aware shopping operations
 */
export function useOfflineShopping() {
  const {
    items,
    isLoading,
    error,
    refetch,
    isFromCache,
    hasPendingSync,
    pendingCount,
    failedCount,
  } = useOfflineShoppingItems();

  const createItem = useOfflineCreateShoppingItem();
  const updateItem = useOfflineUpdateShoppingItem();
  const deleteItem = useOfflineDeleteShoppingItem();
  const toggleItem = useOfflineToggleShoppingItem();

  const { isOnline } = useOnlineStatus();
  const { processQueue, isSyncing } = useOfflineQueue();

  const syncNow = useCallback(async () => {
    if (isOnline && hasPendingSync) {
      await processQueue();
      await refetch();
    }
  }, [isOnline, hasPendingSync, processQueue, refetch]);

  return {
    items,
    isLoading,
    error,
    isOnline,
    isSyncing,
    isFromCache,
    hasPendingSync,
    pendingCount,
    failedCount,
    createItem,
    updateItem,
    deleteItem,
    toggleItem,
    refetch,
    syncNow,
  };
}
