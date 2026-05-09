import { genericHaEnergyDriver } from "./generic-ha-energy";
import type { EnergyDriver } from "./types";

export const ENERGY_DRIVERS: readonly EnergyDriver<any>[] = [
  genericHaEnergyDriver,
];

export function getDriver(id: string): EnergyDriver<any> | undefined {
  return ENERGY_DRIVERS.find((d) => d.id === id);
}
