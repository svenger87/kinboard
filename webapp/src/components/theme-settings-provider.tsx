"use client";

import { useEffect, type ReactNode } from "react";
import { useThemeSettings, useTextScale } from "@/hooks";
import { useFestivalSync } from "@/hooks/use-festival";

/**
 * Provider component that loads theme settings from Supabase
 * and applies the monthly theme CSS class to the document.
 *
 * This should be placed inside AuthGuard so it has access to family context.
 */
export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  // This hook loads settings and applies the theme class to document.documentElement
  useThemeSettings();
  // The festival on this screen (RFC-020): <html data-festival>, the colour
  // wash's two colours and the dressing key off it.
  useFestivalSync();

  // Per-device text scale (localStorage, not the Supabase theme blob — see
  // useTextScale). Applying via root font-size lets Tailwind's rem-based
  // scale propagate everywhere without per-component changes.
  const [textScale] = useTextScale();
  useEffect(() => {
    document.documentElement.style.fontSize = textScale === 1 ? "" : `${16 * textScale}px`;
  }, [textScale]);

  return <>{children}</>;
}
