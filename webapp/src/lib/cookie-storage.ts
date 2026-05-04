// Cookie-based storage for Zustand persist middleware
// This allows sharing state between PWAs with different scopes on the same domain

import type { PersistStorage, StorageValue } from "zustand/middleware";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, days: number = 365): void {
  if (typeof document === "undefined") return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
}

// Generic cookie storage that works with Zustand persist
export function createCookieStorage<T>(): PersistStorage<T> {
  return {
    getItem: (name: string): StorageValue<T> | null => {
      const value = getCookie(name);
      if (!value) return null;
      try {
        return JSON.parse(value) as StorageValue<T>;
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: StorageValue<T>): void => {
      setCookie(name, JSON.stringify(value));
    },
    removeItem: (name: string): void => {
      deleteCookie(name);
    },
  };
}
