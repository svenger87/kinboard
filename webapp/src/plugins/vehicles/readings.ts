/**
 * One way to read a car, for every driver.
 *
 * Both Tesla cards used to resolve their own entities inline — the detail card
 * and the dashboard widget each had a copy of `getVal`, `getState` and the
 * charging test. They drifted, which is how the charge-ETA bug came to exist in
 * one of them and not the other, and it is why the generic driver ended up with
 * a third, thinner reading of the same ideas.
 *
 * The config keys below are deliberately the Tesla driver's, because every
 * other vendor's integration exposes the same handful of things under different
 * entity names. A driver's job is to say which entity fills which slot; reading
 * them is not driver-specific work.
 */

import {
  readNumber,
  readState,
  isCharging as stateIsCharging,
  isPluggedIn as stateIsPluggedIn,
  isLocked,
  isOpen,
  isOnline as stateIsOnline,
  type HaEntityLike,
  type Reading,
} from "./entity-read";
import { minutesToFullCharge } from "./charge-eta";

/** Entity ids, one per thing a car can tell you. All optional. */
export interface VehicleEntityConfig {
  battery_level?: string;
  battery_range?: string;
  charging_rate?: string;
  charger_power?: string;
  charging_state?: string;
  plugged_in?: string;
  charge_limit?: string;
  time_to_full_charge?: string;
  charge_energy_added?: string;
  inside_temperature?: string;
  outside_temperature?: string;
  climate_state?: string;
  locked?: string;
  windows?: string;
  doors?: string;
  trunk?: string;
  frunk?: string;
  tire_pressure_fl?: string;
  tire_pressure_fr?: string;
  tire_pressure_rl?: string;
  tire_pressure_rr?: string;
  odometer?: string;
  location?: string;
  state?: string;
}

/** Every key above, in one place, so the fetch list cannot drift from the reads. */
export const VEHICLE_ENTITY_KEYS = [
  "battery_level", "battery_range", "charging_rate", "charger_power",
  "charging_state", "plugged_in", "charge_limit", "time_to_full_charge",
  "charge_energy_added", "inside_temperature", "outside_temperature",
  "climate_state", "locked", "windows", "doors", "trunk", "frunk",
  "tire_pressure_fl", "tire_pressure_fr", "tire_pressure_rl", "tire_pressure_rr",
  "odometer", "location", "state",
] as const satisfies readonly (keyof VehicleEntityConfig)[];

/** The entity ids this config actually names, deduplicated. */
export function vehicleEntityIds(config: VehicleEntityConfig | undefined): string[] {
  if (!config) return [];
  const ids = VEHICLE_ENTITY_KEYS.map((k) => config[k]).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return Array.from(new Set(ids));
}

export interface VehicleReadings {
  /** Numbers, each carrying the unit its entity reported. `null` = no reading. */
  battery: Reading | null;
  range: Reading | null;
  /** Charging power — `charging_rate` if set, otherwise `charger_power`. */
  power: Reading | null;
  chargeLimit: Reading | null;
  energyAdded: Reading | null;
  insideTemp: Reading | null;
  outsideTemp: Reading | null;
  odometer: Reading | null;
  tyres: {
    fl: Reading | null;
    fr: Reading | null;
    rl: Reading | null;
    rr: Reading | null;
  };

  /** Minutes until the charge completes; 0 when unknown. See charge-eta.ts. */
  minutesToFull: number;

  /** Booleans, `null` when the entity is absent or unreadable. */
  charging: boolean;
  pluggedIn: boolean | null;
  locked: boolean | null;
  doorsOpen: boolean | null;
  windowsOpen: boolean | null;
  trunkOpen: boolean | null;
  frunkOpen: boolean | null;
  online: boolean | null;

  /** Raw lowercased states, for drivers that want to label them. */
  chargingState: string | null;
  climateState: string | null;
  locationState: string | null;
  vehicleState: string | null;
}

type EntityLookup = {
  get(id: string): HaEntityLike | undefined;
};

/**
 * Resolve a config plus a bag of entities into everything the cards render.
 *
 * `now` is injectable for the charge ETA, which counts down to a timestamp.
 */
export function readVehicle(
  config: VehicleEntityConfig | undefined,
  entities: EntityLookup,
  now: number = Date.now(),
): VehicleReadings {
  const at = (id: string | undefined): HaEntityLike | undefined =>
    id ? entities.get(id) : undefined;
  const num = (id: string | undefined) => readNumber(at(id));

  // charging_rate is the Tesla driver's original key; charger_power is what the
  // settings form offers as the alternative. Either fills the same slot.
  const power = num(config?.charging_rate) ?? num(config?.charger_power);
  const chargingState = readState(at(config?.charging_state));

  return {
    battery: num(config?.battery_level),
    range: num(config?.battery_range),
    power,
    chargeLimit: num(config?.charge_limit),
    energyAdded: num(config?.charge_energy_added),
    insideTemp: num(config?.inside_temperature),
    outsideTemp: num(config?.outside_temperature),
    odometer: num(config?.odometer),
    tyres: {
      fl: num(config?.tire_pressure_fl),
      fr: num(config?.tire_pressure_fr),
      rl: num(config?.tire_pressure_rl),
      rr: num(config?.tire_pressure_rr),
    },

    minutesToFull: minutesToFullCharge(at(config?.time_to_full_charge), now),

    charging: stateIsCharging(chargingState, power?.value ?? null),
    pluggedIn: config?.plugged_in
      ? stateIsPluggedIn(readState(at(config.plugged_in)))
      : null,
    locked: isLocked(at(config?.locked)),
    doorsOpen: isOpen(at(config?.doors)),
    windowsOpen: isOpen(at(config?.windows)),
    trunkOpen: isOpen(at(config?.trunk)),
    frunkOpen: isOpen(at(config?.frunk)),
    online: stateIsOnline(readState(at(config?.state))),

    chargingState,
    climateState: readState(at(config?.climate_state)),
    locationState: readState(at(config?.location)),
    vehicleState: readState(at(config?.state)),
  };
}
