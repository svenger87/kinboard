// Kinboard Service Worker
//
// CACHE_NAME bumps on every release via build-time string substitution
// performed in the Dockerfile (sed-replaces __KINBOARD_VERSION__ with
// the package.json version before `next build`). On activate, the SW
// deletes any cache whose name doesn't match this exact release —
// evicting stale `_next/static/chunks/*` from prior builds, which is
// what causes ChunkLoadError after Watchtower auto-updates.
//
// In dev (where the substitution doesn't happen), the literal token
// stays and acts as a single dev-cache that doesn't auto-evict.
const CACHE_NAME = 'kinboard-__KINBOARD_VERSION__';
const OFFLINE_URL = '/offline';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// Install event - precache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching assets');
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  // Deliberately NOT skipWaiting() here.
  //
  // Activating immediately looks helpful and breaks two things. The new
  // worker never enters the `waiting` state, so `registration.waiting` is
  // always null and the "update available" button in the UI had nothing
  // to message — tapping it did nothing at all, not even reload, and a
  // kiosk stayed on the old bundle indefinitely.
  //
  // It also runs the cache purge in `activate` while pages built against
  // the OLD bundle are still open and still lazy-loading chunks. Those
  // chunks are gone from the cache and gone from the server, which is the
  // ChunkLoadError this file's header says the versioned cache prevents.
  //
  // So: install, wait, and activate when the page asks below.
});

// The page asks for the update when the user accepts it — see the
// 'skipWaiting' branch of the message handler further down, which already
// existed and was unreachable while install skipped waiting on its own.

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Inside waitUntil: activation isn't finished until the claim resolves,
  // otherwise a client can still be talking to the old worker afterwards.
  event.waitUntil(self.clients.claim());
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Skip API requests (don't cache dynamic data)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // For navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached version or offline page
          return caches.match(request).then((cached) => {
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  // For static assets (JS, CSS, images) - cache first
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Return cached version and update in background
          fetch(request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, response);
              });
            }
          });
          return cached;
        }

        // Not in cache, fetch and cache
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }
});

// ===================
// DEVICE ID PERSISTENCE
// ===================
const DEVICE_ID_KEY = 'family-calendar-device-id';

// Open IndexedDB for device ID storage
function openDeviceDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('FamilyCalendarDevice', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config');
      }
    };
  });
}

async function storeDeviceId(deviceId) {
  try {
    const db = await openDeviceDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('config', 'readwrite');
      const store = tx.objectStore('config');
      const request = store.put(deviceId, DEVICE_ID_KEY);
      request.onsuccess = () => {
        console.log('[SW] Device ID stored:', deviceId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[SW] Failed to store device ID:', e);
  }
}

async function getStoredDeviceId() {
  try {
    const db = await openDeviceDB();
    return new Promise((resolve) => {
      const tx = db.transaction('config', 'readonly');
      const store = tx.objectStore('config');
      const request = store.get(DEVICE_ID_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

const FAMILY_ID_KEY = 'family-calendar-family-id';

async function storeFamilyId(familyId) {
  try {
    const db = await openDeviceDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('config', 'readwrite');
      const store = tx.objectStore('config');
      const request = store.put(familyId, FAMILY_ID_KEY);
      request.onsuccess = () => {
        console.log('[SW] Family ID stored:', familyId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[SW] Failed to store family ID:', e);
  }
}

async function getStoredFamilyId() {
  try {
    const db = await openDeviceDB();
    return new Promise((resolve) => {
      const tx = db.transaction('config', 'readonly');
      const store = tx.objectStore('config');
      const request = store.get(FAMILY_ID_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// Handle messages from the client
self.addEventListener('message', async (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }

  // Store device ID from client
  if (event.data?.type === 'STORE_DEVICE_ID' && event.data.deviceId) {
    await storeDeviceId(event.data.deviceId);
    return;
  }

  // Store family ID from client
  if (event.data?.type === 'STORE_FAMILY_ID' && event.data.familyId) {
    await storeFamilyId(event.data.familyId);
    return;
  }

  // Get device ID for client
  if (event.data?.type === 'GET_DEVICE_ID') {
    const deviceId = await getStoredDeviceId();
    event.source.postMessage({
      type: 'DEVICE_ID_RESPONSE',
      deviceId,
    });
    return;
  }
});

// ===================
// PUSH NOTIFICATIONS
// ===================

// Handle push events from the server
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received');

  let data = {
    title: 'Kinboard',
    body: 'Neue Benachrichtigung',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: 'default',
    url: '/',
  };

  // Try to parse push data
  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      console.error('[SW] Failed to parse push data:', e);
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/badge-72.png',
    tag: data.tag || 'default',
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
    requireInteraction: false,
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);
  event.notification.close();

  const url = event.notification.data?.url || '/';

  // Handle action button clicks
  if (event.action) {
    console.log('[SW] Action clicked:', event.action);
    // Handle specific actions here if needed
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Try to find an existing window and focus it
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // No existing window, open a new one
      return clients.openWindow(url);
    })
  );
});

// Handle notification close (user dismissed)
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification dismissed:', event.notification.tag);
});

// Handle push subscription changes (e.g., browser refreshed keys)
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] Push subscription changed');

  event.waitUntil(
    (async () => {
      try {
        // Re-subscribe with the same options
        const subscription = await self.registration.pushManager.subscribe(
          event.oldSubscription?.options || event.newSubscription?.options
        );

        const subscriptionJSON = subscription.toJSON();

        // Get device ID from IndexedDB
        const deviceId = await getStoredDeviceId();
        // Get family ID from IndexedDB
        const familyId = await getStoredFamilyId();

        if (!deviceId || !familyId) {
          console.error('[SW] Cannot re-subscribe: missing deviceId or familyId');
          return;
        }

        // Send the new subscription to our server in the expected format
        const response = await fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: subscriptionJSON.endpoint,
              keys: {
                p256dh: subscriptionJSON.keys?.p256dh,
                auth: subscriptionJSON.keys?.auth,
              },
            },
            deviceId,
            familyId,
            resubscribe: true,
          }),
        });

        if (response.ok) {
          console.log('[SW] Re-subscribed successfully after key change');
        } else {
          console.error('[SW] Re-subscribe failed:', response.status);
        }
      } catch (err) {
        console.error('[SW] Error handling subscription change:', err);
      }
    })()
  );
});

// ===================
// BACKGROUND SYNC FOR OFFLINE QUEUE
// ===================

const OFFLINE_DB_NAME = 'FamilyCalendarOffline';
const OFFLINE_DB_VERSION = 1;

// Open the offline queue database
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('offlineQueue')) {
        const queueStore = db.createObjectStore('offlineQueue', { keyPath: 'id' });
        queueStore.createIndex('by-timestamp', 'timestamp');
        queueStore.createIndex('by-status', 'status');
        queueStore.createIndex('by-family', 'familyId');
      }
      if (!db.objectStoreNames.contains('localItems')) {
        const localStore = db.createObjectStore('localItems', { keyPath: 'localId' });
        localStore.createIndex('by-family', 'familyId');
      }
      if (!db.objectStoreNames.contains('syncMetadata')) {
        db.createObjectStore('syncMetadata', { keyPath: 'key' });
      }
    };
  });
}

// Get pending operations from the queue
async function getPendingOperations() {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('offlineQueue', 'readonly');
      const store = tx.objectStore('offlineQueue');
      const request = store.getAll();
      request.onsuccess = () => {
        const ops = request.result.filter(op => op.status === 'pending' || op.status === 'failed');
        resolve(ops.sort((a, b) => a.timestamp - b.timestamp));
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (e) {
    console.error('[SW] Failed to get pending operations:', e);
    return [];
  }
}

// Update operation status
async function updateOperationStatus(id, status, error = null) {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('offlineQueue', 'readwrite');
      const store = tx.objectStore('offlineQueue');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        if (getRequest.result) {
          const updated = {
            ...getRequest.result,
            status,
            retryCount: status === 'failed' ? (getRequest.result.retryCount || 0) + 1 : getRequest.result.retryCount,
            lastError: error,
          };
          store.put(updated);
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[SW] Failed to update operation status:', e);
  }
}

// Remove operation from queue
async function removeOperation(id) {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('offlineQueue', 'readwrite');
      const store = tx.objectStore('offlineQueue');
      store.delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[SW] Failed to remove operation:', e);
  }
}

// Execute a single operation
async function executeOperation(operation) {
  const { type, table, data, familyId } = operation;

  try {
    let response;

    switch (type) {
      case 'create':
        response = await fetch(`/api/${table}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...data.payload,
            family_id: familyId,
          }),
        });
        break;

      case 'update':
        if (!data.serverId) {
          throw new Error('No server ID for update');
        }
        response = await fetch(`/api/${table}/${data.serverId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data.payload),
        });
        break;

      case 'delete':
        if (!data.serverId) {
          throw new Error('No server ID for delete');
        }
        response = await fetch(`/api/${table}/${data.serverId}`, {
          method: 'DELETE',
        });
        break;

      default:
        throw new Error(`Unknown operation type: ${type}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Process the offline queue
async function processOfflineQueue() {
  console.log('[SW] Processing offline queue...');

  const operations = await getPendingOperations();
  if (operations.length === 0) {
    console.log('[SW] No pending operations');
    return;
  }

  console.log(`[SW] Found ${operations.length} pending operations`);

  let syncedCount = 0;
  let failedCount = 0;

  for (const operation of operations) {
    await updateOperationStatus(operation.id, 'syncing');

    const result = await executeOperation(operation);

    if (result.success) {
      await removeOperation(operation.id);
      syncedCount++;
    } else {
      await updateOperationStatus(operation.id, 'failed', result.error);
      failedCount++;
    }
  }

  console.log(`[SW] Sync complete: ${syncedCount} synced, ${failedCount} failed`);

  // Notify all clients about sync completion
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'SYNC_COMPLETE',
      syncedCount,
      failedCount,
    });
  });
}

// Handle background sync event
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag);

  if (event.tag === 'shopping-sync' || event.tag === 'offline-queue-sync') {
    event.waitUntil(processOfflineQueue());
  }
});

// Handle message to trigger sync manually
self.addEventListener('message', async (event) => {
  if (event.data?.type === 'TRIGGER_SYNC') {
    console.log('[SW] Manual sync triggered');
    await processOfflineQueue();
  }
});
