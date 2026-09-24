const KEY = "kinboard.hidden-nav-items";
const SETTINGS_ICON_KEY = "kinboard.settings-icon-only";
export const NAV_VISIBILITY_EVENT = "kinboard:nav-visibility-change";

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
