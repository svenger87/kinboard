"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { useImmichMonthlyPhotos } from "./use-immich";
import { useUnsplashMonthlyPhotos } from "./use-unsplash";
import { useDlnaPhotos } from "./use-dlna";

/** Which library the screensaver draws from. */
export type PhotoSourceId = "immich" | "unsplash" | "dlna";

export interface ScreensaverPhoto {
  id: string;
  url: string;
  metadata?: {
    photographer?: string;
    photographerUrl?: string;
    location?: string | null;
    description?: string | null;
    /** Unsplash only — the URL to ping when the photo is displayed. */
    downloadLocation?: string | null;
  };
}

export function usePhotoSourceSetting() {
  const family = useFamilyStore((s) => s.family);

  return useQuery<PhotoSourceId>({
    queryKey: ["photo-source", family?.id],
    queryFn: async () => {
      const res = await fetch(`/api/settings?family_id=${family!.id}&key=${SETTINGS_KEYS.photoSource}`);
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
  source: PhotoSourceId | undefined;
} {
  const { data: source, isLoading: isSourceLoading } = usePhotoSourceSetting();
  const { data: immichPhotos = [], isLoading: isImmichLoading } = useImmichMonthlyPhotos();
  const { data: unsplashPhotos = [], isLoading: isUnsplashLoading } = useUnsplashMonthlyPhotos();
  // Shuffled server-side and capped: a slideshow wants variety, not the first
  // 60 files in whatever order the NAS lists them.
  const { data: dlnaPhotos = [], isLoading: isDlnaLoading } = useDlnaPhotos(
    60,
    true,
    source === "dlna",
  );

  const photos = useMemo<ScreensaverPhoto[]>(() => {
    if (source === "dlna") {
      return dlnaPhotos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        metadata: { description: photo.title },
      }));
    }

    if (source === "unsplash") {
      return unsplashPhotos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        metadata: {
          photographer: photo.photographer,
          photographerUrl: photo.photographerUrl,
          location: photo.location,
          description: photo.description,
          downloadLocation: photo.downloadLocation,
        },
      }));
    }

    // Default: immich
    return immichPhotos.map((photo) => ({
      id: photo.id,
      url: photo.url,
    }));
  }, [source, immichPhotos, unsplashPhotos, dlnaPhotos]);

  const isLoading =
    isSourceLoading ||
    (source === "dlna"
      ? isDlnaLoading
      : source === "unsplash"
        ? isUnsplashLoading
        : isImmichLoading);

  return { photos, isLoading, source };
}
