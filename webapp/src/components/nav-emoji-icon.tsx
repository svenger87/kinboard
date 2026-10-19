import type { NavIcon } from "@/lib/constants";

/*
  A navigation entry the household gave an emoji (a Home Assistant dashboard)
  is drawn where the Lucide icons are, at their size: the navs pass either a
  `size` in pixels or a `size-*` class, so the emoji fills that box. One
  component per emoji, kept, so the navs don't remount the icon every render.
*/
const cache = new Map<string, NavIcon>();

export function emojiNavIcon(emoji: string): NavIcon {
  const known = cache.get(emoji);
  if (known) return known;
  const Icon: NavIcon = ({ className, size }) => (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center leading-none ${className ?? ""}`}
      style={size ? { width: size, height: size, fontSize: size } : { fontSize: "1.15em" }}
    >
      {emoji}
    </span>
  );
  Icon.displayName = `EmojiNavIcon(${emoji})`;
  cache.set(emoji, Icon);
  return Icon;
}
