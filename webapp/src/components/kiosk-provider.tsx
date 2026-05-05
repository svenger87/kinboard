"use client";

import { type ReactNode } from "react";
import { useKioskMode } from "@/hooks";

/**
 * Provider component that enables kiosk mode features when the device
 * is marked as a kiosk device in the database.
 *
 * Features enabled in kiosk mode:
 * - Auto-hiding cursor after inactivity
 * - Prevented context menu (right-click)
 * - Prevented text selection
 * - Wake lock to prevent screen sleep
 */
export function KioskProvider({ children }: { children: ReactNode }) {
  // Hook automatically reads device.is_kiosk from family store
  useKioskMode();

  return <>{children}</>;
}
