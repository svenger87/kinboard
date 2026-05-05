"use client";

import { useSetting, useUpdateSetting } from "./use-supabase-queries";
import type { ScreensaverSettings } from "@/types/screensaver";
import { DEFAULT_SCREENSAVER_SETTINGS } from "@/types/screensaver";

/**
 * Hook to get screensaver settings for the current family
 */
export function useScreensaverSettings() {
  const { data: settings, isLoading } = useSetting<ScreensaverSettings>(
    "screensaver",
    DEFAULT_SCREENSAVER_SETTINGS
  );

  return {
    isLoading,
    screensaverTimeout: settings?.screensaverTimeout ?? DEFAULT_SCREENSAVER_SETTINGS.screensaverTimeout,
    presenceTimeout: settings?.presenceTimeout ?? DEFAULT_SCREENSAVER_SETTINGS.presenceTimeout,
    presenceControlMode: settings?.presenceControlMode ?? DEFAULT_SCREENSAVER_SETTINGS.presenceControlMode,
    photoRotationInterval: settings?.photoRotationInterval ?? DEFAULT_SCREENSAVER_SETTINGS.photoRotationInterval,
    settings: settings ?? DEFAULT_SCREENSAVER_SETTINGS,
  };
}

/**
 * Hook to update screensaver settings
 */
export function useUpdateScreensaverSettings() {
  return useUpdateSetting<ScreensaverSettings>();
}

export { DEFAULT_SCREENSAVER_SETTINGS };
export type { ScreensaverSettings };
