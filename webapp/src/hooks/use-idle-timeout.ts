"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
      // Ignore all activity when a modal is open (data-modal-open on body)
      if (document.body.hasAttribute("data-modal-open")) {
        return;
      }

      // Ignore events from elements with data-no-wake attribute or their children
      const target = e.target as HTMLElement;
      if (target?.closest?.("[data-no-wake]")) {
        return;
      }

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

    return () => {
      clearTimeout(timer);
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [timeout, presenceEnabled]);

  return { isIdle, resetTimer };
}
