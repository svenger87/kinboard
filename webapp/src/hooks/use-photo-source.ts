"use client";

import { useMemo } from "react";
import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { useImmichMonthlyPhotos } from "./use-immich";
import { useUnsplashMonthlyPhotos } from "./use-unsplash";
import { useDlnaPhotos } from "./use-dlna";
import { useIcloudPhotos } from "./use-icloud";

/** Which library the screensaver draws from. */
export type PhotoSourceId = "immich" | "unsplash" | "dlna" | "icloud";

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

/**
 * Which source the screensaver, the viewer and the Photos nav entry read.
 *
 * Deliberately through `useSetting`, so this shares the one cache entry every
 * other setting uses — `["settings", familyId, "photo_source"]`, which is
 * exactly what `useUpdateSetting` invalidates after a write.
 *
 * It used to keep its own `["photo-source"]` entry with a 30-second stale
 * time, and nothing invalidated it. Changing the source in Settings therefore
 * moved the radio button and wrote the row, while the screensaver and the
 * viewer carried on showing the source they had read at mount: the setting was
 * honoured once and then ignored. A second cache entry for a row that already
 * has one can only ever drift from it.
 */
export function usePhotoSourceSetting(): { data: PhotoSourceId; isLoading: boolean } {
  const { data, isLoading } = useSetting<{ source?: PhotoSourceId } | null>(
    SETTINGS_KEYS.photoSource,
    null,
  );

  // Immich is the default for a family that has never chosen, which is what
  // the screensaver assumed before any of these sources existed.
  return { data: data?.source ?? "immich", isLoading };
}

export function usePhotoSource(): {
  photos: ScreensaverPhoto[];
  isLoading: boolean;
  source: PhotoSourceId | undefined;
} {
  const { data: source, isLoading: isSourceLoading } = usePhotoSourceSetting();
  const { data: immichPhotos = [], isLoading: isImmichLoading } = useImmichMonthlyPhotos();
  // Gated like the two below it: nothing here falls back to Unsplash, so a
  // board set to Immich or a NAS was asking Unsplash for photos it would never
  // show — and on an instance with no Unsplash key, being told 401 for it.
  const { data: unsplashPhotos = [], isLoading: isUnsplashLoading } =
    useUnsplashMonthlyPhotos(source === "unsplash");
  // Shuffled server-side and capped: a slideshow wants variety, not the first
  // 60 files in whatever order the NAS lists them.
  const { data: dlnaPhotos = [], isLoading: isDlnaLoading } = useDlnaPhotos(
    60,
    true,
    source === "dlna",
  );
  const { data: icloudPhotos = [], isLoading: isIcloudLoading } = useIcloudPhotos(
    100,
    source === "icloud",
  );

  const photos = useMemo<ScreensaverPhoto[]>(() => {
    if (source === "icloud") {
      return icloudPhotos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        metadata: { description: photo.caption },
      }));
    }

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
  }, [source, immichPhotos, unsplashPhotos, dlnaPhotos, icloudPhotos]);

  const isLoading =
    isSourceLoading ||
    (source === "icloud"
      ? isIcloudLoading
      : source === "dlna"
        ? isDlnaLoading
        : source === "unsplash"
          ? isUnsplashLoading
          : isImmichLoading);

  return { photos, isLoading, source };
}
