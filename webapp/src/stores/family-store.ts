import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Family, Device, Person } from "@/types/database";

// Cookie storage helpers
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

// Cookie-based storage that mimics localStorage API
const cookieStorageApi = {
  getItem: (name: string): string | null => getCookie(name),
  setItem: (name: string, value: string): void => setCookie(name, value),
  removeItem: (name: string): void => deleteCookie(name),
};

interface FamilyState {
  // Current session
  family: Family | null;
  device: Device | null;
  people: Person[];

  // Actions
  setFamily: (family: Family | null) => void;
  setDevice: (device: Device | null) => void;
  setPeople: (people: Person[]) => void;
  clearSession: () => void;
}

export const useFamilyStore = create<FamilyState>()(
  persist(
    (set) => ({
      family: null,
      device: null,
      people: [],

      setFamily: (family) => set({ family }),
      setDevice: (device) => set({ device }),
      setPeople: (people) => set({ people }),
      clearSession: () => set({ family: null, device: null, people: [] }),
    }),
    {
      name: "family-calendar-storage",
      // Use cookie storage instead of localStorage so it's shared between PWAs
      storage: createJSONStorage(() => cookieStorageApi),
      partialize: (state) => ({
        family: state.family,
        device: state.device,
      }),
    }
  )
);
