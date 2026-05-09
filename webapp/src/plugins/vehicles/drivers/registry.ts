import type { VehicleDriver } from "./types";
import { genericEvDriver } from "./generic-ev";

/**
 * The canonical list of vehicle drivers. The Tesla driver is added in
 * a follow-up commit (driver extraction from app/tesla/page.tsx is a
 * separate, larger task). Until then, vehicles with vendor='tesla' fall
 * through to `getDriver()` returning undefined; the /vehicles page
 * handles that case with an "unknown vendor" empty state.
 */
// Driver configs are intentionally heterogeneous; each driver owns its own
// TConfig; callers go through `getDriver()` which preserves specificity.
// Each driver owns its own TConfig; we erase it to unknown here so callers
// that iterate the array (e.g. vendor picker) don't need to know the specifics.
// The cast is safe: callers that need the typed config go through getDriver().
export const VEHICLE_DRIVERS: VehicleDriver<unknown>[] = [
  genericEvDriver as VehicleDriver<unknown>,
];

export function getDriver(vendor: string): VehicleDriver | undefined {
  return VEHICLE_DRIVERS.find((d) => d.id === vendor);
}
