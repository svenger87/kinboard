"use client";

import { useEffect } from "react";
import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import {
  DEFAULT_FONT_STYLE_SETTINGS,
  fontStyleOf,
  type FontStyleSettings,
} from "@/lib/font-style";

/**
 * The family's font style (lib/font-style.ts), applied to <body> as
 * data-font-style: globals.css points --font-display / --font-sans at the
 * picked pair's variables. Classic removes the attribute — it is the
 * pairing the variables already name. Called from ThemeSettingsProvider,
 * so every page (board and Settings alike) wears the family's choice.
 */
export function useFontStyle() {
  const { data } = useSetting<FontStyleSettings>(
    SETTINGS_KEYS.fontStyle,
    DEFAULT_FONT_STYLE_SETTINGS,
  );
  const style = fontStyleOf(data);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (style === "classic") {
      document.body.removeAttribute("data-font-style");
    } else {
      document.body.setAttribute("data-font-style", style);
    }
  }, [style]);

  return style;
}
