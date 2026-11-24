/**
 * The Chinese typefaces a family can pick (Settings → Design → Font style
 * when the UI language is Chinese): the same picker as lib/font-style.ts,
 * showing this set instead of the Latin pairings, and editing its own
 * family setting (`font_style_cjk`, `{ style }`) so each language keeps
 * its own choice. hooks/use-font-style.ts lands a non-system choice on
 * <body> as `data-font-style-cjk` — only while the locale is zh — and
 * globals.css points --font-cjk at the picked face's variable
 * (src/app/fonts.ts), which tailwind.config.ts puts at the head of the
 * display and text stacks. The subsets carry no Latin glyphs, so Latin
 * words and numbers fall through to the font_style pairing behind it.
 * `system` ships no webfont at all: CJK text falls back to the device,
 * exactly as it did before this picker existed.
 */
export type FontStyleCjkId = "system" | "noto-sans" | "noto-serif" | "zcool-kuaile";

export interface FontStyleCjkSettings {
  style: FontStyleCjkId;
}

/** What a family that never touched the setting gets: the device's fonts. */
export const DEFAULT_FONT_STYLE_CJK_SETTINGS: FontStyleCjkSettings = { style: "system" };

export interface FontStyleCjk {
  id: FontStyleCjkId;
  /**
   * The face's variable (src/app/fonts.ts), or null for system — its card
   * previews in whatever the device gives the current stack.
   */
  variable: string | null;
  /** The messages key (settings.theme) naming the style in the picker. */
  labelKey: string;
  /** The typeface names, shown under the style's name in the picker. */
  pairing: string;
}

export const FONT_STYLES_CJK: readonly FontStyleCjk[] = [
  {
    id: "system",
    variable: null,
    labelKey: "fontStyleCjk_system",
    pairing: "Device fonts",
  },
  {
    id: "noto-sans",
    variable: "--font-cjk-noto-sans",
    labelKey: "fontStyleCjk_notoSans",
    pairing: "Noto Sans SC · 思源黑体",
  },
  {
    id: "noto-serif",
    variable: "--font-cjk-noto-serif",
    labelKey: "fontStyleCjk_notoSerif",
    pairing: "Noto Serif SC · 思源宋体",
  },
  {
    id: "zcool-kuaile",
    variable: "--font-cjk-zcool-kuaile",
    labelKey: "fontStyleCjk_zcoolKuaile",
    pairing: "ZCOOL KuaiLe · 站酷快乐体",
  },
];

export function isFontStyleCjkId(value: unknown): value is FontStyleCjkId {
  return (
    value === "system" ||
    value === "noto-sans" ||
    value === "noto-serif" ||
    value === "zcool-kuaile"
  );
}

/** The saved value's style, or system for anything unusable. */
export function fontStyleCjkOf(settings: FontStyleCjkSettings | null | undefined): FontStyleCjkId {
  return isFontStyleCjkId(settings?.style) ? settings.style : "system";
}
