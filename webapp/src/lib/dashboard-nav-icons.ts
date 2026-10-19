/**
 * The icons a Home Assistant dashboard's navigation entry can have: Lucide
 * icons, like every other entry, from a set chosen for what a household's
 * dashboards are about (energy, climate, light, security, rooms, the
 * garden). Stored by these ids in the dashboard's `nav_icon`; anything else
 * reads as none, which draws the dashboard icon.
 *
 * The components live in components/dashboard-nav-icon.tsx; this list has no
 * React in it, so the settings route can check a saved value with it.
 */
export const DASHBOARD_NAV_ICON_IDS = [
  "dashboard",
  "zap",
  "sun",
  "battery",
  "battery-charging",
  "plug",
  "gauge",
  "chart",
  "thermometer",
  "flame",
  "snowflake",
  "droplets",
  "wind",
  "cloud",
  "lightbulb",
  "lamp",
  "tv",
  "music",
  "camera",
  "shield",
  "lock",
  "door",
  "car",
  "leaf",
  "flower",
  "trees",
  "house",
  "sofa",
  "bed",
  "kitchen",
  "laundry",
  "baby",
  "dog",
  "cat",
  "wifi",
] as const;

export type DashboardNavIconId = (typeof DASHBOARD_NAV_ICON_IDS)[number];

export function isDashboardNavIcon(value: unknown): value is DashboardNavIconId {
  return typeof value === "string" && (DASHBOARD_NAV_ICON_IDS as readonly string[]).includes(value);
}
