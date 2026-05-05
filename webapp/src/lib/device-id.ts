// Persistent Device ID Management
// Stores device ID in multiple locations for resilience against storage clearing

const DEVICE_ID_KEY = "family-calendar-device-id";

// Generate a unique device ID
function generateDeviceId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Cookie helpers
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, days: number = 365 * 10): void {
  if (typeof document === "undefined") return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

// IndexedDB helpers (most persistent storage)
function openDeviceDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("FamilyCalendarDevice", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config");
      }
    };
  });
}

async function getFromIndexedDB(): Promise<string | null> {
  try {
    const db = await openDeviceDB();
    return new Promise((resolve) => {
      const tx = db.transaction("config", "readonly");
      const store = tx.objectStore("config");
      const request = store.get(DEVICE_ID_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setInIndexedDB(deviceId: string): Promise<void> {
  try {
    const db = await openDeviceDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("config", "readwrite");
      const store = tx.objectStore("config");
      const request = store.put(deviceId, DEVICE_ID_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore errors
  }
}

// Get device ID from any available storage
export async function getDeviceId(): Promise<string> {
  // Check all storage locations
  const fromCookie = getCookie(DEVICE_ID_KEY);
  const fromLocalStorage = typeof localStorage !== "undefined"
    ? localStorage.getItem(DEVICE_ID_KEY)
    : null;
  const fromIndexedDB = await getFromIndexedDB();

  // Use the first available ID (IndexedDB is most persistent)
  const existingId = fromIndexedDB || fromCookie || fromLocalStorage;

  if (existingId) {
    // Sync to all storage locations
    await persistDeviceId(existingId);
    return existingId;
  }

  // Generate new ID and persist everywhere
  const newId = generateDeviceId();
  await persistDeviceId(newId);
  return newId;
}

// Store device ID in all available storage locations
export async function persistDeviceId(deviceId: string): Promise<void> {
  // Cookie (10 years)
  setCookie(DEVICE_ID_KEY, deviceId);

  // localStorage
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  // IndexedDB (most persistent)
  await setInIndexedDB(deviceId);

  // Also tell service worker to store it
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: "STORE_DEVICE_ID",
      deviceId,
    });
  }
}

// Generate a device fingerprint for matching (fallback identification)
export function getDeviceFingerprint(): string {
  if (typeof window === "undefined") return "";

  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    // @ts-expect-error - deviceMemory is not in all browsers
    navigator.deviceMemory || 0,
  ];

  // Simple hash
  const str = components.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
