import {
  Home,
  CalendarDays,
  GraduationCap,
  CheckSquare,
  ShoppingCart,
  ChefHat,
  UtensilsCrossed,
  Cake,
  StickyNote,
  Plug,
  Zap,
  Car,
  Video,
  Newspaper,
  Settings,
} from "lucide-react";

/**
 * Paths where the bottom navigation should not be rendered.
 *
 * `/einkaufen` is the Shopping PWA's `start_url` + `scope` (see
 * `public/manifest-shopping.json`). It's preserved as a URL alias —
 * the route is a Next rewrite to `/shopping` content (single canonical
 * page lives at `/shopping`), but the URL stays `/einkaufen` so iOS's
 * scope-match for the installed Shopping PWA continues to work and
 * triggers the "Open in App" banner.
 *
 * Both `/einkaufen` and `/shopping` should suppress the nav: they're
 * the same kiosk-style shopping experience just under two URL aliases.
 */
export const NO_NAV_PATHS = ["/join", "/einkaufen", "/shopping", "/setup"] as const;

/**
 * True when the given pathname matches any NO_NAV_PATHS entry exactly,
 * or is a child route of one (e.g. "/setup/people" matches "/setup").
 * The trailing-slash check prevents accidental matches on paths that
 * share a prefix but aren't children (e.g. "/joiner" wouldn't match "/join").
 */
export function isNoNavPath(pathname: string): boolean {
  return NO_NAV_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/**
 * Unified navigation items shared by mobile and desktop navs.
 * `labelKey` resolves to messages/{locale}.json under the `nav.*` namespace.
 */
export const NAV_ITEMS = [
  { href: "/", icon: Home, labelKey: "home" },
  { href: "/calendar", icon: CalendarDays, labelKey: "calendar" },
  { href: "/schedule", icon: GraduationCap, labelKey: "schedule" },
  { href: "/todos", icon: CheckSquare, labelKey: "todos" },
  { href: "/shopping", icon: ShoppingCart, labelKey: "shopping" },
  { href: "/recipes", icon: ChefHat, labelKey: "recipes" },
  { href: "/meals", icon: UtensilsCrossed, labelKey: "meals" },
  { href: "/birthdays", icon: Cake, labelKey: "birthdays" },
  { href: "/notes", icon: StickyNote, labelKey: "notes" },
  { href: "/home-automation", icon: Plug, labelKey: "homeAutomation" },
  { href: "/energy", icon: Zap, labelKey: "energy" },
  { href: "/tesla", icon: Car, labelKey: "tesla" },
  { href: "/cameras", icon: Video, labelKey: "cameras" },
  { href: "/news", icon: Newspaper, labelKey: "news" },
  { href: "/settings", icon: Settings, labelKey: "settings" },
] as const;
