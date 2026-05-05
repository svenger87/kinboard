"use client";

import { motion, AnimatePresence } from "framer-motion";
import { WifiOff, Loader2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOfflineQueueStatus } from "@/hooks/use-offline-queue";
import { Button } from "@/components/ui/button";

interface OfflineBannerProps {
  onSyncClick?: () => void;
  isSyncing?: boolean;
  className?: string;
}

/**
 * Banner that shows offline status and pending sync operations
 * Shows at the top of the page when:
 * - User is offline
 * - There are pending operations syncing
 * - There are failed operations
 */
export function OfflineBanner({
  onSyncClick,
  isSyncing = false,
  className = "",
}: OfflineBannerProps) {
  const t = useTranslations("components.offline");
  const { isOnline, pendingCount, failedCount, hasPending } = useOfflineQueueStatus();

  // Determine what to show
  const showBanner = !isOnline || isSyncing || hasPending;

  if (!showBanner) return null;

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={`overflow-hidden ${className}`}
        >
          {/* Offline banner */}
          {!isOnline && (
            <div className="bg-warning/90 text-warning-foreground px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium">
              <WifiOff className="size-4" />
              <span>{t("offlineMessage")}</span>
            </div>
          )}

          {/* Syncing banner */}
          {isOnline && isSyncing && (
            <div className="bg-info/90 text-info-foreground px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" />
              <span>{t("syncing", { count: pendingCount })}</span>
            </div>
          )}

          {/* Pending operations banner (online, not syncing) */}
          {isOnline && !isSyncing && pendingCount > 0 && failedCount === 0 && (
            <div className="bg-info/90 text-info-foreground px-4 py-2 flex items-center justify-between text-sm font-medium">
              <div className="flex items-center gap-2">
                <RefreshCw className="size-4" />
                <span>{t("pending", { count: pendingCount })}</span>
              </div>
              {onSyncClick && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSyncClick}
                  className="text-white hover:bg-white/20 h-7 px-2"
                >
                  {t("syncNow")}
                </Button>
              )}
            </div>
          )}

          {/* Failed operations banner */}
          {isOnline && failedCount > 0 && (
            <div className="bg-destructive/90 text-destructive-foreground px-4 py-2 flex items-center justify-between text-sm font-medium">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4" />
                <span>{t("failed", { count: failedCount })}</span>
              </div>
              {onSyncClick && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSyncClick}
                  className="text-destructive-foreground hover:bg-white/20 h-7 px-2"
                >
                  {t("retry")}
                </Button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Compact offline indicator for use in headers/footers
 */
export function OfflineIndicator({ className = "" }: { className?: string }) {
  const t = useTranslations("components.offline");
  const { isOnline, pendingCount, failedCount } = useOfflineQueueStatus();

  if (isOnline && pendingCount === 0 && failedCount === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {!isOnline && (
        <div className="flex items-center gap-1 text-warning">
          <WifiOff className="size-4" />
          <span className="text-xs">{t("indicatorOffline")}</span>
        </div>
      )}
      {isOnline && pendingCount > 0 && (
        <div className="flex items-center gap-1 text-info">
          <Loader2 className="size-3 animate-spin" />
          <span className="text-xs">{pendingCount}</span>
        </div>
      )}
      {failedCount > 0 && (
        <div className="flex items-center gap-1 text-destructive">
          <AlertCircle className="size-3" />
          <span className="text-xs">{failedCount}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Sync status icon for individual items
 */
export function SyncStatusIcon({
  status,
  className = "",
}: {
  status: "synced" | "pending" | "error";
  className?: string;
}) {
  switch (status) {
    case "synced":
      return <CheckCircle2 className={`size-3 text-success ${className}`} />;
    case "pending":
      return <Loader2 className={`size-3 text-info animate-spin ${className}`} />;
    case "error":
      return <AlertCircle className={`size-3 text-destructive ${className}`} />;
  }
}
