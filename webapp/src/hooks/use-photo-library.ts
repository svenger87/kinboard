"use client";

import { useMemo } from "react";
import { usePhotoSourceSetting, type PhotoSourceId } from "./use-photo-source";
import { useImmichPhotos, useImmichStatus, isImmichConnected } from "./use-immich";
import { useDlnaPhotos } from "./use-dlna";
import { useIcloudPhotos } from "./use-icloud";

/**
 * The configured photo library, for browsing rather than for a slideshow.
 *
 * `usePhotoSource` next door serves the screensaver: a shuffled handful,
 * refreshed slowly, metadata shaped for a caption overlay. A viewer wants the
 * opposite — everything the source has, in order, with whatever title the
 * source knows. Sharing one hook between the two would have meant one of them
 * settling for the other's answer.
 *
 * What both share is the `photo_source` setting, so the viewer follows the
 * same choice the screensaver does without a second thing to configure.
 */
export interface LibraryPhoto {
  id: string;
  /** Full-size, already proxied where the source needs it. */
  url: string;
  /** Smaller rendition when the source offers one; falls back to `url`. */
  thumbnailUrl: string;
  title: string | null;
  date: string | null;
}

/**
 * Unsplash is a screensaver source and not a library.
 *
 * It has no album to walk and no notion of "your photos" — it hands out a
 * curated set that rotates monthly. Browsing it would mean asking Unsplash for
 * a page of images every time somebody opens the viewer, against a demo-tier
 * rate limit shared by the whole instance, to show a stranger's photographs in
 * a screen headed "your photos". So the viewer declines, and says why.
 */
export function isBrowsableSource(source: PhotoSourceId | undefined): boolean {
  return source !== "unsplash";
}

export function usePhotoLibrary(limit = 200, albumId?: string): {
  photos: LibraryPhoto[];
  isLoading: boolean;
  source: PhotoSourceId | undefined;
  /** True when the source is configured but has nothing to show. */
  isEmpty: boolean;
  /** The chosen source feeds the idle screen and cannot be browsed. */
  screensaverOnly: boolean;
} {
  const { data: source, isLoading: sourceLoading } = usePhotoSourceSetting();

  // Each source hook is gated on being the selected one, so browsing the
  // viewer does not wake up an Immich server that nobody asked about.
  // Selected *and* set up. A family whose source is Immich but who has not
  // connected it — the state every fresh install is in, since Immich is the
  // default — would otherwise have every page ask a server that is not there
  // and be told 401 for it. What "set up" means is `isImmichConnected`, which
  // is not the same as "the browser can see an API key": it never can.
  const { data: immichSettings } = useImmichStatus();
  const immichConnected = isImmichConnected(immichSettings);

  const immich = useImmichPhotos(albumId, limit, false, source === "immich" && immichConnected);
  const dlna = useDlnaPhotos(limit, false, source === "dlna", albumId);
  const icloud = useIcloudPhotos(limit, source === "icloud");

  const photos = useMemo<LibraryPhoto[]>(() => {
    switch (source) {
      case "dlna":
        return (dlna.data ?? []).map((p) => ({
          id: p.id,
          url: p.url,
          thumbnailUrl: p.thumbnailUrl ?? p.url,
          title: p.title,
          date: p.date,
        }));
      case "icloud":
        return (icloud.data ?? []).map((p) => ({
          id: p.id,
          url: p.url,
          // Apple signs one URL per rendition and we asked for the largest;
          // there is no cheaper thumbnail to point at.
          thumbnailUrl: p.url,
          title: p.caption,
          date: p.dateCreated,
        }));
      case "unsplash":
        // Nothing, on purpose — see `screensaverOnly` below.
        return [];
      default:
        return (immich.data ?? []).map((p) => ({
          id: p.id,
          url: p.url,
          thumbnailUrl: p.url,
          title: null,
          date: null,
        }));
    }
  }, [source, immich.data, dlna.data, icloud.data]);

  const isLoading =
    sourceLoading ||
    (source === "dlna"
      ? dlna.isLoading
      : source === "icloud"
        ? icloud.isLoading
        : source === "unsplash"
          ? false
          : immich.isLoading);

  return {
    photos,
    isLoading,
    source,
    isEmpty: !isLoading && photos.length === 0,
    screensaverOnly: !isBrowsableSource(source),
  };
}
