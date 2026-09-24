"use client";

import { useEffect, useState } from "react";
import { getHiddenNavItems, getSettingsIconOnly, NAV_VISIBILITY_EVENT } from "@/lib/nav-visibility";

export function useHiddenNavItems(): readonly string[] {
  const [hidden, setHidden] = useState<readonly string[]>([]);
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
  return hidden;
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
