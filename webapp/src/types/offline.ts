// Offline Queue Types for Shopping List Sync

import { ShoppingItem } from "./database";

// Operation types supported by offline queue
export type OfflineOperationType = "create" | "update" | "delete";

// Tables that support offline operations
export type OfflineSupportedTable = "shopping_items";

// Base queue operation structure
export interface OfflineQueueOperation {
  id: string; // UUID for the operation
  type: OfflineOperationType;
  table: OfflineSupportedTable;
  timestamp: number; // When operation was queued (ms since epoch)
  familyId: string; // Family context
  data: {
    localId?: string; // Temp UUID for creates (before server assigns ID)
    serverId?: string; // Real server ID for updates/deletes
    payload: Record<string, unknown>; // The actual data
  };
  retryCount: number;
  lastError?: string;
  status: "pending" | "syncing" | "failed";
  // Optional Bring! sync data
  bringSync?: {
    action: "add" | "remove";
    listId: string;
    itemName: string;
    specification?: string;
  };
}

// Sync status for items
export type SyncStatus = "synced" | "pending" | "error";

// Extended shopping item with offline metadata
export interface LocalShoppingItem extends ShoppingItem {
  _localId?: string; // Present if item is not yet synced to server
  _pendingDelete?: boolean; // True if deletion is queued
  _pendingUpdate?: Partial<ShoppingItem>; // Pending field updates
  _syncStatus?: SyncStatus;
}

// Result of a sync operation
export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors: Array<{ operationId: string; error: string }>;
}

// Queue statistics
export interface QueueStats {
  pendingCount: number;
  failedCount: number;
  oldestPending?: number; // Timestamp of oldest pending operation
}

// Cached data entry for offline reads
export interface CachedData<T = unknown> {
  cacheKey: string;
  table: string;
  data: T;
  updatedAt: number; // ms since epoch
}

// IndexedDB store names
export const OFFLINE_DB_NAME = "FamilyCalendarOffline";
export const OFFLINE_DB_VERSION = 2;

export const OFFLINE_STORES = {
  QUEUE: "offlineQueue",
  LOCAL_ITEMS: "localItems",
  METADATA: "syncMetadata",
  DATA_CACHE: "dataCache",
} as const;

// Metadata keys
export const METADATA_KEYS = {
  LAST_SYNC: "lastSyncTime",
  QUEUE_VERSION: "queueVersion",
} as const;

// Generate a unique ID for operations
export function generateOperationId(): string {
  return crypto.randomUUID();
}

// Generate a local ID for optimistic creates
export function generateLocalId(): string {
  return `local_${crypto.randomUUID()}`;
}
