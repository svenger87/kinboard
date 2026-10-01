const KEY = "kinboard.hidden-nav-items";
const SETTINGS_ICON_KEY = "kinboard.settings-icon-only";
export const NAV_VISIBILITY_EVENT = "kinboard:nav-visibility-change";

/**
 * Never hideable. A device with no way Home and no way into Settings cannot
 * be recovered from the UI at all -- the only way back is clearing site data,
 * which on a wall panel means finding a keyboard.
 */
export const ALWAYS_SHOWN_NAV_ITEMS: readonly string[] = ["/", "/settings"];

/**
 * Hideable only on a device marked as a kiosk under Settings → Devices. The
 * lock exists so a family member cannot accidentally hide the surfaces
 * everyone else relies on. A kiosk is the opposite case: it is curated once by
 * whoever mounted it, and a wall display that only ever shows the gate has no
 * use for a shopping list it cannot be shopped from.
 */
export const KIOSK_HIDEABLE_NAV_ITEMS: readonly string[] = ["/calendar", "/shopping"];

/** Whether this device may switch `href` off under Settings → Navigation. */
export function canHideNavItem(href: string, isKiosk: boolean): boolean {
  if (ALWAYS_SHOWN_NAV_ITEMS.includes(href)) return false;
  if (KIOSK_HIDEABLE_NAV_ITEMS.includes(href)) return isKiosk;
  return true;
}

/**
 * The stored hidden list as it applies to this device: anything the device
 * may not hide is left out.
 *
 * The list lives in this browser's storage and outlives the kiosk flag. Without
 * this, Calendar switched off while a device was a kiosk stayed hidden after
 * kiosk mode was turned off, with its switch locked in the off position and
 * the hint beneath it saying Calendar remains visible. The stored entry is
 * kept, so it applies again if the device becomes a kiosk again.
 */
export function effectiveHiddenNavItems(stored: readonly string[], isKiosk: boolean): readonly string[] {
  return stored.filter((href) => canHideNavItem(href, isKiosk));
}

export function getHiddenNavItems(): readonly string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function setHiddenNavItems(items: readonly string[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(NAV_VISIBILITY_EVENT));
}

export function getSettingsIconOnly(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(SETTINGS_ICON_KEY) === "true";
}

export function setSettingsIconOnly(value: boolean) {
  window.localStorage.setItem(SETTINGS_ICON_KEY, String(value));
  window.dispatchEvent(new Event(NAV_VISIBILITY_EVENT));
}
