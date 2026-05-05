"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

interface OnlineStatusState {
  isOnline: boolean;
  wasOffline: boolean; // True if was recently offline (for triggering sync)
  lastOnlineAt: number | null;
  lastOfflineAt: number | null;
}

interface UseOnlineStatusOptions {
  // Debounce time for status changes (avoid flapping)
  debounceMs?: number;
  // How long to consider "was offline" for sync trigger
  wasOfflineWindowMs?: number;
  // Callback when coming back online
  onOnline?: () => void;
  // Callback when going offline
  onOffline?: () => void;
}

const DEFAULT_OPTIONS: Required<UseOnlineStatusOptions> = {
  debounceMs: 1000,
  wasOfflineWindowMs: 30000, // 30 seconds
  onOnline: () => {},
  onOffline: () => {},
};

/**
 * Hook to detect online/offline status with debouncing
 * Returns current status and whether we recently came back online
 */
export function useOnlineStatus(
  options: UseOnlineStatusOptions = {}
): OnlineStatusState {
  const opts = useMemo(
    () => ({ ...DEFAULT_OPTIONS, ...options }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only depend on specific option values
    [options.debounceMs, options.wasOfflineWindowMs, options.onOnline, options.onOffline]
  );

  const [state, setState] = useState<OnlineStatusState>(() => ({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    wasOffline: false,
    lastOnlineAt: null,
    lastOfflineAt: null,
  }));

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wasOfflineTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleOnline = useCallback(() => {
    // Clear any pending offline transition
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Debounce the online transition
    timeoutRef.current = setTimeout(() => {
      setState((prev) => {
        const wasActuallyOffline = !prev.isOnline;
        return {
          isOnline: true,
          wasOffline: wasActuallyOffline,
          lastOnlineAt: Date.now(),
          lastOfflineAt: prev.lastOfflineAt,
        };
      });
      opts.onOnline();

      // Clear wasOffline flag after window
      if (wasOfflineTimeoutRef.current) {
        clearTimeout(wasOfflineTimeoutRef.current);
      }
      wasOfflineTimeoutRef.current = setTimeout(() => {
        setState((prev) => ({ ...prev, wasOffline: false }));
      }, opts.wasOfflineWindowMs);
    }, opts.debounceMs);
  }, [opts]);

  const handleOffline = useCallback(() => {
    // Clear any pending online transition
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Debounce the offline transition
    timeoutRef.current = setTimeout(() => {
      setState((prev) => ({
        ...prev,
        isOnline: false,
        lastOfflineAt: Date.now(),
      }));
      opts.onOffline();
    }, opts.debounceMs);
  }, [opts]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (wasOfflineTimeoutRef.current) {
        clearTimeout(wasOfflineTimeoutRef.current);
      }
    };
  }, [handleOnline, handleOffline]);

  return state;
}

/**
 * Simple hook that just returns boolean online status
 */
export function useIsOnline(): boolean {
  const { isOnline } = useOnlineStatus();
  return isOnline;
}

/**
 * Hook to check if we can make network requests
 * More aggressive - also checks if Supabase is reachable
 */
export function useNetworkAvailable(): {
  isAvailable: boolean;
  checkNow: () => Promise<boolean>;
} {
  const { isOnline } = useOnlineStatus();
  const [isSupabaseReachable, setIsSupabaseReachable] = useState(true);

  const checkNow = useCallback(async (): Promise<boolean> => {
    if (!isOnline) {
      setIsSupabaseReachable(false);
      return false;
    }

    try {
      // Try to fetch a small resource to verify connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch("/api/health", {
        method: "HEAD",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const reachable = response.ok;
      setIsSupabaseReachable(reachable);
      return reachable;
    } catch {
      setIsSupabaseReachable(false);
      return false;
    }
  }, [isOnline]);

  return {
    isAvailable: isOnline && isSupabaseReachable,
    checkNow,
  };
}
