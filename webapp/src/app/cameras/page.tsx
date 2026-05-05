"use client";

import { motion } from "framer-motion";
import { Video, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { CameraGrid } from "@/components/camera-viewer";
import { useCameras, useKeyboardShortcuts, useSwipeNavigation } from "@/hooks";

function CamerasSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-video rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export default function CamerasPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const { cameras, isLoading, error, refetch } = useCameras();
  const router = useRouter();
  const t = useTranslations("cameras");
  const tCommon = useTranslations("common");

  if (isLoading) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-7xl mx-auto">
          <CamerasSkeleton />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-7xl mx-auto">
          <ErrorState
            icon={Video}
            title={t("errorTitle")}
            message={t("errorMessage")}
            onRetry={() => refetch()}
          />
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="page-gradient" />
      <div className="relative z-10 max-w-7xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Video}
          title={t("title")}
          subtitle={
            cameras.length > 0
              ? t("subtitleActive", { count: cameras.length })
              : t("subtitleEmpty")
          }
          actions={
            <Link href="/settings/cameras">
              <Button variant="outline" size="sm">
                <Settings className="size-4 mr-2" />
                {tCommon("settings")}
              </Button>
            </Link>
          }
        />

        {/* Camera Grid or Empty State */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {cameras.length === 0 ? (
            <EmptyState
              icon={Video}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
              action={{
                label: t("emptyAction"),
                onClick: () => router.push("/settings/cameras"),
                variant: "month",
              }}
            />
          ) : (
            <CameraGrid
              cameras={cameras}
              columns={cameras.length === 1 ? 1 : cameras.length <= 4 ? 2 : 3}
            />
          )}
        </motion.div>
      </div>
    </main>
  );
}
