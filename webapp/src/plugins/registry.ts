import type { SurfacePlugin } from "./types";
import { vehiclesPlugin } from "./vehicles";
import { energyPlugin } from "./energy";
import { camerasPlugin } from "./cameras";

/**
 * The single registration point for surface plugins. Order here is the
 * order plugins appear in the nav and on the settings landing page.
 *
 * Adding a new plugin = (1) build it under `webapp/src/plugins/<id>/`,
 * (2) import its manifest here. No other file touches required.
 */
export const PLUGINS: readonly SurfacePlugin[] = [
  vehiclesPlugin,
  energyPlugin,
  camerasPlugin,
];

/** Look up by id; returns undefined if not registered. */
export function getPlugin(id: string): SurfacePlugin | undefined {
  return PLUGINS.find((p) => p.id === id);
}
