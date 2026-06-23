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

export type Palette = "salbei" | "sand" | "warmgrey";

// Sand is the base (no class); the others are override classes in globals.css.
const PALETTE_CLASSES: Record<Palette, string | null> = {
  sand: null,
  salbei: "palette-salbei",
  warmgrey: "palette-warmgrey",
};
const ALL_PALETTE_CLASSES = ["palette-salbei", "palette-warmgrey"];

export interface ThemeSettings {
  themeOverride: number | null;
  palette: Palette;
  use24Hour: boolean;
  showSeconds: boolean;
  screensaverTimeout: number;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  themeOverride: null,
  palette: "sand",
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
  const palette: Palette = settings?.palette ?? "sand";

  // Apply theme class to document
  useEffect(() => {
    if (typeof document === "undefined" || isLoading) return;

    const html = document.documentElement;
    // Remove all theme classes
    MONTHLY_THEMES.forEach((t) => html.classList.remove(t));
    // Add active theme class
    html.classList.add(MONTHLY_THEMES[activeThemeIndex]);
  }, [activeThemeIndex, isLoading]);

  // Apply neutral-palette class to document
  useEffect(() => {
    if (typeof document === "undefined" || isLoading) return;

    const html = document.documentElement;
    ALL_PALETTE_CLASSES.forEach((c) => html.classList.remove(c));
    const cls = PALETTE_CLASSES[palette];
    if (cls) html.classList.add(cls);
  }, [palette, isLoading]);

  return {
    isLoading,
    themeOverride: settings?.themeOverride ?? null,
    palette,
    use24Hour: settings?.use24Hour ?? true,
    showSeconds: settings?.showSeconds ?? false,
    screensaverTimeout: settings?.screensaverTimeout ?? 120,
    activeThemeIndex,
  };
}
