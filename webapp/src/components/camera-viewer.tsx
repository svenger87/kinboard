"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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

// How wide a frame to ask go2rtc for, by where it is being drawn.
//
// A camera's own resolution used to come through untouched, which for a 4K
// camera is ~700 KB of JPEG every 5 seconds per tile, painted into a box a
// few hundred pixels wide. These are generous enough for a hi-dpi panel and
// still an order of magnitude less data — the same 4K camera returns ~44 KB
// at 640. The full-screen dialog is capped near 1024 CSS pixels, so 1600
// covers it on a 2x display.
//
// Only cameras go2rtc decodes for us are affected. One with its own snapshot
// URL is fetched from the camera at whatever size the camera sends.
const SNAPSHOT_WIDTH_TILE = 640;
const SNAPSHOT_WIDTH_FULLSCREEN = 1600;

// "LIVE" pill — red dot + label, shown only when a stream is actively rendering.
function LivePill({ label }: { label: string }) {
  return (
    <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/55 text-white text-3xs font-medium uppercase tracking-wider">
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
  // An RTSP camera starts on the snapshot and upgrades to live video if the
  // WebRTC connection comes up. See `signalingUrl` below for why both.
  const [rtspLive, setRtspLive] = useState(false);
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
  // hydrates, so the page doesn't break — except where that fallback would
  // be an rtsp:// URL. The browser cannot open one, so it buys nothing, and
  // it would put the camera's password into the DOM to fail with. Null
  // instead, and the tile waits the moment out.
  const getStreamUrl = useCallback((
    type: "snapshot" | "stream" = "snapshot",
    width?: number,
  ) => {
    if (family?.id) {
      return `/api/cameras?family_id=${family.id}&camera_id=${cameraId}&type=${type}`
        + (width ? `&w=${width}` : "")
        + `&t=${Date.now()}`;
    }
    const direct = type === "snapshot" ? (snapshot_url || stream_url) : stream_url;
    return /^rtsps?:\/\//i.test(direct ?? "") ? null : direct;
  }, [family?.id, cameraId, snapshot_url, stream_url]);

  // Where to send the SDP offer, or null for a camera that isn't played over
  // WebRTC at all.
  //
  // A `webrtc` camera points at whatever signalling server its owner
  // configured, and keeps doing so. An `rtsp` camera goes through our own
  // proxy, which looks the camera up by id and hands go2rtc the URL — so the
  // RTSP credentials stay on the server, and the browser never learns the
  // address of the camera. It needs the family loaded first, so this is null
  // for the moment before that hydrates and the effect re-runs when it does.
  //
  // RTSP does not switch to video and stay there: WebRTC needs ICE to
  // complete, which needs WEBRTC_LAN_IP set and UDP 8555 open, and plenty of
  // installations have neither. So the snapshot renders immediately and video
  // replaces it only once the connection is actually up — a camera that can't
  // do WebRTC still shows a picture rather than a black rectangle.
  const signalingUrl = useMemo(() => {
    if (stream_type === "webrtc") return stream_url;
    if (stream_type === "rtsp" && family?.id) {
      return `/api/cameras/webrtc?camera_id=${encodeURIComponent(cameraId)}`;
    }
    return null;
  }, [stream_type, stream_url, family?.id, cameraId]);

  // Cleanup WebRTC connection
  const cleanupWebRTC = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  // Initialize WebRTC connection
  const initWebRTC = useCallback(async () => {
    if (!signalingUrl) return;

    // An RTSP camera has no <video> element until the connection is up, so
    // "is it mounted yet" cannot be the precondition it used to be; the track
    // is parked in streamRef and attached by setVideoRef when it mounts.
    const isFallbackCapable = stream_type === "rtsp";

    try {
      if (!isFallbackCapable) setIsLoading(true);
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
          // For RTSP that is not an error the household needs to see — it
          // means "no live video here", and the snapshot takes over.
          if (isFallbackCapable) {
            setRtspLive(false);
          } else {
            setError(t("errorConnectionLost"));
          }
        }
        if (pc.iceConnectionState === "connected") {
          setIsLoading(false);
          if (isFallbackCapable) setRtspLive(true);
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

      console.log("[WebRTC] Sending offer to:", signalingUrl);

      // Send offer to signaling server (go2rtc expects JSON format)
      const response = await fetch(signalingUrl, {
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
      if (isFallbackCapable) {
        setRtspLive(false);
      } else {
        setError(err instanceof Error ? err.message : t("errorWebRTC"));
        setIsLoading(false);
      }
    }
  }, [stream_type, signalingUrl, cleanupWebRTC, t]);

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

  // A <video> that fails on an RTSP camera drops back to the snapshot rather
  // than replacing a working picture with an error.
  const handleVideoError = () => {
    if (stream_type === "rtsp") {
      setRtspLive(false);
    } else {
      handleError(t("errorVideoLoad"));
    }
  };

  // Initialize stream based on type
  useEffect(() => {
    if (!autoPlay) return;

    if (signalingUrl) {
      initWebRTC();
    }
    if (stream_type !== "webrtc") {
      setIsLoading(true);
      setError(null);
    }

    return () => {
      cleanupWebRTC();
    };
  }, [stream_type, signalingUrl, autoPlay, initWebRTC, cleanupWebRTC]);

  // True when a <video> element is carrying the picture, as opposed to the
  // polled still image.
  const showsLiveVideo = stream_type === "webrtc" || rtspLive;


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
            if (signalingUrl) {
              initWebRTC();
            }
            if (stream_type !== "webrtc") {
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
              src={getStreamUrl("stream") ?? undefined}
              alt={name}
              className="size-full object-contain"
              onLoad={handleImageLoaded}
              onError={() => handleError(t("errorStreamLoad"))}
            />
            {!isFullscreen && <ScanlineOverlay />}
          </div>
        );

      case "rtsp":
        // The browser can't open rtsp:// — the frames come from go2rtc as
        // JPEGs through /api/cameras. Shown until (and unless) the WebRTC
        // connection above comes up with real video.
        return (
          <AutoRefreshSnapshot
            getUrl={() =>
              getStreamUrl(
                "snapshot",
                isFullscreen ? SNAPSHOT_WIDTH_FULLSCREEN : SNAPSHOT_WIDTH_TILE,
              )
            }
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
          {showsLiveVideo ? (
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
                  onError={handleVideoError}
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
                {showsLiveVideo && (
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
                    if (signalingUrl) {
                      initWebRTC();
                    }
                    if (stream_type !== "webrtc") {
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
              {showsLiveVideo ? (
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
                    onError={handleVideoError}
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
  getUrl: () => string | null;
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
    // Re-read immediately as well as on the interval: getUrl changes identity
    // when the family hydrates, and until then it can have nothing to give.
    setImageUrl(getUrl());

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
      {/* No <img> at all rather than one with an empty src, which browsers
          treat as "reload this page's URL as an image" and report as a
          broken picture. */}
      {imageUrl && (
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
      )}
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
