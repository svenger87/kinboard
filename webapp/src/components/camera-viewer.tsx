"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Video,
  VideoOff,
  Maximize2,
  RefreshCw,
  Loader2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFamilyStore } from "@/stores/family-store";
import type { CameraConfig } from "@/types/home-assistant";

interface CameraViewerProps {
  camera: CameraConfig;
  showControls?: boolean;
  autoPlay?: boolean;
  className?: string;
}

// Static CSS scanline overlay — no animation (ARM-GPU + reduced-motion safe).
function ScanlineOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)",
      }}
    />
  );
}

// "LIVE" pill — red dot + label, shown only when a stream is actively rendering.
function LivePill({ label }: { label: string }) {
  return (
    <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/55 text-white text-[10px] font-medium uppercase tracking-wider">
      <span className="size-1.5 rounded-full bg-red-500" />
      {label}
    </div>
  );
}

export function CameraViewer({
  camera,
  showControls = true,
  autoPlay = true,
  className = "",
}: CameraViewerProps) {
  const t = useTranslations("components.cameraViewer");
  const { family } = useFamilyStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Callback ref to attach stream when video element mounts
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
    }
  }, []);

  const { stream_type, stream_url, snapshot_url, name, id: cameraId } = camera;

  // Always proxy through the webapp's /api/cameras endpoint when we
  // have a family context. Two reasons:
  //   1. Camera URLs are typically on a private LAN (RTSP / MJPEG /
  //      HTTP boxes at 192.168.x.x or — for the demo overlay — a
  //      docker-internal hostname like `go2rtc:1984`). Either way,
  //      the browser can't reach those directly.
  //   2. Avoids leaking internal IPs / hostnames to the browser
  //      console + DNS.
  // Direct-URL fallback stays for the brief window before family
  // hydrates, so the page doesn't break.
  const getStreamUrl = useCallback((type: "snapshot" | "stream" = "snapshot") => {
    if (family?.id) {
      return `/api/cameras?family_id=${family.id}&camera_id=${cameraId}&type=${type}&t=${Date.now()}`;
    }
    return type === "snapshot" ? (snapshot_url || stream_url) : stream_url;
  }, [family?.id, cameraId, snapshot_url, stream_url]);

  // Cleanup WebRTC connection
  const cleanupWebRTC = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  // Initialize WebRTC connection
  const initWebRTC = useCallback(async () => {
    if (stream_type !== "webrtc" || !videoRef.current) return;

    try {
      setIsLoading(true);
      setError(null);
      cleanupWebRTC();

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (event.streams[0]) {
          streamRef.current = event.streams[0];
          if (videoRef.current) {
            videoRef.current.srcObject = event.streams[0];
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("[WebRTC] ICE connection state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          setError(t("errorConnectionLost"));
        }
        if (pc.iceConnectionState === "connected") {
          setIsLoading(false);
        }
      };

      // Add transceivers for receiving media
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      // Create offer - no need to wait for ICE gathering, go2rtc provides candidates
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const offerSdp = offer.sdp;
      if (!offerSdp) {
        throw new Error("No SDP available");
      }

      console.log("[WebRTC] Sending offer to:", stream_url);

      // Send offer to signaling server (go2rtc expects JSON format)
      const response = await fetch(stream_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "offer",
          sdp: offerSdp,
        }),
      });

      console.log("[WebRTC] Got response, status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[WebRTC] Signaling error:", errorText);
        throw new Error(`Signaling failed: ${response.status}`);
      }

      const answer = await response.json();
      console.log("[WebRTC] Got answer, has SDP:", !!answer.sdp);

      if (answer.error) {
        throw new Error(answer.error);
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: answer.sdp,
      });
      console.log("[WebRTC] Remote description set, waiting for ICE connection");
    } catch (err) {
      console.error("WebRTC error:", err);
      setError(err instanceof Error ? err.message : t("errorWebRTC"));
      setIsLoading(false);
    }
  }, [stream_type, stream_url, cleanupWebRTC, t]);

  // Handle video loaded
  const handleVideoLoaded = () => {
    setIsLoading(false);
    setError(null);
  };

  // Handle image loaded
  const handleImageLoaded = () => {
    setIsLoading(false);
    setError(null);
  };

  // Handle errors
  const handleError = (message: string) => {
    setIsLoading(false);
    setError(message);
  };

  // Initialize stream based on type
  useEffect(() => {
    if (!autoPlay) return;

    if (stream_type === "webrtc") {
      initWebRTC();
    } else {
      setIsLoading(true);
      setError(null);
    }

    return () => {
      cleanupWebRTC();
    };
  }, [stream_type, autoPlay, initWebRTC, cleanupWebRTC]);


  // Render stream based on type
  const renderStream = (isFullscreen = false) => {
    const containerClass = isFullscreen
      ? "size-full"
      : "w-full aspect-video";

    if (error) {
      return (
        <div className={`${containerClass} bg-black/90 flex flex-col items-center justify-center gap-2`}>
          <VideoOff className="size-8 text-white/40" />
          <span className="text-sm font-medium text-white/80">{name}</span>
          <span className="text-xs text-white/50 text-center px-4">{error}</span>
          <Button variant="outline" size="sm" className="mt-1" onClick={() => {
            if (stream_type === "webrtc") {
              initWebRTC();
            } else {
              setIsLoading(true);
              setError(null);
              // Force re-render of image
              if (imgRef.current) {
                const url = new URL(imgRef.current.src);
                url.searchParams.set("t", Date.now().toString());
                imgRef.current.src = url.toString();
              }
            }
          }}>
            <RefreshCw className="size-4 mr-2" />
            {t("retry")}
          </Button>
        </div>
      );
    }

    switch (stream_type) {
      case "webrtc":
        // For WebRTC, show placeholder - actual video is rendered separately
        return (
          <div className={`${containerClass} bg-black relative`}>
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-8 animate-spin text-white/50" />
              </div>
            )}
            {/* Placeholder shown when video is in fullscreen */}
            {!isFullscreen && fullscreenOpen && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Video className="size-8 text-white/30" />
              </div>
            )}
            {!isFullscreen && <ScanlineOverlay />}
          </div>
        );

      case "mjpeg":
        return (
          <div className={`${containerClass} bg-black relative`}>
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-8 animate-spin text-white/50" />
              </div>
            )}
            <img
              ref={imgRef}
              src={getStreamUrl("stream")}
              alt={name}
              className="size-full object-contain"
              onLoad={handleImageLoaded}
              onError={() => handleError(t("errorStreamLoad"))}
            />
            {!isFullscreen && <ScanlineOverlay />}
          </div>
        );

      case "rtsp":
        // RTSP can't be played directly in browser - use auto-refreshing snapshot
        return (
          <AutoRefreshSnapshot
            getUrl={() => getStreamUrl("snapshot")}
            alt={name}
            containerClass={containerClass}
            isFullscreen={isFullscreen}
            onLoad={handleImageLoaded}
            onError={() => handleError(t("errorSnapshotLoad"))}
          />
        );

      default:
        return null;
    }
  };

  return (
    <>
      <div
        className={`rounded-2xl border bg-card overflow-hidden transition-all hover:border-primary/30 cursor-pointer group ${className}`}
        onClick={() => setFullscreenOpen(true)}
      >
        {/* Camera Preview */}
        <div className="relative">
          {stream_type === "webrtc" ? (
            <div className="w-full aspect-video bg-black relative">
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-8 animate-spin text-white/50" />
                </div>
              )}
              {/* Video element - only rendered here when NOT fullscreen */}
              {!fullscreenOpen && (
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted={isMuted}
                  className="size-full object-contain"
                  onLoadedData={handleVideoLoaded}
                  onError={() => handleError(t("errorVideoLoad"))}
                />
              )}
              {/* Placeholder when fullscreen is open */}
              {fullscreenOpen && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Video className="size-8 text-white/30" />
                </div>
              )}
              {!fullscreenOpen && <ScanlineOverlay />}
            </div>
          ) : (
            renderStream(false)
          )}

          {/* LIVE pill — only when a stream is actively rendering */}
          {!error && !isLoading && <LivePill label={t("live")} />}

          {/* Name overlay over the video */}
          {!error && (
            <div className="absolute bottom-0 inset-x-0 p-2 pt-6 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
              <span className="text-sm font-medium text-white truncate block">{name}</span>
            </div>
          )}

          {/* Fullscreen hint */}
          {showControls && !error && (
            <div className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <Maximize2 className="size-4" />
            </div>
          )}
        </div>

      </div>

      {/* Fullscreen Dialog */}
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[95vh] p-0">
          <DialogHeader className="p-4 pb-0 pr-12">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="size-5" />
                <DialogTitle>{name}</DialogTitle>
              </div>
              <div className="flex items-center gap-2">
                {stream_type === "webrtc" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsMuted(!isMuted)}
                  >
                    {isMuted ? (
                      <VolumeX className="size-4" />
                    ) : (
                      <Volume2 className="size-4" />
                    )}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (stream_type === "webrtc") {
                      initWebRTC();
                    } else {
                      setIsLoading(true);
                      setError(null);
                    }
                  }}
                >
                  <RefreshCw className="size-4 mr-2" />
                  {t("refresh")}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="p-4 pt-2">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              {stream_type === "webrtc" ? (
                <>
                  {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <Loader2 className="size-8 animate-spin text-white/50" />
                    </div>
                  )}
                  {/* Video element - rendered here when fullscreen IS open */}
                  <video
                    ref={setVideoRef}
                    autoPlay
                    playsInline
                    muted={isMuted}
                    className="size-full object-contain"
                    onLoadedData={handleVideoLoaded}
                    onError={() => handleError(t("errorVideoLoad"))}
                  />
                </>
              ) : (
                renderStream(true)
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Auto-refreshing snapshot component
function AutoRefreshSnapshot({
  getUrl,
  alt,
  containerClass,
  isFullscreen,
  onLoad,
  onError,
}: {
  getUrl: () => string;
  alt: string;
  containerClass: string;
  isFullscreen: boolean;
  onLoad: () => void;
  onError: () => void;
}) {
  const t = useTranslations("components.cameraViewer");
  const [imageUrl, setImageUrl] = useState(getUrl());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Refresh rate: 2s in fullscreen, 5s in thumbnail
    const interval = isFullscreen ? 2000 : 5000;

    const timer = setInterval(() => {
      setImageUrl(getUrl());
    }, interval);

    return () => clearInterval(timer);
  }, [getUrl, isFullscreen]);

  return (
    <div className={`${containerClass} bg-black relative`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-white/50" />
        </div>
      )}
      <img
        src={imageUrl}
        alt={alt}
        className="size-full object-contain"
        onLoad={() => {
          setIsLoading(false);
          onLoad();
        }}
        onError={() => {
          setIsLoading(false);
          onError();
        }}
      />
      {!isFullscreen && <ScanlineOverlay />}
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/70 text-white text-xs flex items-center gap-1">
        <RefreshCw className="size-3" />
        {t("autoRefresh")}
      </div>
    </div>
  );
}

// Grid component for multiple cameras
interface CameraGridProps {
  cameras: CameraConfig[];
  columns?: 1 | 2 | 3 | 4;
}

export function CameraGrid({ cameras, columns = 2 }: CameraGridProps) {
  const t = useTranslations("components.cameraViewer");
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  };

  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Video className="size-12 text-muted-foreground/50 mb-4" />
        <h3 className="font-medium mb-2">{t("emptyTitle")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className={`grid ${gridCols[columns]} gap-4`}>
      {cameras.map((camera) => (
        <CameraViewer key={camera.id} camera={camera} />
      ))}
    </div>
  );
}
