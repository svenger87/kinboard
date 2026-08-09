"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Images } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { usePhotoLibrary } from "@/hooks/use-photo-library";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { PluginDiscoverCard } from "./plugin-discover-card";

/**
 * One photo from the family's library, changing every so often.
 *
 * The screensaver already does this — but only once the board has been left
 * alone, which on a kitchen wall is exactly when nobody is looking at it. This
 * is the same library while the dashboard is in use, and tapping it opens the
 * viewer at the grid.
 *
 * Deliberately a single photo rather than a strip of thumbnails: at the size a
 * widget gets on a 4-column grid, four photos are four unrecognisable squares,
 * and the point of a photo on the wall is that you can tell who is in it.
 */
const ROTATE_INTERVAL_MS = 20_000;

export function PhotosWidget() {
  const t = useTranslations("dashboard.pluginDiscover");
  const tp = useTranslations("photosViewer");
  const enabled = useIsPluginEnabled("photos");
  // A handful is plenty to rotate through, and asking for the whole library to
  // show one picture would make every dashboard load pay for the viewer.
  const { photos, isLoading } = usePhotoLibrary(12);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (photos.length <= 1) return;
    const id = setInterval(() => {
      setActiveIdx((i) => (i + 1) % photos.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [photos.length]);

  if (!enabled) {
    return (
      <PluginDiscoverCard
        pluginId="photos"
        icon={Images}
        title={t("photosName")}
        description={t("photosDisabled")}
        ctaLabel={t("enableCta")}
        ctaHref="/settings/plugins"
      />
    );
  }

  // Nothing to show yet — which for photos almost always means no source is
  // connected, so point at the place that fixes it rather than at the viewer.
  if (!isLoading && photos.length === 0) {
    return (
      <PluginDiscoverCard
        pluginId="photos"
        icon={Images}
        title={t("photosName")}
        description={t("photosEmpty")}
        ctaLabel={t("addCta")}
        ctaHref="/settings/photos"
      />
    );
  }

  if (isLoading) {
    return (
      <Card className="aspect-[4/3] animate-pulse overflow-hidden" aria-hidden>
        <div className="size-full bg-muted" />
      </Card>
    );
  }

  const safeIdx = activeIdx >= photos.length ? 0 : photos.length ? activeIdx : 0;
  const photo = photos[safeIdx];
  if (!photo) return null;

  return (
    <Link href="/photos" className="block h-full" aria-label={tp("title")}>
      <Card className="relative aspect-[4/3] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.img
            key={photo.id}
            src={photo.thumbnailUrl || photo.url}
            alt={photo.title ?? tp("photoAria")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 size-full object-cover"
            // A photo that 404s — an expired iCloud link, a NAS that went to
            // sleep — must not leave a broken-image glyph on the wall.
            onError={() => setActiveIdx((i) => (photos.length > 1 ? (i + 1) % photos.length : i))}
          />
        </AnimatePresence>

        {photo.title && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3">
            <p className="truncate text-sm font-medium text-white">{photo.title}</p>
          </div>
        )}
      </Card>
    </Link>
  );
}
