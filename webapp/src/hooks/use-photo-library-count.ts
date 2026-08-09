"use client";

import { usePhotoLibrary } from "./use-photo-library";

/**
 * How many photos the configured source has, for the plugin's nav gating.
 *
 * Deliberately asks for a small page: the nav only needs to know whether the
 * number is zero, and the viewer will fetch the rest when someone opens it.
 */
export function usePhotoLibraryCount(): { count: number | undefined; loading: boolean } {
  const { photos, isLoading } = usePhotoLibrary(1);
  return { count: isLoading ? undefined : photos.length, loading: isLoading };
}
