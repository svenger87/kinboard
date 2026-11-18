/**
 * Which saved layout a screen draws. A device's own layout wins, then (for
 * kiosks only) the family default for the orientation it currently has; a
 * layout drawn for the other orientation gives way, so a turned screen picks
 * the matching one and goes back when turned again. A screen too small for a
 * grid gets null, which means the built-in arrangement.
 */
import { gridFor, orientationOf } from "./grid";
import type { Layout, LayoutDefaults } from "./types";

export function resolveLayout(args: {
  device: { id: string; is_kiosk: boolean; layout_id: string | null } | null;
  layouts: Layout[];
  defaults: LayoutDefaults;
  viewport: { width: number; height: number };
}): Layout | null {
  const { device, layouts, defaults, viewport } = args;
  if (!gridFor(viewport.width, viewport.height)) return null;
  const orientation = orientationOf(viewport.width, viewport.height);
  const usable = (id: string | null | undefined): Layout | null => {
    if (!id) return null;
    const l = layouts.find((x) => x.id === id);
    return l && orientationOf(l.width, l.height) === orientation ? l : null;
  };
  const own = usable(device?.layout_id);
  if (own) return own;
  return device?.is_kiosk ? usable(defaults[orientation]) : null;
}
