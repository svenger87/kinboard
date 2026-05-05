"use client";

import { useState, useEffect, useCallback } from "react";
import { useFamilyStore } from "@/stores/family-store";
import type { PresenceState } from "@/types/screensaver";

const DEFAULT_POLL_INTERVAL = 3000; // 3 seconds - balance between responsiveness and CPU usage

/**
 * Hook to get presence sensor state for the current device
 * Only polls when the device has presence sensor enabled
 */
export function usePresence(pollInterval = DEFAULT_POLL_INTERVAL): PresenceState {
  const { device } = useFamilyStore();
  const [presence, setPresence] = useState<PresenceState>({
    detected: false,
    lastSeen: null,
    stale: true,
    isEnabled: false,
  });

  const isEnabled = device?.has_presence_sensor ?? false;

  const fetchPresence = useCallback(async () => {
    if (!device?.id || !isEnabled) return;

    try {
      const response = await fetch(`/api/presence?device_id=${device.id}`);
      if (response.ok) {
        const data = await response.json();
        setPresence({
          detected: data.detected,
          lastSeen: data.lastSeen,
          distance: data.distance,
          stale: data.stale,
          isEnabled: true,
        });
      }
    } catch (err) {
      console.warn("[Presence] Failed to fetch state:", err);
      // On error, mark as stale but keep last known state
      setPresence((prev) => ({ ...prev, stale: true }));
    }
  }, [device?.id, isEnabled]);

  useEffect(() => {
    if (!isEnabled) {
      setPresence({
        detected: false,
        lastSeen: null,
        stale: true,
        isEnabled: false,
      });
      return;
    }

    // Fetch immediately
    fetchPresence();

    // Then poll at interval
    const interval = setInterval(fetchPresence, pollInterval);

    return () => clearInterval(interval);
  }, [isEnabled, pollInterval, fetchPresence]);

  return presence;
}
