"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useFamilyStore } from "@/stores/family-store";

interface KioskConfig {
  hideCursorDelay?: number; // Delay before hiding cursor (ms)
  preventContextMenu?: boolean;
  preventTextSelection?: boolean;
  wakeLock?: boolean;
  enabled?: boolean; // Force enable/disable kiosk mode (overrides device setting)
}

/**
 * Hook for kiosk mode optimizations
 * - Auto-hides cursor after inactivity
 * - Prevents context menu and text selection
 * - Requests wake lock to prevent screen sleep
 * - Provides fullscreen toggle
 * - Automatically enabled when device is_kiosk setting is true
 */
export function useKioskMode(config: KioskConfig = {}) {
  const {
    hideCursorDelay = 3000,
    preventContextMenu = true,
    preventTextSelection = true,
    wakeLock = true,
    enabled,
  } = config;

  const { device } = useFamilyStore();
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCursorHidden, setIsCursorHidden] = useState(false);
  const [hasWakeLock, setHasWakeLock] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Detect if running in kiosk/standalone mode or if device is marked as kiosk
  useEffect(() => {
    if (typeof window === "undefined") return;

    // If enabled is explicitly set, use that
    if (enabled !== undefined) {
      setIsKioskMode(enabled);
      return;
    }

    // Check device is_kiosk setting from database
    if (device?.is_kiosk) {
      setIsKioskMode(true);
      return;
    }

    // Fall back to standalone/fullscreen detection
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    setIsKioskMode(isStandalone);
  }, [enabled, device?.is_kiosk]);

  // Auto-hide cursor after inactivity
  useEffect(() => {
    if (typeof window === "undefined" || !isKioskMode) return;

    let cursorTimer: NodeJS.Timeout;

    const showCursor = () => {
      setIsCursorHidden(false);
      document.body.style.cursor = "auto";

      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => {
        setIsCursorHidden(true);
        document.body.style.cursor = "none";
      }, hideCursorDelay);
    };

    // Initial hide
    cursorTimer = setTimeout(() => {
      setIsCursorHidden(true);
      document.body.style.cursor = "none";
    }, hideCursorDelay);

    window.addEventListener("mousemove", showCursor);
    window.addEventListener("mousedown", showCursor);
    window.addEventListener("touchstart", showCursor);

    return () => {
      clearTimeout(cursorTimer);
      document.body.style.cursor = "auto";
      window.removeEventListener("mousemove", showCursor);
      window.removeEventListener("mousedown", showCursor);
      window.removeEventListener("touchstart", showCursor);
    };
  }, [isKioskMode, hideCursorDelay]);

  // Prevent context menu
  useEffect(() => {
    if (typeof window === "undefined" || !isKioskMode || !preventContextMenu) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [isKioskMode, preventContextMenu]);

  // Prevent text selection
  useEffect(() => {
    if (typeof window === "undefined" || !isKioskMode || !preventTextSelection) return;

    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    return () => {
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };
  }, [isKioskMode, preventTextSelection]);

  // Request wake lock
  useEffect(() => {
    if (typeof window === "undefined" || !isKioskMode || !wakeLock) return;

    const requestWakeLock = async () => {
      // Don't request if we already have one
      if (wakeLockRef.current) return;

      if ("wakeLock" in navigator) {
        try {
          const sentinel = await navigator.wakeLock.request("screen");
          wakeLockRef.current = sentinel;
          setHasWakeLock(true);
          console.log("[Kiosk] Wake lock acquired");

          sentinel.addEventListener("release", () => {
            console.log("[Kiosk] Wake lock released");
            wakeLockRef.current = null;
            setHasWakeLock(false);
          });
        } catch (err) {
          console.warn("[Kiosk] Wake lock request failed:", err);
        }
      }
    };

    requestWakeLock();

    // Re-acquire wake lock when page becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
        setHasWakeLock(false);
      }
    };
  }, [isKioskMode, wakeLock]);

  // Track fullscreen state
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.error("[Kiosk] Fullscreen toggle failed:", err);
    }
  }, []);

  // Enter kiosk mode manually
  const enterKioskMode = useCallback(() => {
    setIsKioskMode(true);
  }, []);

  // Exit kiosk mode
  const exitKioskMode = useCallback(() => {
    setIsKioskMode(false);
    document.body.style.cursor = "auto";
    document.body.style.userSelect = "";
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
      setHasWakeLock(false);
    }
  }, []);

  return {
    isKioskMode,
    isFullscreen,
    isCursorHidden,
    hasWakeLock,
    toggleFullscreen,
    enterKioskMode,
    exitKioskMode,
  };
}
