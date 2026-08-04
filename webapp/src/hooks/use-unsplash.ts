"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

export interface UnsplashSettings {
  access_key: string;
  monthly_terms?: Record<string, string[]>;
}

export interface UnsplashPhoto {
  id: string;
  url: string;
  photographer: string;
  photographerUrl: string;
  downloadLocation: string | null;
  location: string | null;
  description: string | null;
}

// Hook to get Unsplash connection status
export function useUnsplashStatus() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["unsplash-status", family?.id],
    queryFn: async (): Promise<UnsplashSettings | null> => {
      if (!family?.id) {
        return null;
      }

      try {
        const response = await fetch(`/api/settings?family_id=${family.id}&key=${SETTINGS_KEYS.unsplash}`);
        if (!response.ok) {
          // 404 means not configured yet - return null, don't throw
          if (response.status === 404) {
            return null;
          }
          throw new Error("Failed to fetch Unsplash status");
        }
        const data = await response.json();
        return data.value as UnsplashSettings | null;
      } catch (error) {
        // Network errors or other issues - return null to show unconfigured state
        console.warn("[Unsplash] Status fetch error:", error);
        return null;
      }
    },
    enabled: !!family?.id,
    retry: false, // Don't retry on failure
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
}

// Hook to get monthly photos from Unsplash
export function useUnsplashMonthlyPhotos() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["unsplash-monthly-photos", family?.id],
    queryFn: async (): Promise<UnsplashPhoto[]> => {
      if (!family?.id) {
        return [];
      }

      try {
        const response = await fetch(`/api/unsplash/photos?family_id=${family.id}`);
        if (!response.ok) {
          if (response.status === 401) {
            return [];
          }
          throw new Error("Failed to fetch Unsplash photos");
        }
        return await response.json() as UnsplashPhoto[];
      } catch (error) {
        console.warn("[Unsplash] Monthly photos fetch error:", error);
        return [];
      }
    },
    enabled: !!family?.id,
    retry: false,
    staleTime: 60 * 60 * 1000, // 1 hour
    refetchInterval: 60 * 60 * 1000, // 1 hour
  });
}

// Hook to save Unsplash settings
export function useSaveUnsplashSettings() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (settings: UnsplashSettings) => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: SETTINGS_KEYS.unsplash,
          value: settings,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save Unsplash settings");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unsplash-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["unsplash-monthly-photos", family?.id] });
    },
  });
}

// Hook to test Unsplash connection
export function useTestUnsplashConnection() {
  return useMutation({
    mutationFn: async (accessKey: string): Promise<boolean> => {
      const response = await fetch("https://api.unsplash.com/photos/random?count=1", {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
        },
      });

      if (!response.ok) {
        throw new Error("Connection failed");
      }

      return true;
    },
  });
}

// Hook to disconnect Unsplash
export function useDisconnectUnsplash() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async () => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch(`/api/settings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: SETTINGS_KEYS.unsplash,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unsplash-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["unsplash-monthly-photos", family?.id] });
    },
  });
}
