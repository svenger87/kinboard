import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildEnergyStatus, energySensorIds, ENERGY_FIELDS, ENERGY_POWER_FIELDS, ENERGY_TODAY_FIELDS, toEnergyReading,
  type EnergySensorConfig,
} from "../src/lib/integration-energy";
import { readEnergyStatus } from "../src/lib/integration-energy-status";
import { HA_STATES_MAX_BYTES } from "../src/lib/home/ha-client";
import { HomeUpstreamError } from "../src/lib/home/errors";
import type { HomeAssistantSettings } from "../src/types/home-assistant";

/**
 * `GET /energy/current` (RFC-012 §4): every sensor of Kinboard's energy
 * settings, only `sensor.*` IDs, one `/api/states` call. Pure logic plus a
 * stub `fetch`; no stack.
 */

const NOW = new Date("2026-10-01T10:00:00.000Z");
const T = "2026-10-01T09:59:30.000Z";

const CONFIG: EnergySensorConfig = {
  solar_power: "sensor.pv_power",
  battery_power: "sensor.battery_power",
  grid_power: "sensor.grid_power",
  home_consumption: "sensor.house_load",
  solar_energy_today: "sensor.pv_today",
  grid_import: "sensor.grid_import_today",
  battery_soc: "sensor.battery_soc",
  // Configured, but not a sensor: must never be read.
  grid_export_power: "switch.grid_export",
  battery_energy_in: "lock.front_door",
  battery_energy_out: "sensor.x/../../config",
};

/** A full `/api/states` answer: the configured sensors plus things that were not asked for. */
const STATES = [
  { entity_id: "sensor.pv_power", state: "3420", attributes: { unit_of_measurement: "W" }, last_updated: T },
  { entity_id: "sensor.battery_power", state: "-850.5", attributes: { unit_of_measurement: "W" }, last_updated: T },
  { entity_id: "sensor.grid_power", state: "unavailable", attributes: { unit_of_measurement: "W" }, last_updated: T },
  { entity_id: "sensor.house_load", state: "unknown", attributes: {}, last_updated: T },
  { entity_id: "sensor.pv_today", state: "12.4", attributes: { unit_of_measurement: "kWh" }, last_updated: T },
  { entity_id: "sensor.battery_soc", state: "76", attributes: { unit_of_measurement: "%" }, last_updated: T },
  // sensor.grid_import_today is configured and absent: null.
  { entity_id: "switch.grid_export", state: "on", attributes: {}, last_updated: T },
  { entity_id: "lock.front_door", state: "1", attributes: {}, last_updated: T },
  // Not configured anywhere.
  { entity_id: "sensor.unconfigured_power", state: "999", attributes: { unit_of_measurement: "W" }, last_updated: T },
  { entity_id: "device_tracker.phone", state: "home", attributes: { latitude: 1 }, last_updated: T },
];

const SETTINGS = { url: "http://ha.local:8123", access_token: "tok", energy_config: CONFIG } as HomeAssistantSettings;

function stubHa() {
  const urls: string[] = [];
  const fetchStub = (async (input: URL | RequestInfo) => {
    urls.push(String(input));
    return new Response(JSON.stringify(STATES), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { urls, io: { fetch: fetchStub, loadSettings: async () => SETTINGS } };
}

test.describe("which sensors are read", () => {
  test("only configured sensor.* IDs, in every slot of the settings", () => {
    expect(Object.fromEntries(energySensorIds(CONFIG))).toEqual({
      solar_power: "sensor.pv_power",
      battery_power: "sensor.battery_power",
      grid_power: "sensor.grid_power",
      home_consumption: "sensor.house_load",
      solar_energy_today: "sensor.pv_today",
      grid_import: "sensor.grid_import_today",
      battery_soc: "sensor.battery_soc",
    });
  });

  test("the slots are exactly the sensor fields of EnergyConfig", () => {
    const types = readFileSync(join(__dirname, "../src/types/home-assistant.ts"), "utf8");
    const block = types.slice(types.indexOf("export interface EnergyConfig"), types.indexOf("// Cost configuration"));
    const fields = [...block.matchAll(/^\s+(\w+)\?: string;/gm)].map((m) => m[1]);
    expect([...ENERGY_FIELDS].sort()).toEqual(fields.sort());
  });
});

test.describe("readEnergyStatus", () => {
  test("one GET /api/states, filtered to the configured sensors", async () => {
    const { urls, io } = stubHa();
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), io, () => NOW);
    expect(urls).toEqual(["http://ha.local:8123/api/states"]);

    const text = JSON.stringify(status);
    for (const never of ["sensor.unconfigured_power", "999", "switch.grid_export", "lock.front_door", "device_tracker", "latitude"]) {
      expect(text, never).not.toContain(never);
    }

    expect(status.power).toEqual({
      solar_power: { value: 3420, unit: "W", observed_at: T },
      battery_power: { value: -850.5, unit: "W", observed_at: T },
      battery_charge_power: null,
      battery_discharge_power: null,
      grid_power: { value: null, unit: "W", observed_at: T },
      grid_import_power: null,
      grid_export_power: null,
      grid_to_battery_power: null,
      home_consumption: { value: null, unit: null, observed_at: T },
    });
    expect(status.energy_today).toEqual({
      solar_energy_today: { value: 12.4, unit: "kWh", observed_at: T },
      battery_energy_in: null,
      battery_energy_out: null,
      grid_import: null,
      grid_export: null,
      grid_to_battery_energy: null,
    });
    expect(status.battery_soc).toEqual({ value: 76, unit: "%", observed_at: T });
    expect(status.fetched_at).toBe(NOW.toISOString());
  });

  test("the compatibility keys keep the solar-only shape, entity_id included", async () => {
    const { io } = stubHa();
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), io, () => NOW);
    expect(status.solar_power).toEqual({ value: 3420, unit: "W", entity_id: "sensor.pv_power", observed_at: T });
    expect(Object.keys(status.solar_power!)).toEqual(["value", "unit", "entity_id", "observed_at"]);
    expect(status.solar_energy_today).toEqual({ value: 12.4, unit: "kWh", entity_id: "sensor.pv_today", observed_at: T });
    expect(Object.keys(status)).toEqual(["solar_power", "solar_energy_today", "power", "energy_today", "battery_soc", "fetched_at"]);
  });

  test("a large install's states list (over 2 MiB) is read, up to the 16 MiB cap and no further", async () => {
    expect(HA_STATES_MAX_BYTES).toBe(16 * 1024 * 1024);
    const padded = (bytes: number) => {
      const filler = { entity_id: "sensor.filler", state: "1", attributes: { blob: "x".repeat(bytes) }, last_updated: T };
      return JSON.stringify([...STATES, filler]);
    };
    const io = (body: string) => ({
      fetch: (async () => new Response(body, { status: 200 })) as typeof fetch,
      loadSettings: async () => SETTINGS,
    });
    const big = await readEnergyStatus("fam", energySensorIds(CONFIG), io(padded(3 * 1024 * 1024)), () => NOW);
    expect(big.power.solar_power).toEqual({ value: 3420, unit: "W", observed_at: T });
    await expect(readEnergyStatus("fam", energySensorIds(CONFIG), io(padded(HA_STATES_MAX_BYTES + 1)), () => NOW))
      .rejects.toBeInstanceOf(HomeUpstreamError);
  });

  test("Home Assistant failing is an error, not an empty picture", async () => {
    const io = {
      fetch: (async () => new Response("no", { status: 500 })) as typeof fetch,
      loadSettings: async () => SETTINGS,
    };
    await expect(readEnergyStatus("fam", energySensorIds(CONFIG), io)).rejects.toThrow();
  });
});

test.describe("a reading", () => {
  test("numbers parse, anything else is value null", () => {
    const r = (state: string) => toEnergyReading({ state, attributes: { unit_of_measurement: "W" }, last_updated: T }).value;
    expect(r("1.5")).toBe(1.5);
    expect(r("-3")).toBe(-3);
    expect(r("unavailable")).toBeNull();
    expect(r("unknown")).toBeNull();
    expect(r("")).toBeNull();
    expect(r("NaN")).toBeNull();
  });

  test("a state Home Assistant does not report for a configured slot is null", () => {
    const status = buildEnergyStatus(energySensorIds({ battery_soc: "sensor.soc" }), new Map(), NOW);
    expect(status.battery_soc).toBeNull();
    expect(status.solar_power).toBeNull();
    expect(Object.keys(status.power)).toEqual([...ENERGY_POWER_FIELDS]);
    expect(Object.keys(status.energy_today)).toEqual([...ENERGY_TODAY_FIELDS]);
  });
});

test("the route reads through readEnergyStatus with energy:read and nothing a client sends", () => {
  const src = readFileSync(join(__dirname, "../src/app/api/integration/v1/energy/current/route.ts"), "utf8");
  expect(src).toContain('withIntegrationAuth(request, "energy:read"');
  expect(src).toContain("readEnergyStatus(context.familyId, ids");
  expect(src).not.toMatch(/searchParams|request\.json/);
});
