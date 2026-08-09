"use client";

import { useMemo } from "react";
import { usePhotoSourceSetting } from "./use-photo-source";
import { useImmichAlbums } from "./use-immich";
import { useDlnaContainers } from "./use-dlna";

/**
 * The albums the configured source offers, if it offers any.
 *
 * "Album" means different things per source and the viewer should not have to
 * care: Immich has real albums, DLNA has a folder tree, an iCloud shared album
 * *is* the album, and Unsplash has none at all. What they share is "a named
 * group you can open", which is what this returns.
 *
 * `browsable` is what tells the viewer whether to offer a level above the
 * photos. A source with one album or none goes straight to the grid — an album
 * screen listing exactly one thing is a click for nothing.
 */
export interface PhotoAlbum {
  /** Opaque to the viewer: an Immich album id, or a DLNA object id. */
  id: string;
  title: string;
  /** Photos inside, when the source counts them. */
  count: number | null;
  /** DLNA folders can hold folders. Immich albums cannot. */
  hasChildren: boolean;
}

export function usePhotoAlbums(objectId = "0"): {
  albums: PhotoAlbum[];
  isLoading: boolean;
  /** True when this source has an album level worth showing. */
  browsable: boolean;
} {
  const { data: source, isLoading: sourceLoading } = usePhotoSourceSetting();

  const immich = useImmichAlbums(source === "immich");
  const dlna = useDlnaContainers(objectId, source === "dlna");

  const albums = useMemo<PhotoAlbum[]>(() => {
    if (source === "immich") {
      return (immich.data ?? []).map((album) => ({
        id: album.id,
        title: album.name,
        count: album.assetCount,
        hasChildren: false,
      }));
    }
    if (source === "dlna") {
      return (dlna.data?.containers ?? []).map((container) => ({
        id: container.id,
        title: container.title,
        count: container.childCount,
        // A DLNA container may hold folders, photos, or both — the only way to
        // know is to open it, so the viewer always allows descending.
        hasChildren: true,
      }));
    }
    // iCloud is a single shared album; Unsplash is a curated feed. Neither has
    // a level above the photos.
    return [];
  }, [source, immich.data, dlna.data]);

  const isLoading =
    sourceLoading || (source === "immich" ? immich.isLoading : source === "dlna" ? dlna.isLoading : false);

  return { albums, isLoading, browsable: albums.length > 1 };
}
