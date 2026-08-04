"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  OfflineQueueOperation,
  SyncResult,
  QueueStats,
  generateOperationId,
  OfflineOperationType,
  OfflineSupportedTable,
} from "@/types/offline";
import {
  addToQueue,
  getQueuedOperations,
  getPendingOperations,
  updateQueueOperation,
  removeFromQueue,
  getQueueStats,
  mergeOperations,
  updateLastSyncTime,
} from "@/lib/offline-db";
import { useOnlineStatus } from "./use-online-status";
import { useFamilyStore } from "@/stores/family-store";
import { createClient } from "@/lib/supabase/client";

interface UseOfflineQueueOptions {
  // Auto-sync when coming back online
  autoSync?: boolean;
  // Max retries before marking as failed
  maxRetries?: number;
  // Delay between retries (ms)
  retryDelay?: number;
  // Callback on sync complete
  onSyncComplete?: (result: SyncResult) => void;
  // Callback on sync error
  onSyncError?: (error: Error) => void;
}

/**
 * Families currently being drained, shared by every hook instance.
 *
 * `syncInProgressRef` below is a `useRef`, so it only ever guarded
 * re-entry *within one instance*. use-offline-shopping mounts five
 * instances in a single component tree, each with its own ref and its own
 * auto-sync effect — and `autoSync` defaults to true. On reconnect all
 * five saw `wasOffline && isOnline && pendingCount > 0` in the same
 * commit and all called processQueue(). Each read the pending list before
 * any of them had marked a row "syncing", so they executed the same
 * inserts: adding three items offline could produce up to fifteen copies,
 * while operations one processor removed made another throw and abandon
 * the rest of its batch.
 *
 * Module scope is the right shape here because the instances share a tab
 * and a database. It does NOT coordinate across tabs — two open boards
 * can still overlap. That needs a claim in IndexedDB itself, which is a
 * larger change; this removes the failure that happens on every
 * reconnect, not the one that needs two tabs.
 */
const drainingFamilies = new Set<string>();

const DEFAULT_OPTIONS: Required<UseOfflineQueueOptions> = {
  autoSync: true,
  maxRetries: 3,
  retryDelay: 2000,
  onSyncComplete: () => {},
  onSyncError: () => {},
};

/**
 * Core hook for managing the offline operation queue
 */
export function useOfflineQueue(options: UseOfflineQueueOptions = {}) {
  const opts = useMemo(
    () => ({ ...DEFAULT_OPTIONS, ...options }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only depend on specific option values
    [options.autoSync, options.maxRetries, options.retryDelay, options.onSyncComplete, options.onSyncError]
  );
  const { family } = useFamilyStore();
  const familyId = family?.id;
  const { isOnline, wasOffline } = useOnlineStatus();
  const queryClient = useQueryClient();

  const [isSyncing, setIsSyncing] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats>({
    pendingCount: 0,
    failedCount: 0,
  });
  const syncInProgressRef = useRef(false);

  // Refresh queue stats
  const refreshStats = useCallback(async () => {
    if (!familyId) return;
    try {
      const stats = await getQueueStats(familyId);
      setQueueStats(stats);
    } catch (error) {
      console.error("Failed to get queue stats:", error);
    }
  }, [familyId]);

  // Add a new operation to the queue
  const addOperation = useCallback(
    async (
      type: OfflineOperationType,
      table: OfflineSupportedTable,
      data: OfflineQueueOperation["data"],
      bringSync?: OfflineQueueOperation["bringSync"]
    ): Promise<string> => {
      if (!familyId) throw new Error("No family context");

      const operation: OfflineQueueOperation = {
        id: generateOperationId(),
        type,
        table,
        timestamp: Date.now(),
        familyId,
        data,
        retryCount: 0,
        status: "pending",
        bringSync,
      };

      await addToQueue(operation);
      await refreshStats();

      return operation.id;
    },
    [familyId, refreshStats]
  );

  // Execute a single operation against Supabase
  const executeOperation = useCallback(
    async (operation: OfflineQueueOperation): Promise<{ success: boolean; serverId?: string; error?: string }> => {
      const supabase = createClient();

      try {
        switch (operation.type) {
          case "create": {
             
            const { data, error } = await (supabase as any)
              .from(operation.table)
              .insert({
                ...operation.data.payload,
                family_id: operation.familyId,
              })
              .select()
              .single();

            if (error) throw error;
            return { success: true, serverId: data.id };
          }

          case "update": {
            if (!operation.data.serverId) {
              return { success: false, error: "No server ID for update" };
            }
             
            const { error } = await (supabase as any)
              .from(operation.table)
              .update(operation.data.payload)
              .eq("id", operation.data.serverId);

            if (error) throw error;
            return { success: true };
          }

          case "delete": {
            if (!operation.data.serverId) {
              return { success: false, error: "No server ID for delete" };
            }
             
            const { error } = await (supabase as any)
              .from(operation.table)
              .delete()
              .eq("id", operation.data.serverId);

            if (error) throw error;
            return { success: true };
          }

          default:
            return { success: false, error: `Unknown operation type: ${operation.type}` };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    },
    []
  );

  // Process the entire queue
  const processQueue = useCallback(async (): Promise<SyncResult> => {
    // The module-level set is what actually prevents concurrent drains —
    // the ref only ever covered this one instance, and there are five.
    if (!familyId || syncInProgressRef.current || drainingFamilies.has(familyId)) {
      return { success: false, syncedCount: 0, failedCount: 0, errors: [] };
    }

    drainingFamilies.add(familyId);
    syncInProgressRef.current = true;
    setIsSyncing(true);

    const result: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      errors: [],
    };

    try {
      // Get and merge pending operations
      const pending = await getPendingOperations(familyId);
      const { operations, discarded } = mergeOperations(pending);

      // Rows that merged away to nothing — an item created and deleted while
      // offline never reached the server, so there's nothing to send, but the
      // rows still have to leave the queue. They used to stay behind as
      // "pending" for good.
      for (const id of discarded) {
        await removeFromQueue(id);
      }

      for (const operation of operations) {
        // Mark every row this operation stands in for as syncing, not just
        // the survivor, so the badge reflects what is actually happening.
        const sourceIds = operation.mergedFrom ?? [operation.id];
        for (const id of sourceIds) {
          await updateQueueOperation(id, { status: "syncing" });
        }

        const { success, error } = await executeOperation(operation);

        if (success) {
          // Remove every row that went into this request. Removing only the
          // merged operation's own id left the rest pending forever, and the
          // next drain re-merged and re-sent them.
          for (const id of sourceIds) {
            await removeFromQueue(id);
          }
          result.syncedCount++;
        } else {
          // Increment retry count or mark as failed
          const newRetryCount = operation.retryCount + 1;
          const newStatus = newRetryCount >= opts.maxRetries ? "failed" : "pending";

          // Put every source row back, or the ones that aren't the survivor
          // stay stuck on "syncing" and never retry.
          for (const id of sourceIds) {
            await updateQueueOperation(id, {
              status: newStatus,
              retryCount: newRetryCount,
              lastError: error,
            });
          }

          result.failedCount++;
          result.errors.push({ operationId: operation.id, error: error || "Unknown error" });

          if (newStatus === "failed") {
            result.success = false;
          }
        }
      }

      // Update last sync time
      await updateLastSyncTime();

      // Invalidate relevant queries to refresh data
      if (result.syncedCount > 0) {
        queryClient.invalidateQueries({ queryKey: ["shopping-items"] });
      }

      await refreshStats();
      opts.onSyncComplete(result);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      opts.onSyncError(err);
      return { success: false, syncedCount: 0, failedCount: 0, errors: [] };
    } finally {
      drainingFamilies.delete(familyId);
      syncInProgressRef.current = false;
      setIsSyncing(false);
    }
  }, [familyId, executeOperation, opts, queryClient, refreshStats]);

  // Clear all failed operations
  const clearFailedOperations = useCallback(async () => {
    if (!familyId) return;

    const pending = await getQueuedOperations(familyId);
    for (const op of pending) {
      if (op.status === "failed") {
        await removeFromQueue(op.id);
      }
    }
    await refreshStats();
  }, [familyId, refreshStats]);

  // Retry a specific failed operation
  const retryOperation = useCallback(
    async (operationId: string) => {
      await updateQueueOperation(operationId, {
        status: "pending",
        retryCount: 0,
        lastError: undefined,
      });
      await refreshStats();

      // Trigger sync if online
      if (isOnline) {
        processQueue();
      }
    },
    [isOnline, processQueue, refreshStats]
  );

  // Initial stats load
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (opts.autoSync && wasOffline && isOnline && queueStats.pendingCount > 0) {
      processQueue();
    }
  }, [opts.autoSync, wasOffline, isOnline, queueStats.pendingCount, processQueue]);

  return {
    // State
    isSyncing,
    isOnline,
    queueStats,
    hasPendingOperations: queueStats.pendingCount > 0 || queueStats.failedCount > 0,

    // Actions
    addOperation,
    processQueue,
    clearFailedOperations,
    retryOperation,
    refreshStats,
  };
}

/**
 * Simple hook to get queue status for UI display
 */
export function useOfflineQueueStatus() {
  const { family } = useFamilyStore();
  const familyId = family?.id;
  const { isOnline } = useOnlineStatus();
  const [stats, setStats] = useState<QueueStats>({ pendingCount: 0, failedCount: 0 });

  useEffect(() => {
    if (!familyId) return;

    const updateStats = async () => {
      try {
        const newStats = await getQueueStats(familyId);
        setStats(newStats);
      } catch {
        // Ignore errors
      }
    };

    updateStats();

    // Poll for updates every 5 seconds
    const interval = setInterval(updateStats, 5000);
    return () => clearInterval(interval);
  }, [familyId]);

  return {
    isOnline,
    pendingCount: stats.pendingCount,
    failedCount: stats.failedCount,
    hasPending: stats.pendingCount > 0 || stats.failedCount > 0,
  };
}
