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
  Settings,
} from "lucide-react";

/** Paths where the bottom navigation should not be rendered */
export const NO_NAV_PATHS = ["/join", "/einkaufen"] as const;

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
  { href: "/settings", icon: Settings, labelKey: "settings" },
] as const;
