"use client";

import { useEffect, type ReactNode } from "react";
import { useKioskMode } from "@/hooks";
import { useFamilyStore } from "@/stores/family-store";

/**
 * Provider component that enables kiosk mode features when the device
 * is marked as a kiosk device in the database.
 *
 * Features enabled in kiosk mode:
 * - Auto-hiding cursor after inactivity
 * - Prevented context menu (right-click)
 * - Prevented text selection
 * - Wake lock to prevent screen sleep
 * - `data-kiosk` on <html>, so CSS can make kiosk-only decisions
 */
export function KioskProvider({ children }: { children: ReactNode }) {
  // Hook automatically reads device.is_kiosk from family store
  useKioskMode();

  // Expose kiosk-ness to CSS. Scrollbar suppression used to be global, which
  // is right for a wall panel and wrong for every other device (audit KB-35).
  const { device } = useFamilyStore();
  const isKiosk = device?.is_kiosk ?? false;
  useEffect(() => {
    const el = document.documentElement;
    if (isKiosk) el.setAttribute("data-kiosk", "true");
    else el.removeAttribute("data-kiosk");
    return () => el.removeAttribute("data-kiosk");
  }, [isKiosk]);

  return <>{children}</>;
}
