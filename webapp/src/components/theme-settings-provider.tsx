"use client";

import { type ReactNode } from "react";
import { useThemeSettings } from "@/hooks";

/**
 * Provider component that loads theme settings from Supabase
 * and applies the monthly theme CSS class to the document.
 *
 * This should be placed inside AuthGuard so it has access to family context.
 */
export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  // This hook loads settings and applies the theme class to document.documentElement
  useThemeSettings();

  return <>{children}</>;
}
