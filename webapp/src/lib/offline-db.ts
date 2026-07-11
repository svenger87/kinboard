// IndexedDB Operations for Offline Queue
// Provides persistent storage for offline operations and local items

import {
  OfflineQueueOperation,
  LocalShoppingItem,
  CachedData,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_STORES,
  METADATA_KEYS,
  QueueStats,
} from "@/types/offline";

// Open or create the offline database
export function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }

    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create offline queue store
      if (!db.objectStoreNames.contains(OFFLINE_STORES.QUEUE)) {
        const queueStore = db.createObjectStore(OFFLINE_STORES.QUEUE, {
          keyPath: "id",
        });
        queueStore.createIndex("by-timestamp", "timestamp");
        queueStore.createIndex("by-table", "table");
        queueStore.createIndex("by-status", "status");
        queueStore.createIndex("by-family", "familyId");
      }

      // Create local items store (for optimistic creates)
      if (!db.objectStoreNames.contains(OFFLINE_STORES.LOCAL_ITEMS)) {
        const localStore = db.createObjectStore(OFFLINE_STORES.LOCAL_ITEMS, {
          keyPath: "localId",
        });
        localStore.createIndex("by-table", "table");
        localStore.createIndex("by-family", "familyId");
      }

      // Create metadata store
      if (!db.objectStoreNames.contains(OFFLINE_STORES.METADATA)) {
        db.createObjectStore(OFFLINE_STORES.METADATA, { keyPath: "key" });
      }

      // Create data cache store (for offline reads)
      if (!db.objectStoreNames.contains(OFFLINE_STORES.DATA_CACHE)) {
        const cacheStore = db.createObjectStore(OFFLINE_STORES.DATA_CACHE, {
          keyPath: "cacheKey",
        });
        cacheStore.createIndex("by-table", "table");
      }
    };
  });
}

// ==================
// QUEUE OPERATIONS
// ==================

// Add an operation to the queue
export async function addToQueue(
  operation: OfflineQueueOperation
): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.QUEUE, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.QUEUE);
    const request = store.add(operation);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Get all pending operations for a family, ordered by timestamp
export async function getQueuedOperations(
  familyId: string
): Promise<OfflineQueueOperation[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.QUEUE, "readonly");
    const store = tx.objectStore(OFFLINE_STORES.QUEUE);
    const index = store.index("by-family");
    const request = index.getAll(familyId);

    request.onsuccess = () => {
      const operations = (request.result as OfflineQueueOperation[])
        .filter((op) => op.status !== "syncing") // Exclude currently syncing
        .sort((a, b) => a.timestamp - b.timestamp); // FIFO order
      resolve(operations);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Get pending operations that need to be synced
export async function getPendingOperations(
  familyId: string
): Promise<OfflineQueueOperation[]> {
  const all = await getQueuedOperations(familyId);
  return all.filter((op) => op.status === "pending" || op.status === "failed");
}

// Update an operation in the queue
export async function updateQueueOperation(
  id: string,
  updates: Partial<OfflineQueueOperation>
): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.QUEUE, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.QUEUE);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      if (!getRequest.result) {
        reject(new Error(`Operation ${id} not found`));
        return;
      }
      const updated = { ...getRequest.result, ...updates };
      const putRequest = store.put(updated);
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

// Remove an operation from the queue (after successful sync)
export async function removeFromQueue(id: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.QUEUE, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.QUEUE);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Remove all queued operations tied to a local (never-synced) item id.
// A "create" op keys off data.localId; an "update" queued against the same
// item before it synced keys off data.serverId holding that same local_
// string (see useOfflineUpdateShoppingItem, which always writes the target
// id into serverId regardless of whether it's a real server id yet). Both
// must be purged so a deleted local item leaves no trace to resurrect on sync.
export async function removeQueueOperationsForLocalId(
  localId: string
): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.QUEUE, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.QUEUE);
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const op = cursor.value as OfflineQueueOperation;
      if (op.data.localId === localId || op.data.serverId === localId) {
        cursor.delete();
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Clear all completed/synced operations for a family
export async function clearSyncedOperations(familyId: string): Promise<void> {
  const operations = await getQueuedOperations(familyId);
  const db = await openOfflineDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.QUEUE, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.QUEUE);

    for (const op of operations) {
      if (op.status === "syncing") {
        store.delete(op.id);
      }
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Get queue statistics
export async function getQueueStats(familyId: string): Promise<QueueStats> {
  const operations = await getQueuedOperations(familyId);

  const pending = operations.filter((op) => op.status === "pending");
  const failed = operations.filter((op) => op.status === "failed");

  return {
    pendingCount: pending.length,
    failedCount: failed.length,
    oldestPending: pending.length > 0 ? pending[0].timestamp : undefined,
  };
}

// ==================
// LOCAL ITEMS (OPTIMISTIC CREATES)
// ==================

interface LocalItemRecord {
  localId: string;
  table: string;
  familyId: string;
  data: LocalShoppingItem;
  createdAt: number;
}

// Save a local item (before it's synced to server)
export async function saveLocalItem(
  localId: string,
  table: string,
  familyId: string,
  data: LocalShoppingItem
): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.LOCAL_ITEMS, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.LOCAL_ITEMS);
    const record: LocalItemRecord = {
      localId,
      table,
      familyId,
      data,
      createdAt: Date.now(),
    };
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Get all local items for a table and family
export async function getLocalItems(
  table: string,
  familyId: string
): Promise<LocalShoppingItem[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.LOCAL_ITEMS, "readonly");
    const store = tx.objectStore(OFFLINE_STORES.LOCAL_ITEMS);
    const index = store.index("by-family");
    const request = index.getAll(familyId);

    request.onsuccess = () => {
      const records = (request.result as LocalItemRecord[]).filter(
        (r) => r.table === table
      );
      resolve(records.map((r) => r.data));
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Remove a local item (after successful sync assigns server ID)
export async function removeLocalItem(localId: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.LOCAL_ITEMS, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.LOCAL_ITEMS);
    const request = store.delete(localId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Update a local item's data
export async function updateLocalItem(
  localId: string,
  updates: Partial<LocalShoppingItem>
): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.LOCAL_ITEMS, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.LOCAL_ITEMS);
    const getRequest = store.get(localId);

    getRequest.onsuccess = () => {
      if (!getRequest.result) {
        // Item not found - might already be synced
        resolve();
        return;
      }
      const record = getRequest.result as LocalItemRecord;
      record.data = { ...record.data, ...updates };
      const putRequest = store.put(record);
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

// ==================
// METADATA
// ==================

// Get metadata value
export async function getMetadata<T>(key: string): Promise<T | null> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.METADATA, "readonly");
    const store = tx.objectStore(OFFLINE_STORES.METADATA);
    const request = store.get(key);
    request.onsuccess = () => {
      resolve(request.result?.value ?? null);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Set metadata value
export async function setMetadata<T>(key: string, value: T): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.METADATA, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.METADATA);
    const request = store.put({ key, value });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Update last sync time
export async function updateLastSyncTime(): Promise<void> {
  await setMetadata(METADATA_KEYS.LAST_SYNC, Date.now());
}

// Get last sync time
export async function getLastSyncTime(): Promise<number | null> {
  return getMetadata<number>(METADATA_KEYS.LAST_SYNC);
}

// ==================
// MERGE HELPERS
// ==================

// Merge operations for the same item (optimization)
// e.g., multiple updates to same item become one update
export function mergeOperations(
  operations: OfflineQueueOperation[]
): OfflineQueueOperation[] {
  const itemOperations = new Map<string, OfflineQueueOperation[]>();

  // Group by item (serverId or localId)
  for (const op of operations) {
    const key = op.data.serverId || op.data.localId || op.id;
    if (!itemOperations.has(key)) {
      itemOperations.set(key, []);
    }
    itemOperations.get(key)!.push(op);
  }

  const merged: OfflineQueueOperation[] = [];

  // Use Array.from for compatibility with older TS targets
  for (const ops of Array.from(itemOperations.values())) {
    if (ops.length === 1) {
      merged.push(ops[0]);
      continue;
    }

    // Sort by timestamp
    ops.sort((a, b) => a.timestamp - b.timestamp);

    // Check if there's a delete - if so, only keep delete
    const deleteOp = ops.find((op) => op.type === "delete");
    if (deleteOp) {
      // If item was created then deleted locally, remove both
      const createOp = ops.find((op) => op.type === "create");
      if (createOp) {
        // Don't add anything - item never existed on server
        continue;
      }
      merged.push(deleteOp);
      continue;
    }

    // Merge multiple updates into one
    const createOp = ops.find((op) => op.type === "create");
    const updates = ops.filter((op) => op.type === "update");

    if (createOp) {
      // Merge all updates into create payload
      let mergedPayload = { ...createOp.data.payload };
      for (const update of updates) {
        mergedPayload = { ...mergedPayload, ...update.data.payload };
      }
      merged.push({
        ...createOp,
        data: { ...createOp.data, payload: mergedPayload },
        timestamp: ops[ops.length - 1].timestamp, // Use latest timestamp
      });
    } else if (updates.length > 0) {
      // Merge all updates
      let mergedPayload: Record<string, unknown> = {};
      for (const update of updates) {
        mergedPayload = { ...mergedPayload, ...update.data.payload };
      }
      merged.push({
        ...updates[0],
        data: { ...updates[0].data, payload: mergedPayload },
        timestamp: updates[updates.length - 1].timestamp,
      });
    }
  }

  return merged.sort((a, b) => a.timestamp - b.timestamp);
}

// ==================
// DATA CACHE (OFFLINE READS)
// ==================

// Cache query result data for offline access
export async function cacheQueryData(
  cacheKey: string,
  table: string,
  data: unknown
): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.DATA_CACHE, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.DATA_CACHE);
    const entry: CachedData = { cacheKey, table, data, updatedAt: Date.now() };
    const request = store.put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Get cached data for a query key
export async function getCachedQueryData<T>(
  cacheKey: string
): Promise<CachedData<T> | null> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.DATA_CACHE, "readonly");
    const store = tx.objectStore(OFFLINE_STORES.DATA_CACHE);
    const request = store.get(cacheKey);
    request.onsuccess = () => resolve((request.result as CachedData<T>) ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// Clear cached data by table or all
export async function clearCachedData(table?: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.DATA_CACHE, "readwrite");
    const store = tx.objectStore(OFFLINE_STORES.DATA_CACHE);

    if (!table) {
      store.clear();
    } else {
      const index = store.index("by-table");
      const request = index.getAllKeys(table);
      request.onsuccess = () => {
        for (const key of request.result) {
          store.delete(key);
        }
      };
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
