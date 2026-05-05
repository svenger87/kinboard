import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";

interface ImmichSettings {
  url: string;
  api_key: string;
  selected_album?: string;
}

interface ImmichAlbum {
  id: string;
  name: string;
  assetCount: number;
  thumbnailId: string | null;
  shared: boolean;
}

interface ImmichPhoto {
  id: string;
  url: string;
  originalUrl: string;
  fileName: string;
  date: string;
  isFavorite: boolean;
}

// Hook to get Immich connection status
export function useImmichStatus() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["immich-status", family?.id],
    queryFn: async (): Promise<ImmichSettings | null> => {
      if (!family?.id) {
        return null;
      }

      try {
        const response = await fetch(`/api/settings?family_id=${family.id}&key=immich`);
        if (!response.ok) {
          // 404 means not configured yet - return null, don't throw
          if (response.status === 404) {
            return null;
          }
          throw new Error("Failed to fetch Immich status");
        }
        const data = await response.json();
        return data.value as ImmichSettings | null;
      } catch (error) {
        // Network errors or other issues - return null to show unconfigured state
        console.warn("[Immich] Status fetch error:", error);
        return null;
      }
    },
    enabled: !!family?.id,
    retry: false, // Don't retry on failure
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
}

// Hook to get Immich albums (pass isConnected from parent to avoid duplicate status calls)
export function useImmichAlbums(isConnected?: boolean) {
  const { family } = useFamilyStore();


  return useQuery({
    queryKey: ["immich-albums", family?.id],
    queryFn: async (): Promise<ImmichAlbum[]> => {
      if (!family?.id) {
        return [];
      }

      try {
        const response = await fetch(`/api/immich/albums?family_id=${family.id}`);
        if (!response.ok) {
          if (response.status === 401) {
            return [];
          }
          throw new Error("Failed to fetch albums");
        }
        const data = await response.json();
        return data.albums;
      } catch (error) {
        console.warn("[Immich] Albums fetch error:", error);
        return [];
      }
    },
    enabled: !!family?.id && isConnected !== false,
    retry: false,
  });
}

// Hook to get photos from Immich (pass isConnected from parent to avoid duplicate status calls)
export function useImmichPhotos(albumId?: string, limit = 10, random = false, isConnected?: boolean) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["immich-photos", family?.id, albumId, limit, random],
    queryFn: async (): Promise<ImmichPhoto[]> => {
      if (!family?.id) return [];

      try {
        const params = new URLSearchParams({
          family_id: family.id,
          limit: limit.toString(),
          random: random.toString(),
        });
        if (albumId) params.append("album_id", albumId);

        const response = await fetch(`/api/immich/photos?${params}`);
        if (!response.ok) {
          if (response.status === 401) return [];
          throw new Error("Failed to fetch photos");
        }
        const data = await response.json();
        return data.photos;
      } catch (error) {
        console.warn("Immich photos fetch error:", error);
        return [];
      }
    },
    enabled: !!family?.id && isConnected !== false,
    retry: false,
    refetchInterval: random && isConnected ? 5 * 60 * 1000 : false,
  });
}

// Hook to get photos from current month's Wallpaper album
export function useImmichMonthlyPhotos() {
  const { family } = useFamilyStore();
  const { data: status } = useImmichStatus();

  const isConnected = !!status?.url && !!status?.api_key;

  const { data: albums } = useImmichAlbums(isConnected);

  // Get current month name in German
  const currentMonth = new Date();
  const monthNameDE = currentMonth.toLocaleDateString("de-DE", { month: "long" });

  // Find the Wallpaper album for current month (e.g., "Wallpaper Januar")
  const monthlyAlbum = albums?.find((album) =>
    album.name.toLowerCase().includes("wallpaper") &&
    album.name.toLowerCase().includes(monthNameDE.toLowerCase())
  );

  const albumId = monthlyAlbum?.id;


  return useQuery({
    queryKey: ["immich-monthly-photos", family?.id, albumId],
    queryFn: async (): Promise<ImmichPhoto[]> => {
      if (!family?.id || !albumId) {
        return [];
      }

      try {
        const params = new URLSearchParams({
          family_id: family.id,
          album_id: albumId,
          random: "true",
          // No limit - full album rotation, memory managed by screensaver component
        });

        const response = await fetch(`/api/immich/photos?${params}`);
        if (!response.ok) {
          if (response.status === 401) return [];
          throw new Error("Failed to fetch photos");
        }
        const data = await response.json();
        return data.photos;
      } catch (error) {
        console.warn("[Immich] Monthly photos fetch error:", error);
        return [];
      }
    },
    enabled: !!family?.id && !!albumId && isConnected,
    retry: false,
    refetchInterval: isConnected ? 10 * 60 * 1000 : false,
  });
}

// Hook to save Immich settings
export function useSaveImmichSettings() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (settings: ImmichSettings) => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: "immich",
          value: settings,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save Immich settings");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["immich-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["immich-albums", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["immich-photos", family?.id] });
    },
  });
}

// Hook to test Immich connection
export function useTestImmichConnection() {
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (settings: { url: string; api_key: string }) => {
      // Try to fetch server info to test connection
      const response = await fetch(`${settings.url}/api/server/ping`, {
        headers: {
          "x-api-key": settings.api_key,
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Connection failed");
      }

      return { success: true };
    },
  });
}

// Hook to disconnect Immich
export function useDisconnectImmich() {
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
          key: "immich",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["immich-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["immich-albums", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["immich-photos", family?.id] });
    },
  });
}
