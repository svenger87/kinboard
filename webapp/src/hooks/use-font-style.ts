"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import {
  DEFAULT_FONT_STYLE_SETTINGS,
  fontStyleOf,
  type FontStyleSettings,
} from "@/lib/font-style";
import {
  DEFAULT_FONT_STYLE_CJK_SETTINGS,
  fontStyleCjkOf,
  type FontStyleCjkSettings,
} from "@/lib/font-style-cjk";

/**
 * The family's font styles (lib/font-style.ts, lib/font-style-cjk.ts),
 * applied to <body>: data-font-style points --font-display / --font-sans
 * at the picked Latin pairing, and — in a Chinese UI only —
 * data-font-style-cjk points --font-cjk at the picked Chinese face,
 * which globals.css puts at the head of both stacks. Each language's
 * picker edits its own setting, and the Chinese attribute is never set
 * outside a Chinese UI, so an English screen wears exactly the Latin
 * choice it always did. Classic and system remove their attribute — they
 * are what the variables already name. Called from
 * ThemeSettingsProvider, so every page (board and Settings alike) wears
 * the family's choices.
 */
export function useFontStyle() {
  const { data } = useSetting<FontStyleSettings>(
    SETTINGS_KEYS.fontStyle,
    DEFAULT_FONT_STYLE_SETTINGS,
  );
  const style = fontStyleOf(data);

  const { data: cjkData } = useSetting<FontStyleCjkSettings>(
    SETTINGS_KEYS.fontStyleCjk,
    DEFAULT_FONT_STYLE_CJK_SETTINGS,
  );
  const cjkStyle = fontStyleCjkOf(cjkData);
  const locale = useLocale();

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (style === "classic") {
      document.body.removeAttribute("data-font-style");
    } else {
      document.body.setAttribute("data-font-style", style);
    }
  }, [style]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (locale === "zh" && cjkStyle !== "system") {
      document.body.setAttribute("data-font-style-cjk", cjkStyle);
    } else {
      document.body.removeAttribute("data-font-style-cjk");
    }
  }, [locale, cjkStyle]);

  return style;
}
