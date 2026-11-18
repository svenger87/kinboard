"use client";

import { useEffect } from "react";
import { readDeviceScreen, sameDeviceScreen, type DeviceScreen } from "@/lib/device-screen";

/** How often the size is looked at, beside every resize. Sent only when it has changed. */
const CHECK_EVERY = 60_000;
/** A resize settles first: dragging a window's edge fires dozens. */
const SETTLE = 2_000;

/**
 * Reports this screen's size to Kinboard (POST /api/screen) once it
 * runs as a device, and again whenever the size changes: a window resized,
 * a tablet turned, the Windows scaling changed. Settings -> Devices shows it,
 * and the layout designer draws for it.
 *
 * Fire and forget, like the heartbeat beside it: a failed report is tried
 * again on the next check, since the last size sent stays the old one.
 */
export function useReportDeviceScreen(deviceId: string | null | undefined) {
  useEffect(() => {
    if (!deviceId) return;
    let sent: DeviceScreen | null = null;
    let busy = false;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const report = async () => {
      if (busy || document.hidden) return;
      const now = readDeviceScreen(window);
      if (sameDeviceScreen(now, sent)) return;
      busy = true;
      try {
        const r = await fetch("/api/screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(now),
        });
        if (r.ok) sent = now;
      } catch {
        // Offline or the server restarting: the next check sends it.
      } finally {
        busy = false;
      }
    };
    const onResize = () => {
      clearTimeout(settle);
      settle = setTimeout(report, SETTLE);
    };

    report();
    const timer = setInterval(report, CHECK_EVERY);
    window.addEventListener("resize", onResize);
    return () => {
      clearInterval(timer);
      clearTimeout(settle);
      window.removeEventListener("resize", onResize);
    };
  }, [deviceId]);
}
