import type { VehicleDriver } from "./types";
import { teslaDriver } from "./tesla";
import { genericEvDriver } from "./generic-ev";

// Driver configs are intentionally heterogeneous; each driver owns its own
// TConfig; callers go through `getDriver()` which preserves specificity.
// Each driver owns its own TConfig; we erase it to unknown here so callers
// that iterate the array (e.g. vendor picker) don't need to know the specifics.
// The cast is safe: callers that need the typed config go through getDriver().
export const VEHICLE_DRIVERS: VehicleDriver<unknown>[] = [
  teslaDriver as VehicleDriver<unknown>,
  genericEvDriver as VehicleDriver<unknown>,
];

export function getDriver(vendor: string): VehicleDriver | undefined {
  return VEHICLE_DRIVERS.find((d) => d.id === vendor);
}
