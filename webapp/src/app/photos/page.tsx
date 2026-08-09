"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Images, X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePhotoLibrary } from "@/hooks/use-photo-library";
import { useKeyboardShortcuts, useSwipeNavigation } from "@/hooks";

/**
 * The album viewer.
 *
 * Until now photos only ever appeared on the idle screen — one at a time, on
 * the screensaver's schedule, with no way back to the one you just missed.
 * This is the deliberate version: a grid, and a full-screen view you can walk
 * through.
 *
 * It follows whatever `photo_source` is set to, so it works with Immich, a
 * DLNA server on the NAS or an iCloud shared album without asking again.
 */
export default function PhotosPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("photosViewer");
  const locale = useLocale();
  const { photos, isLoading, isEmpty } = usePhotoLibrary(200);

  // Index of the photo open full-screen, or null for the grid.
  const [openAt, setOpenAt] = useState<number | null>(null);

  const step = useCallback(
    (delta: number) => {
      setOpenAt((current) => {
        if (current === null || photos.length === 0) return current;
        // Wraps: on a wall display there is no scrollbar to tell you that you
        // have reached the end, and stopping dead reads as a broken button.
        return (current + delta + photos.length) % photos.length;
      });
    },
    [photos.length],
  );

  // Arrow keys and Escape, because a full-screen viewer without them is a
  // photo you cannot leave.
  useEffect(() => {
    if (openAt === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openAt, step]);

  const formatDate = (value: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString(locale, { dateStyle: "medium" });
  };

  const open = openAt !== null ? photos[openAt] : null;

  return (
    <main
      id="main-content"
      className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          icon={Images}
          title={t("title")}
          subtitle={t("subtitle", { count: photos.length })}
        />

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            {t("loading")}
          </div>
        )}

        {isEmpty && (
          <Card className="flex flex-col items-center gap-4 p-10 text-center">
            <Images className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">{t("emptyTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("emptyBody")}</p>
            </div>
            <Link href="/settings/photos">
              <Button className="min-h-[44px]">{t("emptyAction")}</Button>
            </Link>
          </Card>
        )}

        {!isLoading && photos.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {photos.map((photo, index) => (
              <motion.button
                key={photo.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(index, 20) * 0.02 }}
                onClick={() => setOpenAt(index)}
                className="group relative aspect-square overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={photo.title ?? t("photoAria", { index: index + 1 })}
              >
                <img
                  src={photo.thumbnailUrl}
                  alt={photo.title ?? ""}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {photo.title && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left text-xs text-white">
                    {photo.title}
                  </span>
                )}
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* Full-screen view */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col bg-black/95"
            role="dialog"
            aria-modal="true"
            aria-label={open.title ?? t("title")}
          >
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 text-white">
                {open.title && <p className="truncate font-medium">{open.title}</p>}
                {formatDate(open.date) && (
                  <p className="text-sm text-white/60">{formatDate(open.date)}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpenAt(null)}
                aria-label={t("close")}
                className="min-h-[44px] min-w-[44px] text-white hover:bg-white/10"
              >
                <X className="size-6" />
              </Button>
            </div>

            <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => step(-1)}
                aria-label={t("previous")}
                className="absolute left-2 min-h-[44px] min-w-[44px] text-white hover:bg-white/10"
              >
                <ChevronLeft className="size-8" />
              </Button>

              <motion.img
                key={open.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                src={open.url}
                alt={open.title ?? ""}
                className="max-h-full max-w-full rounded-lg object-contain"
              />

              <Button
                variant="ghost"
                size="icon"
                onClick={() => step(1)}
                aria-label={t("next")}
                className="absolute right-2 min-h-[44px] min-w-[44px] text-white hover:bg-white/10"
              >
                <ChevronRight className="size-8" />
              </Button>
            </div>

            <p className="pb-6 text-center text-sm text-white/50">
              {t("position", { current: (openAt ?? 0) + 1, total: photos.length })}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
