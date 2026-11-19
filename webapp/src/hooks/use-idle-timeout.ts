"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { wakesScreen } from "@/lib/screensaver-gate";

interface UseIdleTimeoutOptions {
  /** Idle timeout in milliseconds (default: 2 minutes) */
  timeout?: number;
  /** Whether presence is currently detected by sensor */
  presenceDetected?: boolean;
  /** Whether presence sensor is enabled for this device */
  presenceEnabled?: boolean;
  /** Timeout in milliseconds before going idle after no presence (default: 30s) */
  presenceTimeout?: number;
}

/**
 * Hook to detect user idle state for screensaver functionality
 * Supports both touch/mouse activity detection and presence sensor detection
 */
export function useIdleTimeout({
  timeout = 120000,
  presenceDetected = false,
  presenceEnabled = false,
  presenceTimeout = 30000,
}: UseIdleTimeoutOptions = {}) {
  const [isIdle, setIsIdle] = useState(false);
  const noPresenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimer = useCallback(() => {
    setIsIdle(false);
  }, []);

  // Handle presence-based idle detection
  useEffect(() => {
    if (!presenceEnabled) return;

    if (presenceDetected) {
      // Presence detected - wake up immediately
      setIsIdle(false);
      if (noPresenceTimerRef.current) {
        clearTimeout(noPresenceTimerRef.current);
        noPresenceTimerRef.current = null;
      }
    } else {
      // No presence - go idle immediately or after timeout
      if (presenceTimeout <= 0) {
        setIsIdle(true);
      } else if (!noPresenceTimerRef.current && !isIdle) {
        noPresenceTimerRef.current = setTimeout(() => {
          setIsIdle(true);
          noPresenceTimerRef.current = null;
        }, presenceTimeout);
      }
    }

    return () => {
      if (noPresenceTimerRef.current) {
        clearTimeout(noPresenceTimerRef.current);
        noPresenceTimerRef.current = null;
      }
    };
  }, [presenceDetected, presenceEnabled, presenceTimeout, isIdle]);

  // Handle touch/mouse activity (only when presence sensor is NOT enabled)
  useEffect(() => {
    if (presenceEnabled) return; // Skip if using presence sensor

    // "Screensaver: off" arrives here as a non-finite timeout, and
    // setTimeout does NOT treat that as "never". The delay goes through
    // ToInt32, and ToInt32(Infinity) is 0 — so the screensaver appeared
    // at once, and every touch re-armed it with the same 0ms delay, which
    // left the display stuck behind it with no way out except changing
    // the setting from another device.
    //
    // The presence branch above already guards its degenerate value; this
    // one never did.
    if (!Number.isFinite(timeout) || timeout <= 0) {
      setIsIdle(false);
      return;
    }

    let timer: NodeJS.Timeout;

    const handleActivity = (e: Event) => {
      // Not while a modal is open, nor from a data-no-wake element (wakesScreen).
      if (!wakesScreen(e)) return;

      setIsIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIsIdle(true), timeout);
    };

    // Initial timer
    timer = setTimeout(() => setIsIdle(true), timeout);

    // Activity listeners
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // A tap inside a frame (a Home Assistant dashboard tab) is an event in the
    // frame's own document and never reaches this window. The one trace it
    // leaves here is this window losing focus to the frame, so that counts.
    // Further taps in the same frame leave none, which is why a long stay in a
    // dashboard tab can still end in the screensaver.
    let disposed = false;
    const handleBlur = (e: Event) => {
      // Where focus went is settled by the next task, not always during blur.
      setTimeout(() => {
        if (!disposed && document.activeElement instanceof HTMLIFrameElement) handleActivity(e);
      }, 0);
    };
    window.addEventListener("blur", handleBlur);

    return () => {
      disposed = true;
      clearTimeout(timer);
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      window.removeEventListener("blur", handleBlur);
    };
  }, [timeout, presenceEnabled]);

  return { isIdle, resetTimer };
}
