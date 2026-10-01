"use client";

import { useEffect, useMemo, useState } from "react";
import {
  effectiveHiddenNavItems,
  getHiddenNavItems,
  getSettingsIconOnly,
  NAV_VISIBILITY_EVENT,
} from "@/lib/nav-visibility";
import { useFamilyStore } from "@/stores/family-store";

/**
 * The nav items hidden on this device. Both bottom bars and Settings →
 * Navigation read it here, so all three agree on what a non-kiosk device may
 * hide -- see effectiveHiddenNavItems.
 */
export function useHiddenNavItems(): readonly string[] {
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const { device } = useFamilyStore();
  const isKiosk = device?.is_kiosk ?? false;
  useEffect(() => {
    const update = () => setHidden(getHiddenNavItems());
    update();
    window.addEventListener(NAV_VISIBILITY_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(NAV_VISIBILITY_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return useMemo(() => effectiveHiddenNavItems(hidden, isKiosk), [hidden, isKiosk]);
}

export function useSettingsIconOnly(): boolean {
  const [iconOnly, setIconOnly] = useState(false);
  useEffect(() => {
    const update = () => setIconOnly(getSettingsIconOnly());
    update();
    window.addEventListener(NAV_VISIBILITY_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(NAV_VISIBILITY_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return iconOnly;
}
