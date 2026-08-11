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
  Images,
  LineChart,
  Newspaper,
  Settings,
  PiggyBank,
} from "lucide-react";

/**
 * Paths where the bottom navigation should not be rendered.
 *
 * `/einkaufen` is the Shopping PWA's `start_url` + `scope` (see
 * `public/manifest-shopping.json`) AND the kiosk-optimized offline-first
 * shopping surface — leaner UI built on `useOfflineShopping`, intended
 * to be what users see when launching the installed Shopping PWA.
 * That standalone-PWA experience deliberately hides the nav (kiosk
 * mode — there's nowhere else to go inside the dedicated Shopping app).
 *
 * `/shopping` is the full-featured desktop shopping page reached via
 * the bottom-nav "Shopping" button. It MUST keep the nav — hiding it
 * on the page that's the nav's own target traps users without a way
 * out (no back button on a kiosk).
 */
export const NO_NAV_PATHS = ["/join", "/einkaufen", "/setup"] as const;

/**
 * True when the given pathname matches any NO_NAV_PATHS entry exactly,
 * or is a child route of one (e.g. "/setup/people" matches "/setup").
 * The trailing-slash check prevents accidental matches on paths that
 * share a prefix but aren't children (e.g. "/joiner" wouldn't match "/join").
 */
/**
 * Routes where the screensaver must not take over. It is a superset of
 * NO_NAV_PATHS — those two lists are deliberately separate, because adding a
 * path here must not also strip its navigation.
 *
 * `/settings` is here because the PIN prompt lives under it: standing at the
 * pad without touching the screen let the idle timer run out and the
 * screensaver covered the prompt mid-entry, which reads as the prompt timing
 * out on you. Settings is an actively-used surface anyway.
 */
export const SCREENSAVER_SKIP_PATHS = [...NO_NAV_PATHS, "/settings"] as const;

export function isScreensaverSkipPath(pathname: string): boolean {
  return SCREENSAVER_SKIP_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

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
  { href: "/vehicles", icon: Car, labelKey: "vehicles" },
  { href: "/stonks", icon: LineChart, labelKey: "stonks" },
  { href: "/pocket-money", icon: PiggyBank, labelKey: "pocketMoney" },
  { href: "/cameras", icon: Video, labelKey: "cameras" },
  { href: "/photos", icon: Images, labelKey: "photos" },
  { href: "/news", icon: Newspaper, labelKey: "news" },
  { href: "/settings", icon: Settings, labelKey: "settings" },
] as const;

/**
 * Settings pages that live under another settings page.
 *
 * The routes are flat — `/settings/caldav`, not `/settings/calendar/caldav` —
 * so the parent cannot be derived from the URL, and the back control in
 * `settings/layout.tsx` sent every sub-page to the settings root. Reaching
 * CalDAV means going Settings -> Calendar -> CalDAV, and coming back landed
 * two levels up, so the way back in had to be walked again.
 *
 * Declared rather than inferred, because the nesting is a fact about the
 * navigation and not about the paths. `/settings/calendar` is the only page
 * with children today; it links to all three of these.
 */
export const SETTINGS_PARENT_PATHS: Record<string, string> = {
  "/settings/caldav": "/settings/calendar",
  "/settings/ics": "/settings/calendar",
  "/settings/google": "/settings/calendar",
};

/** Where the back control on a settings sub-page should go. */
export function settingsBackHref(pathname: string): string {
  return SETTINGS_PARENT_PATHS[pathname] ?? "/settings";
}
