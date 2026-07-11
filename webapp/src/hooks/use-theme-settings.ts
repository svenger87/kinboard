"use client";

import { useCallback, useEffect, useState } from "react";
import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

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
  const { data: settings, isLoading } = useSetting<ThemeSettings>(SETTINGS_KEYS.theme, DEFAULT_THEME_SETTINGS);

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

// ---------------------------------------------------------------------------
// Per-device text scaling
//
// Deliberately NOT part of the family-wide theme settings blob above: the
// wall kiosk and a family member's phone need different text sizes (same
// rationale as the per-device nav order in /settings/navigation). Stored in
// localStorage per device instead of Supabase.
// ---------------------------------------------------------------------------

const TEXT_SCALE_STORAGE_KEY = "kinboard_text_scale";
const TEXT_SCALE_CHANGE_EVENT = "kinboard:text-scale-change";

export type TextScale = 1 | 1.15 | 1.3;

const VALID_TEXT_SCALES: TextScale[] = [1, 1.15, 1.3];

function readStoredTextScale(): TextScale {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY);
  const parsed = raw ? Number(raw) : 1;
  return (VALID_TEXT_SCALES as number[]).includes(parsed) ? (parsed as TextScale) : 1;
}

/**
 * Per-device text scale: `[scale, setScale]`, backed by localStorage.
 * Multiple hook instances (e.g. the settings control + the provider that
 * applies it) stay in sync via a same-tab CustomEvent — the native
 * `storage` event only fires in *other* tabs.
 */
export function useTextScale(): [TextScale, (scale: TextScale) => void] {
  const [scale, setScaleState] = useState<TextScale>(1);

  useEffect(() => {
    setScaleState(readStoredTextScale());

    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<TextScale>).detail;
      if (detail !== undefined) setScaleState(detail);
    };
    window.addEventListener(TEXT_SCALE_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(TEXT_SCALE_CHANGE_EVENT, handleChange);
  }, []);

  const setScale = useCallback((next: TextScale) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TEXT_SCALE_STORAGE_KEY, String(next));
    window.dispatchEvent(new CustomEvent<TextScale>(TEXT_SCALE_CHANGE_EVENT, { detail: next }));
  }, []);

  return [scale, setScale];
}
