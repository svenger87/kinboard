import { test, expect } from "@playwright/test";
import {
  assistantEntityIds,
  listVehicleStatuses,
  vehicleConfigForAssistant,
  vehicleStatus,
  type VehicleDeps,
  type VehicleRow,
} from "../src/lib/vehicles/status";
import type { HaState } from "../src/lib/home/ha-client";
import { HomeUnavailable, HomeUpstreamError } from "../src/lib/home/errors";

/**
 * `GET /vehicles` (vehicles:read): the family's cars as an assistant sees
 * them. The mapping is pure and the route's Home Assistant access is
 * injected, so every rule — units, missing entities, presence data never
 * leaving, family scoping, Home Assistant failing soft — is checked against
 * stubs that count what they were asked.
 */

const FAMILY = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const NOW = Date.parse("2026-10-01T12:00:00Z");

const TESLA_CONFIG = {
  battery_level: "sensor.model_y_battery",
  battery_range: "sensor.model_y_range",
  charging_state: "sensor.model_y_charging",
  plugged_in: "binary_sensor.model_y_charge_cable",
  charge_limit: "number.model_y_charge_limit",
  time_to_full_charge: "sensor.model_y_time_to_full",
  charger_power: "sensor.model_y_charger_power",
  inside_temperature: "sensor.model_y_inside",
  outside_temperature: "sensor.model_y_outside",
  locked: "lock.model_y_doors",
  doors: "binary_sensor.model_y_doors",
  windows: "binary_sensor.model_y_windows",
  odometer: "sensor.model_y_odometer",
  location: "device_tracker.model_y_location",
  state: "sensor.model_y_state",
  show_on_dashboard: true,
  cost_per_kwh: 0.3,
};

const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}, last_updated?: string): HaState =>
  (last_updated ? { entity_id, state, attributes, last_updated } : { entity_id, state, attributes });

const TESLA_STATES: HaState[] = [
  st("sensor.model_y_battery", "57", { unit_of_measurement: "%" }, "2026-10-01T11:56:00+00:00"),
  st("sensor.model_y_range", "295.94", { unit_of_measurement: "km" }, "2026-10-01T11:57:00+00:00"),
  st("sensor.model_y_charging", "Charging"),
  st("binary_sensor.model_y_charge_cable", "on"),
  st("number.model_y_charge_limit", "80", { unit_of_measurement: "%" }),
  st("sensor.model_y_time_to_full", "2026-10-01T13:48:00+00:00", { device_class: "timestamp" }),
  st("sensor.model_y_charger_power", "11000", { unit_of_measurement: "W" }),
  st("sensor.model_y_inside", "21.5", { unit_of_measurement: "°C" }),
  st("sensor.model_y_outside", "unavailable", { unit_of_measurement: "°C" }),
  st("lock.model_y_doors", "locked"),
  st("binary_sensor.model_y_doors", "off", { device_class: "door" }),
  st("binary_sensor.model_y_windows", "on", { device_class: "window" }),
  st("sensor.model_y_odometer", "12345.6", { unit_of_measurement: "mi" }),
  st("device_tracker.model_y_location", "home", { latitude: 52.1, longitude: 7.3, gps_accuracy: 5, address: "Hauptstr. 1" }),
  st("sensor.model_y_state", "driving"),
];

const row = (over: Partial<VehicleRow> = {}): VehicleRow => ({
  id: "v-1", family_id: FAMILY, vendor: "tesla", nickname: "Tesla", config: TESLA_CONFIG, ...over,
});

const asMap = (states: HaState[]) => new Map(states.map((s) => [s.entity_id, s]));

function deps(rows: VehicleRow[], ha: (ids: readonly string[]) => Promise<Map<string, HaState>> | Map<string, HaState>) {
  const asked: { loadFor: string[]; haFor: string[]; haIds: (readonly string[])[] } = { loadFor: [], haFor: [], haIds: [] };
  const d: VehicleDeps = {
    loadVehicles: async (familyId) => { asked.loadFor.push(familyId); return rows; },
    getHaStates: async (familyId, ids) => { asked.haFor.push(familyId); asked.haIds.push(ids); return ha(ids); },
  };
  return { d, asked };
}

const PRESENCE = /lat|lon|gps|coord|address|location|zone|position|place|heading|home|driving/i;

test.describe("mapping entity states to fields", () => {
  test("a charging Tesla, with units as reported and W converted to kW", () => {
    const v = vehicleStatus(row(), asMap(TESLA_STATES), NOW);
    expect(v).toMatchObject({
      id: "v-1", nickname: "Tesla", vendor: "tesla", available: true,
      battery_level_pct: 57,
      range: 295.94, range_unit: "km",
      charging: true, charging_state: "charging", plugged_in: true,
      charge_limit_pct: 80,
      minutes_to_full: 108,
      charger_power_kw: 11,
      inside_temp: 21.5, inside_temp_unit: "°C",
      outside_temp: null, outside_temp_unit: null,
      locked: true, doors_open: false, windows_open: true,
      odometer: 12345.6, odometer_unit: "mi",
      observed_at: "2026-10-01T11:56:00.000Z",
    });
    expect(v.reason).toBeUndefined();
  });

  test("missing entities and non-numeric states are null, never 0", () => {
    const states = asMap([
      st("sensor.model_y_battery", "unknown", { unit_of_measurement: "%" }),
      st("sensor.model_y_range", "n/a", { unit_of_measurement: "km" }),
      st("sensor.model_y_inside", "Infinity", { unit_of_measurement: "°C" }),
      st("lock.model_y_doors", "jammed"),
      st("sensor.model_y_odometer", "1000", { unit_of_measurement: "km" }),
    ]);
    const v = vehicleStatus(row(), states, NOW);
    expect(v.available).toBe(true);
    expect(v.battery_level_pct).toBeNull();
    expect(v.range).toBeNull();
    expect(v.range_unit).toBeNull();
    expect(v.inside_temp).toBeNull();
    expect(v.locked).toBeNull();
    expect(v.charging).toBeNull();
    // The cable sensor is configured but silent: no reading, not "unplugged".
    expect(v.plugged_in).toBeNull();
    expect(v.minutes_to_full).toBeNull();
    expect(v.charger_power_kw).toBeNull();
    expect(v.odometer).toBe(1000);
    for (const value of Object.values(v)) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("a percentage in another unit, and power in amps, are refused rather than mislabelled", () => {
    const states = asMap([
      st("sensor.model_y_battery", "57", { unit_of_measurement: "kWh" }),
      st("sensor.model_y_charger_power", "16", { unit_of_measurement: "A" }),
      st("number.model_y_charge_limit", "80"),
    ]);
    const v = vehicleStatus(row(), states, NOW);
    expect(v.battery_level_pct).toBeNull();
    expect(v.charger_power_kw).toBeNull();
    expect(v.charge_limit_pct).toBe(80);
  });

  test("not charging: no time to full, even if the sensor still holds one", () => {
    const states = asMap([
      st("sensor.model_y_battery", "80", { unit_of_measurement: "%" }),
      st("sensor.model_y_charging", "Complete"),
      st("sensor.model_y_time_to_full", "45", { unit_of_measurement: "min" }),
    ]);
    const v = vehicleStatus(row(), states, NOW);
    expect(v.charging).toBe(false);
    expect(v.minutes_to_full).toBeNull();
  });

  test("the generic driver's legacy `range` key is read as the range", () => {
    const generic = row({
      vendor: "generic-ev",
      config: { battery_level: "sensor.bmw_soc", range: "sensor.bmw_range", charging_state: "sensor.bmw_charging" },
    });
    const v = vehicleStatus(generic, asMap([
      st("sensor.bmw_soc", "64.0", { unit_of_measurement: "%" }),
      st("sensor.bmw_range", "310", { unit_of_measurement: "km" }),
      st("sensor.bmw_charging", "NOT_CHARGING"),
    ]), NOW);
    expect(v).toMatchObject({ available: true, battery_level_pct: 64, range: 310, range_unit: "km", charging: false });
  });

  test("not configured and unknown vendors say so without a reading", () => {
    expect(vehicleStatus(row({ config: {} }), new Map(), NOW)).toMatchObject({ available: false, reason: "not_configured" });
    expect(vehicleStatus(row({ config: null }), new Map(), NOW)).toMatchObject({ available: false, reason: "not_configured" });
    expect(vehicleStatus(row({ vendor: "rivian" }), asMap(TESLA_STATES), NOW))
      .toMatchObject({ available: false, reason: "unsupported_vendor", battery_level_pct: null });
  });

  test("configured but Home Assistant reports none of its entities: no_readings", () => {
    expect(vehicleStatus(row(), new Map(), NOW)).toMatchObject({ available: false, reason: "no_readings", observed_at: null });
  });
});

test.describe("location never leaves", () => {
  test("presence keys are stripped before anything is fetched", () => {
    const config = vehicleConfigForAssistant(TESLA_CONFIG);
    expect(config).not.toHaveProperty("location");
    expect(config).not.toHaveProperty("state");
    const ids = assistantEntityIds(TESLA_CONFIG);
    expect(ids).not.toContain("device_tracker.model_y_location");
    expect(ids).not.toContain("sensor.model_y_state");
    expect(ids).toContain("sensor.model_y_battery");
  });

  test("the answer has no location-like key or value, even with a tracker configured and reporting", async () => {
    const { d, asked } = deps([row()], () => asMap(TESLA_STATES));
    const body = await listVehicleStatuses(FAMILY, d, NOW);
    const text = JSON.stringify(body);
    for (const key of Object.keys(body.vehicles[0])) expect(key).not.toMatch(PRESENCE);
    for (const leak of ["52.1", "7.3", "Hauptstr", "device_tracker", "driving", "\"home\""]) expect(text).not.toContain(leak);
    // Home Assistant was never even asked for the tracker or the state sensor.
    expect(asked.haIds.flat()).not.toContain("device_tracker.model_y_location");
    expect(asked.haIds.flat()).not.toContain("sensor.model_y_state");
  });

  test("a tracker configured under a reading slot is still only read as that reading, never as a place", () => {
    // Misconfiguration: the tracker named as the charging sensor. Its state
    // is a zone name; the answer may carry it as charging_state at most, but
    // never coordinates or address attributes.
    const v = vehicleStatus(row({ config: { battery_level: "sensor.model_y_battery", charging_state: "device_tracker.model_y_location" } }),
      asMap(TESLA_STATES), NOW);
    const text = JSON.stringify(v);
    for (const leak of ["52.1", "7.3", "Hauptstr", "latitude", "gps"]) expect(text).not.toContain(leak);
  });
});

test.describe("family scoping", () => {
  test("the loader is asked for the caller's family only, and a foreign row is dropped anyway", async () => {
    const { d, asked } = deps([row(), row({ id: "v-foreign", family_id: OTHER, nickname: "Neighbour" })], () => asMap(TESLA_STATES));
    const body = await listVehicleStatuses(FAMILY, d, NOW);
    expect(asked.loadFor).toEqual([FAMILY]);
    expect(asked.haFor).toEqual([FAMILY]);
    expect(body.vehicles.map((v) => v.id)).toEqual(["v-1"]);
  });

  test("one Home Assistant request for all the family's cars", async () => {
    const second = row({ id: "v-2", vendor: "generic-ev", nickname: "BMW", config: { battery_level: "sensor.bmw_soc" } });
    const { d, asked } = deps([row(), second], () => asMap([...TESLA_STATES, st("sensor.bmw_soc", "40", { unit_of_measurement: "%" })]));
    const body = await listVehicleStatuses(FAMILY, d, NOW);
    expect(asked.haIds).toHaveLength(1);
    expect(body.vehicles.map((v) => [v.id, v.battery_level_pct])).toEqual([["v-1", 57], ["v-2", 40]]);
    expect(body.fetched_at).toBe("2026-10-01T12:00:00.000Z");
  });

  test("no vehicles, or none configured: Home Assistant is not asked", async () => {
    const empty = deps([], () => { throw new Error("must not be called"); });
    expect(await listVehicleStatuses(FAMILY, empty.d, NOW)).toEqual({ vehicles: [], fetched_at: "2026-10-01T12:00:00.000Z" });
    const unconfigured = deps([row({ config: {} })], () => { throw new Error("must not be called"); });
    const body = await listVehicleStatuses(FAMILY, unconfigured.d, NOW);
    expect(unconfigured.asked.haIds).toEqual([]);
    expect(body.vehicles[0]).toMatchObject({ available: false, reason: "not_configured" });
  });
});

test.describe("Home Assistant failing is per vehicle, never a throw", () => {
  test("unreachable: every readable car is home_assistant_unavailable, an unconfigured one keeps its own reason", async () => {
    const { d } = deps([row(), row({ id: "v-2", config: {} })], () => { throw new HomeUpstreamError("Home Assistant could not be reached"); });
    const body = await listVehicleStatuses(FAMILY, d, NOW);
    expect(body.vehicles[0]).toMatchObject({ id: "v-1", available: false, reason: "home_assistant_unavailable", battery_level_pct: null });
    expect(body.vehicles[1]).toMatchObject({ id: "v-2", available: false, reason: "not_configured" });
  });

  test("not connected is told apart from unreachable", async () => {
    const { d } = deps([row()], () => { throw new HomeUnavailable(); });
    const body = await listVehicleStatuses(FAMILY, d, NOW);
    expect(body.vehicles[0]).toMatchObject({ available: false, reason: "home_assistant_not_connected" });
  });

  test("any other error from the Home Assistant client is still soft", async () => {
    const { d } = deps([row()], () => { throw new TypeError("boom"); });
    await expect(listVehicleStatuses(FAMILY, d, NOW)).resolves.toMatchObject({
      vehicles: [{ available: false, reason: "home_assistant_unavailable" }],
    });
  });

  test("a database failure does throw — there is nothing per-vehicle to report without the rows", async () => {
    const d: VehicleDeps = {
      loadVehicles: async () => { throw new Error("db down"); },
      getHaStates: async () => new Map(),
    };
    await expect(listVehicleStatuses(FAMILY, d, NOW)).rejects.toThrow("db down");
  });
});
