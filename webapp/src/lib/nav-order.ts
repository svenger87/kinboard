/**
 * Per-device bottom-nav ordering. localStorage-backed so each device
 * (kitchen kiosk, parent's phone, kid's tablet) can pick its own
 * primary surfaces without affecting the other devices in the family.
 *
 * Storage shape: a JSON array of hrefs in the user's preferred order.
 * Items not present in the saved order fall through to their default
 * NAV_ITEMS position — so newly-enabled plugins or freshly-shipped
 * surfaces show up automatically without forcing the user back into
 * /settings/navigation.
 */

const KEY = "kinboard.nav-order";
const CHANGE_EVENT = "kinboard:nav-order-changed";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function getNavOrder(): readonly string[] | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return null;
  }
}

export function setNavOrder(hrefs: readonly string[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(hrefs));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* noop — quota exceeded etc. */
  }
}

export function clearNavOrder(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* noop */
  }
}

/**
 * Apply a saved order to a list of nav items. Items in `order` come
 * first in the saved sequence; items not in `order` (newly added or
 * newly visible) keep their default relative position and append.
 */
export function applyNavOrder<T extends { href: string }>(
  items: ReadonlyArray<T>,
  order: readonly string[] | null,
): T[] {
  if (!order || order.length === 0) return [...items];
  const byHref = new Map(items.map((i) => [i.href, i]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const href of order) {
    const item = byHref.get(href);
    if (item && !seen.has(href)) {
      ordered.push(item);
      seen.add(href);
    }
  }
  for (const item of items) {
    if (!seen.has(item.href)) ordered.push(item);
  }
  return ordered;
}

export const NAV_ORDER_CHANGE_EVENT = CHANGE_EVENT;
