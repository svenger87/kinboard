"use client";

import { useEffect } from "react";
import { useSetting } from "./use-supabase-queries";

const MONTHLY_THEMES = [
  "theme-january",
  "theme-february",
  "theme-march",
  "theme-april",
  "theme-may",
  "theme-june",
  "theme-july",
  "theme-august",
  "theme-september",
  "theme-october",
  "theme-november",
  "theme-december",
];

export interface ThemeSettings {
  themeOverride: number | null;
  use24Hour: boolean;
  showSeconds: boolean;
  screensaverTimeout: number;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  themeOverride: null,
  use24Hour: true,
  showSeconds: false,
  screensaverTimeout: 120,
};

/**
 * Hook to load and apply theme settings from Supabase
 * - Applies the monthly theme CSS class to the document
 * - Returns all theme settings for use in components
 */
export function useThemeSettings() {
  const { data: settings, isLoading } = useSetting<ThemeSettings>("theme", DEFAULT_THEME_SETTINGS);

  const currentMonth = new Date().getMonth();
  const themeOverride = settings?.themeOverride ?? null;
  const activeThemeIndex = themeOverride !== null ? themeOverride : currentMonth;

  // Apply theme class to document
  useEffect(() => {
    if (typeof document === "undefined" || isLoading) return;

    const html = document.documentElement;
    // Remove all theme classes
    MONTHLY_THEMES.forEach((t) => html.classList.remove(t));
    // Add active theme class
    html.classList.add(MONTHLY_THEMES[activeThemeIndex]);
  }, [activeThemeIndex, isLoading]);

  return {
    isLoading,
    themeOverride: settings?.themeOverride ?? null,
    use24Hour: settings?.use24Hour ?? true,
    showSeconds: settings?.showSeconds ?? false,
    screensaverTimeout: settings?.screensaverTimeout ?? 120,
    activeThemeIndex,
  };
}
