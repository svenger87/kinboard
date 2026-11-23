"use client";

import { useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Images } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRotatingPhoto } from "@/components/widgets/photos-widget";
import type { HomeWidgetProps } from "./shared";
import { SetUpBox, useEm } from "./rest-shared";

/**
 * A photo from the family's library in a box (RFC-022 §3.1, fixed): the
 * photo fills the box (cover), whatever its shape and the box's, and changes
 * every twenty seconds as on the card (useRotatingPhoto). Its title runs
 * along the bottom while the box is tall enough for it. The whole box opens
 * the photo viewer.
 */
export function PhotosHomeWidget({ box }: HomeWidgetProps) {
  const t = useTranslations("dashboard.pluginDiscover");
  const tp = useTranslations("photosViewer");
  const { enabled, photos, isLoading, screensaverOnly, safeIdx, photo, skip } = useRotatingPhoto();
  const ref = useRef<HTMLAnchorElement>(null);
  const em = useEm(ref);

  if (!enabled) {
    return <SetUpBox box={box} icon={Images} title={t("photosName")} description={t("photosDisabled")} href="/settings/plugins" testId="home-photos" />;
  }
  if (screensaverOnly) {
    return <SetUpBox box={box} icon={Images} title={tp("screensaverOnlyTitle")} description={tp("screensaverOnlyBody")} href="/settings/photos" testId="home-photos" />;
  }
  if (!isLoading && photos.length === 0) {
    return <SetUpBox box={box} icon={Images} title={t("photosName")} description={t("photosEmpty")} href="/settings/photos" testId="home-photos" />;
  }

  // The title only where it leaves most of the photo free: a box at least four lines tall.
  const showTitle = Boolean(photo?.title) && box.height >= 4 * em;
  return (
    <Link
      ref={ref}
      href="/photos"
      aria-label={tp("title")}
      className={`relative block size-full overflow-hidden rounded-2xl border border-border bg-muted elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isLoading ? "animate-pulse" : ""}`}
      data-testid="home-photos"
      data-fills-box
    >
      <AnimatePresence mode="wait">
        {photo && (
          <motion.img
            key={photo.id}
            src={photo.thumbnailUrl || photo.url}
            alt={photo.title ?? tp("photoAria", { index: safeIdx + 1 })}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 size-full object-cover"
            data-testid="home-photo"
            // A photo that fails to load (an expired link, a NAS asleep) is skipped, not shown broken.
            onError={skip}
          />
        )}
      </AnimatePresence>
      {showTitle && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-[0.6em] pb-[0.4em] pt-[1em]">
          <p className="truncate text-[0.75em] font-medium text-white">{photo?.title}</p>
        </div>
      )}
    </Link>
  );
}
