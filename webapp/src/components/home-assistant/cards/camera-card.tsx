"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Video, VideoOff, Maximize2, RefreshCw, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFamilyStore } from "@/stores/family-store";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

interface CameraCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function CameraCard({ card, entity }: CameraCardProps) {
  const t = useTranslations("homeAutomation.cards.camera");
  const { family } = useFamilyStore();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";

  // Build camera proxy URL
  const getCameraUrl = useCallback((stream = false) => {
    if (!family?.id) return null;
    const timestamp = Date.now(); // Cache buster
    return `/api/homeassistant/camera?family_id=${family.id}&entity_id=${entity.entity_id}&type=${stream ? "stream" : "snapshot"}&t=${timestamp}`;
  }, [family?.id, entity.entity_id]);

  // Load snapshot
  const loadSnapshot = useCallback(() => {
    const url = getCameraUrl(false);
    if (url) {
      setIsLoading(true);
      setError(false);
      setImageUrl(url);
    }
  }, [getCameraUrl]);

  // Initial load and refresh interval for thumbnail
  useEffect(() => {
    if (isUnavailable) return;

    loadSnapshot();

    // Refresh thumbnail every 10 seconds when not streaming
    if (!isStreaming && !fullscreenOpen) {
      refreshIntervalRef.current = setInterval(loadSnapshot, 10000);
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [loadSnapshot, isUnavailable, isStreaming, fullscreenOpen]);

  const handleImageLoad = () => {
    setIsLoading(false);
    setError(false);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setError(true);
  };

  const handleOpenFullscreen = () => {
    setFullscreenOpen(true);
    // Stop thumbnail refresh while fullscreen is open
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  };

  const handleCloseFullscreen = (open: boolean) => {
    setFullscreenOpen(open);
    if (!open) {
      setIsStreaming(false);
      // Resume thumbnail refresh
      loadSnapshot();
    }
  };

  const toggleStream = () => {
    setIsStreaming(!isStreaming);
  };

  return (
    <>
      <div
        className={`rounded-xl border bg-card overflow-hidden transition-all hover:border-month-primary/30 cursor-pointer ${
          isUnavailable ? "opacity-50" : ""
        }`}
        onClick={handleOpenFullscreen}
      >
        {/* Camera Preview */}
        <div className="relative aspect-video bg-muted">
          {isUnavailable ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <VideoOff className="size-8 text-muted-foreground" />
            </div>
          ) : (
            <>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {error ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <VideoOff className="size-8 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{t("loadingError")}</span>
                </div>
              ) : imageUrl ? (
                <img
                  src={imageUrl}
                  alt={label}
                  className={`size-full object-cover ${isLoading ? "opacity-0" : "opacity-100"} transition-opacity`}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              ) : null}
              {/* Fullscreen hint */}
              <div className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <Maximize2 className="size-4" />
              </div>
            </>
          )}
        </div>

        {/* Label */}
        <div className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Video className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium truncate">{label}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {isUnavailable ? t("offline") : entity.state}
            </span>
          </div>
        </div>
      </div>

      {/* Fullscreen Dialog */}
      <Dialog open={fullscreenOpen} onOpenChange={handleCloseFullscreen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] p-0">
          <DialogHeader className="p-4 pb-0 pr-12">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="size-5" />
                <DialogTitle>{label}</DialogTitle>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadSnapshot()}
                  disabled={isStreaming}
                >
                  <RefreshCw className="size-4 mr-2" />
                  {t("refreshButton")}
                </Button>
                <Button
                  variant={isStreaming ? "default" : "outline"}
                  size="sm"
                  onClick={toggleStream}
                >
                  {isStreaming ? t("streamStop") : t("streamStart")}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="p-4">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              {isStreaming ? (
                // MJPEG Stream
                <img
                  src={getCameraUrl(true) || ""}
                  alt={label}
                  className="size-full object-contain"
                  onError={() => {
                    setIsStreaming(false);
                    setError(true);
                  }}
                />
              ) : (
                // Snapshot with auto-refresh
                <FullscreenSnapshot
                  familyId={family?.id}
                  entityId={entity.entity_id}
                  alt={label}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Separate component for fullscreen snapshot with faster refresh
function FullscreenSnapshot({
  familyId,
  entityId,
  alt,
}: {
  familyId: string | undefined;
  entityId: string;
  alt: string;
}) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!familyId) return;

    const updateImage = () => {
      const timestamp = Date.now();
      setImageUrl(`/api/homeassistant/camera?family_id=${familyId}&entity_id=${entityId}&type=snapshot&t=${timestamp}`);
    };

    // Initial load
    updateImage();

    // Refresh every 2 seconds in fullscreen
    const interval = setInterval(updateImage, 2000);

    return () => clearInterval(interval);
  }, [familyId, entityId]);

  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-white/50" />
        </div>
      )}
      <img
        src={imageUrl}
        alt={alt}
        className={`size-full object-contain ${isLoading ? "opacity-0" : "opacity-100"} transition-opacity`}
        onLoad={() => setIsLoading(false)}
        onError={() => setIsLoading(false)}
      />
    </>
  );
}
