"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { cacheQueryData, getCachedQueryData } from "@/lib/offline-db";

/**
 * Generic hook that wraps a TanStack Query with IndexedDB offline cache.
 *
 * - Online: fetches normally, persists result to IndexedDB on success
 * - Offline: serves cached data from IndexedDB when fetch fails
 * - Any module can use this by providing a queryKey, queryFn, and table name
 *
 * Usage:
 *   const { data, isFromCache } = useOfflineCachedQuery(
 *     ["shopping", familyId],
 *     () => fetchItems(familyId),
 *     { table: "shopping_items" }
 *   );
 */
export function useOfflineCachedQuery<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  options: {
    table: string;
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
) {
  const { table, enabled = true, staleTime, gcTime } = options;
  const cacheKey = JSON.stringify(queryKey);
  const [cachedData, setCachedData] = useState<T | undefined>(undefined);
  const [isFromCache, setIsFromCache] = useState(false);
  const hasLoadedCache = useRef(false);

  // Load cached data on mount (before first fetch)
  useEffect(() => {
    if (!enabled || hasLoadedCache.current) return;
    hasLoadedCache.current = true;

    getCachedQueryData<T>(cacheKey).then((cached) => {
      if (cached) {
        setCachedData(cached.data);
      }
    }).catch(() => {
      // IndexedDB not available — ignore
    });
  }, [cacheKey, enabled]);

  // Wrapped query function: persist on success, fallback on error
  const wrappedQueryFn = async (): Promise<T> => {
    try {
      const result = await queryFn();
      // Persist to IndexedDB for offline access
      setIsFromCache(false);
      cacheQueryData(cacheKey, table, result).catch(() => {
        // Cache write failed — non-critical
      });
      // Update local cache state too
      setCachedData(result);
      return result;
    } catch (error) {
      // Fetch failed (likely offline) — try IndexedDB cache
      const cached = await getCachedQueryData<T>(cacheKey).catch(() => null);
      if (cached) {
        setIsFromCache(true);
        setCachedData(cached.data);
        return cached.data;
      }
      // No cache available — rethrow
      throw error;
    }
  };

  const queryOptions: UseQueryOptions<T> = {
    queryKey,
    queryFn: wrappedQueryFn,
    enabled,
    // Use cached data as initial data while fetching
    ...(cachedData !== undefined ? { initialData: cachedData } : {}),
    // Keep cached data longer to survive brief disconnects
    staleTime: staleTime ?? 60 * 1000,
    gcTime: gcTime ?? 30 * 60 * 1000, // 30 minutes (vs default 5 min)
    // Retry less aggressively when offline
    retry: (failureCount, error) => {
      // Don't retry network errors endlessly
      if (error instanceof TypeError && error.message.includes("fetch")) {
        return failureCount < 1;
      }
      return failureCount < 2;
    },
  };

  const query = useQuery(queryOptions);

  return {
    ...query,
    isFromCache,
    cachedAt: cachedData ? undefined : undefined, // Could add timestamp tracking
  };
}
