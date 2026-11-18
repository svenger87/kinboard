/**
 * Which screens show which layout, as far as the settings can tell: each
 * screen's layout is resolved (resolveLayout) for the size it last reported.
 * A screen that reported no size counts only for its own layout, as
 * assigned; it is not counted for a default, since which one applies
 * depends on how it is turned.
 */
import { resolveLayout } from "./resolve";
import type { Layout, LayoutDefaults } from "./types";

/** The parts of a device the resolution needs. */
export interface UsageDevice {
  id: string;
  name: string;
  is_kiosk: boolean;
  layout_id: string | null;
  screen: { viewportWidth: number; viewportHeight: number } | null;
}

export interface LayoutUse<D extends UsageDevice = UsageDevice> {
  /** Screens showing it as their own layout. */
  assigned: D[];
  /** Wall screens showing it as the default for the way they are turned. */
  viaDefault: D[];
}

const viewportOf = (d: UsageDevice) =>
  d.screen ? { width: Math.round(d.screen.viewportWidth), height: Math.round(d.screen.viewportHeight) } : null;

/** The layout a device shows at its reported size; undefined when it reported none. */
export function runningLayout(device: UsageDevice, layouts: Layout[], defaults: LayoutDefaults): Layout | null | undefined {
  const viewport = viewportOf(device);
  if (!viewport) return undefined;
  return resolveLayout({ device, layouts, defaults, viewport });
}

/** For every layout of the family, the screens showing it (empty lists for one nobody sees). */
export function layoutUsage<D extends UsageDevice>(devices: D[], layouts: Layout[], defaults: LayoutDefaults): Map<string, LayoutUse<D>> {
  const usage = new Map<string, LayoutUse<D>>(layouts.map((l) => [l.id, { assigned: [], viaDefault: [] }]));
  for (const d of devices) {
    const running = runningLayout(d, layouts, defaults);
    if (running === undefined) {
      if (d.layout_id) usage.get(d.layout_id)?.assigned.push(d);
      continue;
    }
    if (!running) continue;
    const use = usage.get(running.id);
    if (!use) continue;
    if (running.id === d.layout_id) use.assigned.push(d);
    else use.viaDefault.push(d);
  }
  return usage;
}

/**
 * What a screen showing `layoutId` shows once that layout is deleted: another
 * layout (the default for the way it is turned), or null for the built-in
 * screensaver. A screen with no reported size is taken as turned the way the
 * deleted layout is.
 */
export function fallbackAfterDelete(device: UsageDevice, layoutId: string, layouts: Layout[], defaults: LayoutDefaults): Layout | null {
  const gone = layouts.find((l) => l.id === layoutId);
  const rest = layouts.filter((l) => l.id !== layoutId);
  const cleared: LayoutDefaults = {
    portrait: defaults.portrait === layoutId ? null : defaults.portrait,
    landscape: defaults.landscape === layoutId ? null : defaults.landscape,
  };
  const left = { ...device, layout_id: device.layout_id === layoutId ? null : device.layout_id };
  const viewport = viewportOf(device) ?? (gone ? { width: gone.width, height: gone.height } : null);
  if (!viewport) return null;
  return resolveLayout({ device: left, layouts: rest, defaults: cleared, viewport });
}
