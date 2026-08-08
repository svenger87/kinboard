import { test, expect } from "@playwright/test";
import { readVehicle, vehicleEntityIds } from "../src/plugins/vehicles/readings";

/**
 * The entity map below is a real car: a Model Y on `tesla_fleet`, mid-charge at
 * 11 kW, 57%, with a completion timestamp and a couple of entities that are
 * simply not reporting. Both drivers read through this function, so what it
 * returns is what both cards show.
 */

const NOW = Date.parse("2026-08-08T11:02:36+00:00");

const CAR = new Map<string, { state: string; attributes?: Record<string, string> }>([
  ["sensor.model_y_batteriestand", { state: "57", attributes: { unit_of_measurement: "%", device_class: "battery" } }],
  ["sensor.model_y_batteriereichweite", { state: "295.94226816", attributes: { unit_of_measurement: "km", device_class: "distance" } }],
  ["sensor.model_y_ladegerat_leistung", { state: "11", attributes: { unit_of_measurement: "kW", device_class: "power" } }],
  ["sensor.model_y_ladestatus", { state: "charging", attributes: { device_class: "enum" } }],
  ["number.model_y_ladelimit", { state: "80", attributes: { unit_of_measurement: "%", device_class: "battery" } }],
  ["sensor.model_y_zeit_zum_vollstandigen_aufladen", { state: "2026-08-08T12:51:36+00:00", attributes: { device_class: "timestamp" } }],
  ["sensor.model_y_ladeenergie_hinzugefugt", { state: "3.84", attributes: { unit_of_measurement: "kWh", device_class: "energy" } }],
  ["sensor.model_y_innentemperatur", { state: "27.6", attributes: { unit_of_measurement: "°C", device_class: "temperature" } }],
  ["lock.model_y_schloss", { state: "unlocked" }],
  ["cover.model_y_kofferraum", { state: "closed", attributes: { device_class: "door" } }],
  ["device_tracker.model_y_standort", { state: "home" }],
  // Reporting nothing right now — the case that used to render as "0 km".
  ["sensor.model_y_entfernung_bis_zur_ankunft", { state: "unknown", attributes: { unit_of_measurement: "km" } }],
]);

const CONFIG = {
  battery_level: "sensor.model_y_batteriestand",
  battery_range: "sensor.model_y_batteriereichweite",
  charger_power: "sensor.model_y_ladegerat_leistung",
  charging_state: "sensor.model_y_ladestatus",
  charge_limit: "number.model_y_ladelimit",
  time_to_full_charge: "sensor.model_y_zeit_zum_vollstandigen_aufladen",
  charge_energy_added: "sensor.model_y_ladeenergie_hinzugefugt",
  inside_temperature: "sensor.model_y_innentemperatur",
  locked: "lock.model_y_schloss",
  trunk: "cover.model_y_kofferraum",
  location: "device_tracker.model_y_standort",
  odometer: "sensor.model_y_entfernung_bis_zur_ankunft",
};

test.describe("readVehicle", () => {
  const r = readVehicle(CONFIG, CAR, NOW);

  test("numbers keep the unit their entity reported", () => {
    expect(r.battery).toEqual({ value: 57, unit: "%" });
    expect(r.range).toEqual({ value: 295.94226816, unit: "km" });
    expect(r.power).toEqual({ value: 11, unit: "kW" });
    expect(r.energyAdded).toEqual({ value: 3.84, unit: "kWh" });
    expect(r.insideTemp).toEqual({ value: 27.6, unit: "°C" });
  });

  test("an entity with no reading is null, so the card can show a dash", () => {
    expect(r.odometer).toBeNull();
  });

  test("an unconfigured slot is null rather than zero", () => {
    expect(r.outsideTemp).toBeNull();
    expect(r.tyres.fl).toBeNull();
  });

  test("the charge ETA counts down to the timestamp", () => {
    expect(r.minutesToFull).toBe(109);
  });

  test("charging, from an enum sensor", () => {
    expect(r.charging).toBe(true);
  });

  test("lock, cover and tracker states", () => {
    expect(r.locked).toBe(false);
    expect(r.trunkOpen).toBe(false);
    expect(r.locationState).toBe("home");
    // Not configured: null, not a guess.
    expect(r.doorsOpen).toBeNull();
    expect(r.windowsOpen).toBeNull();
  });

  test("charging power falls back from charging_rate to charger_power", () => {
    const withRate = readVehicle(
      { ...CONFIG, charging_rate: "sensor.model_y_ladegerat_leistung", charger_power: undefined },
      CAR,
      NOW,
    );
    expect(withRate.power?.value).toBe(11);
  });

  test("power alone is enough to count as charging", () => {
    const noState = readVehicle({ ...CONFIG, charging_state: undefined }, CAR, NOW);
    expect(noState.charging).toBe(true);
  });
});

test.describe("vehicleEntityIds", () => {
  test("lists every configured entity, deduplicated", () => {
    const ids = vehicleEntityIds(CONFIG);
    expect(ids).toContain("sensor.model_y_batteriestand");
    expect(ids).toContain("device_tracker.model_y_standort");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the same id in two slots is fetched once", () => {
    const ids = vehicleEntityIds({
      battery_level: "sensor.x",
      charge_limit: "sensor.x",
    });
    expect(ids).toEqual(["sensor.x"]);
  });

  test("an empty config asks for nothing", () => {
    expect(vehicleEntityIds({})).toEqual([]);
    expect(vehicleEntityIds(undefined)).toEqual([]);
  });
});
