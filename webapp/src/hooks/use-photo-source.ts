"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { useImmichMonthlyPhotos } from "./use-immich";
import { useUnsplashMonthlyPhotos } from "./use-unsplash";

export interface ScreensaverPhoto {
  id: string;
  url: string;
  metadata?: {
    photographer?: string;
    photographerUrl?: string;
    location?: string | null;
    description?: string | null;
  };
}

export function usePhotoSourceSetting() {
  const family = useFamilyStore((s) => s.family);

  return useQuery<"immich" | "unsplash">({
    queryKey: ["photo-source", family?.id],
    queryFn: async () => {
      const res = await fetch(`/api/settings?family_id=${family!.id}&key=photo_source`);
      if (res.status === 404) return "immich";
      if (!res.ok) throw new Error("Failed to fetch photo source setting");
      const data = await res.json();
      return data.value?.source || "immich";
    },
    enabled: !!family?.id,
    staleTime: 30000,
  });
}

export function usePhotoSource(): {
  photos: ScreensaverPhoto[];
  isLoading: boolean;
  source: "immich" | "unsplash" | undefined;
} {
  const { data: source, isLoading: isSourceLoading } = usePhotoSourceSetting();
  const { data: immichPhotos = [], isLoading: isImmichLoading } = useImmichMonthlyPhotos();
  const { data: unsplashPhotos = [], isLoading: isUnsplashLoading } = useUnsplashMonthlyPhotos();

  const photos = useMemo<ScreensaverPhoto[]>(() => {
    if (source === "unsplash") {
      return unsplashPhotos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        metadata: {
          photographer: photo.photographer,
          photographerUrl: photo.photographerUrl,
          location: photo.location,
          description: photo.description,
        },
      }));
    }

    // Default: immich
    return immichPhotos.map((photo) => ({
      id: photo.id,
      url: photo.url,
    }));
  }, [source, immichPhotos, unsplashPhotos]);

  const isLoading =
    isSourceLoading ||
    (source === "immich" ? isImmichLoading : isUnsplashLoading);

  return { photos, isLoading, source };
}
