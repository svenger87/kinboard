/**
 * What an assistant may know about the family's cars — `GET /vehicles`.
 *
 * Both drivers (Tesla and the generic EV) read their car from Home Assistant:
 * the vehicle row names one entity per slot, and the cards fetch those states
 * through the session HA proxy and resolve them with `readVehicle`. This does
 * the same server-side — `getHaStates` with the family's own token, then the
 * same `readVehicle` — so the assistant and the card cannot disagree about
 * what "unknown" or "Charging" means.
 *
 * Location is never part of the answer. A vehicle config may name a
 * `device_tracker` (`location`), and the Tesla integration's `state` entity
 * reports `home`/`driving` — both are presence data (RFC-002), which does not
 * leave the household on an assistant token whatever the config says. So the
 * config is stripped of those keys *before* anything is fetched (the tracker
 * is never even asked for), and the answer is built from an explicit list of
 * fields below rather than by spreading anything.
 *
 * Every vehicle fails on its own: Home Assistant not connected, unreachable,
 * or not reporting a car's entities makes *that* car `available: false` with
 * a reason, and the call itself still succeeds.
 */

import { readVehicle, vehicleEntityIds, type VehicleEntityConfig } from "@/plugins/vehicles/readings";
import { readState, type HaEntityLike, type Reading } from "@/plugins/vehicles/entity-read";
import type { HaState } from "@/lib/home/ha-client";
import { HomeUnavailable } from "@/lib/home/errors";

export const SUPPORTED_VENDORS = ["tesla", "generic-ev"] as const;

export interface VehicleRow {
  id: string;
  family_id: string;
  vendor: string;
  nickname: string;
  config: unknown;
}

export type VehicleUnavailableReason =
  | "not_configured"
  | "unsupported_vendor"
  | "home_assistant_not_connected"
  | "home_assistant_unavailable"
  | "no_readings";

export interface VehicleStatus {
  id: string;
  nickname: string;
  vendor: string;
  available: boolean;
  reason?: VehicleUnavailableReason;
  battery_level_pct: number | null;
  range: number | null;
  range_unit: string | null;
  charging: boolean | null;
  charging_state: string | null;
  plugged_in: boolean | null;
  charge_limit_pct: number | null;
  minutes_to_full: number | null;
  charger_power_kw: number | null;
  inside_temp: number | null;
  inside_temp_unit: string | null;
  outside_temp: number | null;
  outside_temp_unit: string | null;
  locked: boolean | null;
  doors_open: boolean | null;
  windows_open: boolean | null;
  odometer: number | null;
  odometer_unit: string | null;
  observed_at: string | null;
}

/**
 * Config keys never read for an assistant: `location` is a device_tracker,
 * `state` reports home/driving/parked. Presence data (RFC-002) — excluded
 * even when configured. A new location-like key belongs here.
 */
const PRESENCE_KEYS = ["location", "state"] as const satisfies readonly (keyof VehicleEntityConfig)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The row's config as the shared entity map, minus presence keys. Only string
 * values survive; the generic driver's legacy `range` key is read as
 * `battery_range`, as the card does.
 */
export function vehicleConfigForAssistant(config: unknown): VehicleEntityConfig {
  if (!isPlainObject(config)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  if (!out.battery_range && out.range) out.battery_range = out.range;
  delete out.range;
  for (const key of PRESENCE_KEYS) delete out[key];
  return out as VehicleEntityConfig;
}

/** The entity ids an assistant's read may ask Home Assistant for. */
export function assistantEntityIds(config: unknown): string[] {
  return vehicleEntityIds(vehicleConfigForAssistant(config));
}

/** A finite number, or null. `parseFloat("Infinity")` is a number too. */
function finite(reading: Reading | null): number | null {
  return reading && Number.isFinite(reading.value) ? reading.value : null;
}

function unitOf(reading: Reading | null): string | null {
  return finite(reading) === null ? null : reading!.unit;
}

/** A percentage: the unit must be % or absent, otherwise it is not a percentage. */
function percent(reading: Reading | null): number | null {
  const value = finite(reading);
  if (value === null) return null;
  return reading!.unit === null || reading!.unit === "%" ? value : null;
}

/** Charging power in kW: W is converted, kW or no unit kept, anything else (A, V) refused. */
function kilowatts(reading: Reading | null): number | null {
  const value = finite(reading);
  if (value === null) return null;
  const unit = reading!.unit?.toLowerCase() ?? null;
  if (unit === null || unit === "kw") return value;
  if (unit === "w") return value / 1000;
  return null;
}

function toEntity(state: HaState): HaEntityLike {
  const attr = state.attributes;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    state: state.state,
    attributes: {
      device_class: str(attr.device_class),
      unit_of_measurement: str(attr.unit_of_measurement),
    },
  };
}

function blank(row: VehicleRow): VehicleStatus {
  return {
    id: row.id,
    nickname: row.nickname,
    vendor: row.vendor,
    available: false,
    battery_level_pct: null,
    range: null,
    range_unit: null,
    charging: null,
    charging_state: null,
    plugged_in: null,
    charge_limit_pct: null,
    minutes_to_full: null,
    charger_power_kw: null,
    inside_temp: null,
    inside_temp_unit: null,
    outside_temp: null,
    outside_temp_unit: null,
    locked: null,
    doors_open: null,
    windows_open: null,
    odometer: null,
    odometer_unit: null,
    observed_at: null,
  };
}

export function unavailableVehicle(row: VehicleRow, reason: VehicleUnavailableReason): VehicleStatus {
  return { ...blank(row), reason };
}

/** Why a row cannot be read at all, before Home Assistant is asked. */
export function vehicleBlocker(row: VehicleRow): VehicleUnavailableReason | null {
  if (!(SUPPORTED_VENDORS as readonly string[]).includes(row.vendor)) return "unsupported_vendor";
  if (!vehicleConfigForAssistant(row.config).battery_level) return "not_configured";
  return null;
}

/**
 * One vehicle from its row and the states Home Assistant reported. Pure:
 * `now` is only for the charge ETA, which may count down to a timestamp.
 */
export function vehicleStatus(
  row: VehicleRow,
  states: ReadonlyMap<string, HaState>,
  now: number = Date.now(),
): VehicleStatus {
  const blocker = vehicleBlocker(row);
  if (blocker) return unavailableVehicle(row, blocker);

  const config = vehicleConfigForAssistant(row.config);
  const entities = new Map<string, HaEntityLike>();
  for (const id of vehicleEntityIds(config)) {
    const state = states.get(id);
    if (state) entities.set(id, toEntity(state));
  }
  const r = readVehicle(config, entities, now);

  const power = kilowatts(r.power);
  const chargingKnown = r.chargingState !== null || power !== null;
  const charging = chargingKnown ? r.charging : null;

  const out: VehicleStatus = {
    ...blank(row),
    battery_level_pct: percent(r.battery),
    range: finite(r.range),
    range_unit: unitOf(r.range),
    charging,
    charging_state: r.chargingState,
    // The shared resolver says false for a configured-but-silent cable sensor;
    // an assistant must not say "unplugged" when there is no reading.
    plugged_in: readState(config.plugged_in ? entities.get(config.plugged_in) : undefined) === null ? null : r.pluggedIn,
    charge_limit_pct: percent(r.chargeLimit),
    // 0 means "unknown or done" in the shared resolver; only a running charge
    // has a time to full.
    minutes_to_full: charging && r.minutesToFull > 0 ? r.minutesToFull : null,
    charger_power_kw: power,
    inside_temp: finite(r.insideTemp),
    inside_temp_unit: unitOf(r.insideTemp),
    outside_temp: finite(r.outsideTemp),
    outside_temp_unit: unitOf(r.outsideTemp),
    locked: r.locked,
    doors_open: r.doorsOpen,
    windows_open: r.windowsOpen,
    odometer: finite(r.odometer),
    odometer_unit: unitOf(r.odometer),
    observed_at: observedAt(config, states),
  };

  const anything = Object.entries(out).some(
    ([key, value]) => !["id", "nickname", "vendor", "available", "observed_at"].includes(key) && value !== null,
  );
  if (!anything) return { ...out, available: false, reason: "no_readings", observed_at: null };
  return { ...out, available: true };
}

/** The battery entity's last update — what "Ladestand" is as of — else the newest of the rest. */
function observedAt(config: VehicleEntityConfig, states: ReadonlyMap<string, HaState>): string | null {
  const valid = (s: string | undefined) => (s && !Number.isNaN(Date.parse(s)) ? s : null);
  const battery = config.battery_level ? valid(states.get(config.battery_level)?.last_updated) : null;
  if (battery) return new Date(battery).toISOString();
  let newest: number | null = null;
  for (const id of vehicleEntityIds(config)) {
    const at = valid(states.get(id)?.last_updated);
    if (at && (newest === null || Date.parse(at) > newest)) newest = Date.parse(at);
  }
  return newest === null ? null : new Date(newest).toISOString();
}

export interface VehicleDeps {
  /** The family's vehicle rows, in display order. */
  loadVehicles: (familyId: string) => Promise<VehicleRow[]>;
  getHaStates: (familyId: string, entityIds: readonly string[]) => Promise<Map<string, HaState>>;
}

/**
 * Every vehicle of the family, one Home Assistant request for all of them.
 * Never throws for Home Assistant; a database failure does throw (the route
 * answers 500 — there is nothing per-vehicle to report without the rows).
 */
export async function listVehicleStatuses(
  familyId: string,
  deps: VehicleDeps,
  now: number = Date.now(),
): Promise<{ vehicles: VehicleStatus[]; fetched_at: string }> {
  // The filter is the loader's job; this is the second lock on the door.
  const rows = (await deps.loadVehicles(familyId)).filter((row) => row.family_id === familyId);
  const fetchedAt = new Date(now).toISOString();

  const readable = rows.filter((row) => vehicleBlocker(row) === null);
  const ids = Array.from(new Set(readable.flatMap((row) => assistantEntityIds(row.config))));

  let states: Map<string, HaState> | null = null;
  let failure: VehicleUnavailableReason | null = null;
  if (ids.length > 0) {
    try {
      states = await deps.getHaStates(familyId, ids);
    } catch (err) {
      failure = err instanceof HomeUnavailable ? "home_assistant_not_connected" : "home_assistant_unavailable";
    }
  }

  const vehicles = rows.map((row) => {
    const blocker = vehicleBlocker(row);
    if (blocker) return unavailableVehicle(row, blocker);
    if (failure || !states) return unavailableVehicle(row, failure ?? "home_assistant_unavailable");
    return vehicleStatus(row, states, now);
  });
  return { vehicles, fetched_at: fetchedAt };
}
