/**
 * What `GET /api/integration/v1/energy/current` may read from Home Assistant.
 *
 * The client names nothing: entity IDs come only from the family's energy
 * settings, and only sensors. That is what keeps an `energy:read` token from
 * becoming a way to read arbitrary Home Assistant entities.
 */

export interface SolarConfig {
  solar_power?: string | null;
  solar_energy_today?: string | null;
}

const SENSOR_ID = /^sensor\.[a-z0-9_]+$/;

export function solarSensorIds(config: SolarConfig): { power: string | null; energyToday: string | null } {
  const ok = (id: unknown): string | null => (typeof id === "string" && SENSOR_ID.test(id) ? id : null);
  return { power: ok(config.solar_power), energyToday: ok(config.solar_energy_today) };
}

/** The power sensors (W) of Kinboard's energy settings, in the order the settings show them. */
export const ENERGY_POWER_FIELDS = [
  "solar_power",
  "battery_power",
  "battery_charge_power",
  "battery_discharge_power",
  "grid_power",
  "grid_import_power",
  "grid_export_power",
  "grid_to_battery_power",
  "home_consumption",
] as const;

/** The energy-today sensors (kWh) of Kinboard's energy settings. */
export const ENERGY_TODAY_FIELDS = [
  "solar_energy_today",
  "battery_energy_in",
  "battery_energy_out",
  "grid_import",
  "grid_export",
  "grid_to_battery_energy",
] as const;

export type EnergyPowerField = (typeof ENERGY_POWER_FIELDS)[number];
export type EnergyTodayField = (typeof ENERGY_TODAY_FIELDS)[number];
export type EnergyField = EnergyPowerField | EnergyTodayField | "battery_soc";

/** Every sensor slot of the energy settings. Nothing else is ever read. */
export const ENERGY_FIELDS: readonly EnergyField[] = [...ENERGY_POWER_FIELDS, ...ENERGY_TODAY_FIELDS, "battery_soc"];

export type EnergySensorConfig = Partial<Record<EnergyField, string | null>>;

/**
 * The configured slot → entity ID, keeping only `sensor.*` IDs. A slot set to
 * anything else (a lock, a path, a non-string) is dropped as if unset.
 */
export function energySensorIds(config: EnergySensorConfig): Map<EnergyField, string> {
  const ids = new Map<EnergyField, string>();
  for (const field of ENERGY_FIELDS) {
    const id: unknown = config[field];
    if (typeof id === "string" && SENSOR_ID.test(id)) ids.set(field, id);
  }
  return ids;
}

/** The part of a Home Assistant state an energy reading needs. */
export interface EnergyState {
  state: string;
  attributes: Record<string, unknown>;
  last_updated?: string;
}

export interface EnergyReading {
  value: number | null;
  unit: string | null;
  observed_at: string | null;
}

/** A state as a reading; `unavailable`, `unknown` or anything non-numeric is value null. */
export function toEnergyReading(state: EnergyState): EnergyReading {
  const raw = state.state.trim();
  const value = raw === "" ? NaN : Number(raw);
  const unit = state.attributes.unit_of_measurement;
  return {
    value: Number.isFinite(value) ? value : null,
    unit: typeof unit === "string" ? unit : null,
    observed_at: state.last_updated ?? null,
  };
}

export interface EnergyStatus {
  /** Compatibility (the solar-only response): the same reading plus its entity ID. */
  solar_power: (EnergyReading & { entity_id: string }) | null;
  solar_energy_today: (EnergyReading & { entity_id: string }) | null;
  power: Record<EnergyPowerField, EnergyReading | null>;
  energy_today: Record<EnergyTodayField, EnergyReading | null>;
  battery_soc: EnergyReading | null;
  fetched_at: string;
}

/**
 * The response of `/energy/current` from the configured IDs and the states
 * Home Assistant returned. Only a state whose ID is configured for a slot is
 * looked at, so an extra entity in `states` can never appear. A slot that is
 * unconfigured, or whose sensor Home Assistant does not report, is null.
 */
export function buildEnergyStatus(
  ids: ReadonlyMap<EnergyField, string>,
  states: ReadonlyMap<string, EnergyState>,
  now: Date,
): EnergyStatus {
  const reading = (field: EnergyField): EnergyReading | null => {
    const id = ids.get(field);
    const state = id === undefined ? undefined : states.get(id);
    return state ? toEnergyReading(state) : null;
  };
  const withId = (field: "solar_power" | "solar_energy_today") => {
    const r = reading(field);
    return r ? { value: r.value, unit: r.unit, entity_id: ids.get(field)!, observed_at: r.observed_at } : null;
  };
  return {
    solar_power: withId("solar_power"),
    solar_energy_today: withId("solar_energy_today"),
    power: Object.fromEntries(ENERGY_POWER_FIELDS.map((f) => [f, reading(f)])) as EnergyStatus["power"],
    energy_today: Object.fromEntries(ENERGY_TODAY_FIELDS.map((f) => [f, reading(f)])) as EnergyStatus["energy_today"],
    battery_soc: reading("battery_soc"),
    fetched_at: now.toISOString(),
  };
}

/** A Home Assistant base URL we will send the token to, or null. */
export function homeAssistantBase(raw: string): URL | null {
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    return null;
  }
  return base;
}
