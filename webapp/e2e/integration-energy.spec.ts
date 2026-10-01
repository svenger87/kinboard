import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildEnergyStatus, energySensorIds, ENERGY_FIELDS, ENERGY_POWER_FIELDS, ENERGY_TODAY_FIELDS, toEnergyReading,
  type EnergySensorConfig,
} from "../src/lib/integration-energy";
import { readEnergyStatus } from "../src/lib/integration-energy-status";
import { HA_STATES_MAX_BYTES } from "../src/lib/home/ha-client";
import { counterGrowth, fetchHaStatistics, summedChange } from "../src/lib/home/ha-statistics";
import { familyMidnight } from "../src/lib/family-time";
import { HomeUpstreamError } from "../src/lib/home/errors";
import type { HomeAssistantSettings } from "../src/types/home-assistant";

/**
 * `GET /energy/current` (RFC-012 §5.8): every sensor of Kinboard's energy
 * settings, only `sensor.*` IDs, one `/api/states` call — and energy today
 * as the change since the family's local midnight from Home Assistant's
 * statistics, never the raw state. Pure logic plus a stub Home Assistant;
 * no stack.
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
  grid_export: "sensor.grid_export_daily",
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
  // A lifetime counter (Zendure's aggr_solar): 1,636 kWh is not today's yield.
  { entity_id: "sensor.pv_today", state: "1636.318", attributes: { unit_of_measurement: "kWh" }, last_updated: T },
  // A daily counter that resets a moment after midnight.
  { entity_id: "sensor.grid_export_daily", state: "3.1", attributes: { unit_of_measurement: "kWh" }, last_updated: T },
  { entity_id: "sensor.battery_soc", state: "76", attributes: { unit_of_measurement: "%" }, last_updated: T },
  // sensor.grid_import_today is configured and absent: null.
  { entity_id: "switch.grid_export", state: "on", attributes: {}, last_updated: T },
  { entity_id: "lock.front_door", state: "1", attributes: {}, last_updated: T },
  // Not configured anywhere.
  { entity_id: "sensor.unconfigured_power", state: "999", attributes: { unit_of_measurement: "W" }, last_updated: T },
  { entity_id: "device_tracker.phone", state: "home", attributes: { latitude: 1 }, last_updated: T },
];

const SETTINGS = { url: "http://ha.local:8123", access_token: "tok", energy_config: CONFIG } as HomeAssistantSettings;

/**
 * Each energy sensor's recorded states, oldest first. The stub answers a
 * history request the way Home Assistant does: the state in force at
 * `start_time`, then every change up to `end_time`.
 */
const TIMELINE: Record<string, [string, string][]> = {
  "sensor.pv_today": [
    ["2026-09-30T15:00:00.000Z", "1631.900"], // yesterday afternoon
    ["2026-09-30T21:00:00.000Z", "1632.118"], // 23:00 Berlin: before the family's midnight
    ["2026-09-30T23:00:00.000Z", "1632.500"], // 01:00 Berlin: after it, but before UTC's
    ["2026-10-01T06:00:00.000Z", "1633.000"],
    ["2026-10-01T09:00:00.000Z", "1636.318"],
  ],
  "sensor.grid_export_daily": [
    ["2026-09-30T15:00:00.000Z", "7.9"], // yesterday's total, still showing at midnight
    ["2026-09-30T22:00:05.000Z", "0"], // reset, five seconds after Berlin midnight
    ["2026-10-01T07:00:00.000Z", "unavailable"],
    ["2026-10-01T08:00:00.000Z", "1.5"],
    ["2026-10-01T09:30:00.000Z", "3.1"],
  ],
  // Not configured; must never be asked for or appear.
  "sensor.unconfigured_energy": [["2026-09-30T00:00:00.000Z", "5"], ["2026-10-01T09:00:00.000Z", "555"]],
};

function historyAnswer(url: URL): unknown {
  const start = Date.parse(decodeURIComponent(url.pathname.split("/").pop()!));
  const end = Date.parse(url.searchParams.get("end_time")!);
  const ids = url.searchParams.get("filter_entity_id")!.split(",");
  // The stub ignores the filter for one entity, as a careless proxy might.
  return [...ids, "sensor.unconfigured_energy"].filter((id) => TIMELINE[id]).map((id) => {
    const line = TIMELINE[id].map(([t, state]) => ({ t: Date.parse(t), state }));
    const before = line.filter((e) => e.t <= start).at(-1);
    const during = line.filter((e) => e.t > start && e.t <= end);
    const entries = [...(before ? [before] : []), ...during];
    return entries.map((e, i) => (i === 0 ? { entity_id: id, state: e.state, last_changed: new Date(e.t).toISOString() } : { state: e.state, last_changed: new Date(e.t).toISOString() }));
  });
}

type Mode = { statistics?: "404" | "500" | unknown; history?: "ok" | "500" | "throw" | string };

function stubHa(mode: Mode = {}) {
  const urls: string[] = [];
  const fetchStub = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    urls.push(String(input));
    const json = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/states") return json(STATES);
    if (url.pathname === "/api/history/statistics") {
      const st = mode.statistics ?? "404";
      if (st === "404") return json({ message: "Not found" }, 404);
      if (st === "500") return json({}, 500);
      return json(st);
    }
    if (url.pathname.startsWith("/api/history/period/")) {
      const h = mode.history ?? "ok";
      if (h === "throw") throw new TypeError("fetch failed");
      if (h === "500") return json({}, 500);
      if (h !== "ok") return json(h);
      return json(historyAnswer(url));
    }
    return json({}, 404);
  }) as typeof fetch;
  return { urls, io: { fetch: fetchStub, loadSettings: async () => SETTINGS } };
}

const BERLIN = "Europe/Berlin";

test.describe("which sensors are read", () => {
  test("only configured sensor.* IDs, in every slot of the settings", () => {
    expect(Object.fromEntries(energySensorIds(CONFIG))).toEqual({
      solar_power: "sensor.pv_power",
      battery_power: "sensor.battery_power",
      grid_power: "sensor.grid_power",
      home_consumption: "sensor.house_load",
      solar_energy_today: "sensor.pv_today",
      grid_import: "sensor.grid_import_today",
      grid_export: "sensor.grid_export_daily",
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

const today = (value: number | null, total: number | null, reason: string | null = null) =>
  ({ value, unit: "kWh", observed_at: T, total, reason });

test.describe("readEnergyStatus", () => {
  test("one GET /api/states, filtered to the configured sensors; power and battery are the raw state", async () => {
    const { urls, io } = stubHa();
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
    expect(urls.filter((u) => u.endsWith("/api/states"))).toEqual(["http://ha.local:8123/api/states"]);

    const text = JSON.stringify(status);
    for (const never of ["sensor.unconfigured_power", "999", "unconfigured_energy", "555", "switch.grid_export", "lock.front_door", "device_tracker", "latitude"]) {
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
    expect(status.battery_soc).toEqual({ value: 76, unit: "%", observed_at: T });
    expect(status.fetched_at).toBe(NOW.toISOString());
  });

  test("a lifetime counter: today is the change since midnight, the 1,636 kWh state is only total", async () => {
    const { io } = stubHa();
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
    const pv = status.energy_today.solar_energy_today!;
    expect(pv.value).toBeCloseTo(4.2, 9);
    expect(pv.total).toBe(1636.318);
    expect(pv).toEqual(today(pv.value, 1636.318));
  });

  test("a daily counter that resets just after midnight: today is today's, not today minus yesterday", async () => {
    const { io } = stubHa();
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
    // Last minus first would be 3.1 − 7.9 = −4.8: the reset counts from zero.
    expect(status.energy_today.grid_export).toEqual(today(3.1, 3.1));
    expect(status.energy_today).toMatchObject({
      battery_energy_in: null, // lock.front_door: not a sensor
      battery_energy_out: null, // a path, not a sensor ID
      grid_import: null, // configured, not reported by Home Assistant
      grid_to_battery_energy: null, // not configured
    });
  });

  test("today begins at the family's midnight, not UTC's", async () => {
    const berlin = stubHa();
    const atBerlin = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, berlin.io, () => NOW);
    const utc = stubHa();
    const atUtc = await readEnergyStatus("fam", energySensorIds(CONFIG), "UTC", utc.io, () => NOW);

    const start = (urls: string[]) => decodeURIComponent(new URL(urls.find((u) => u.includes("/api/history/period/"))!).pathname.split("/").pop()!);
    expect(start(berlin.urls)).toBe("2026-09-30T22:00:00.000Z");
    expect(start(utc.urls)).toBe("2026-10-01T00:00:00.000Z");
    expect(atBerlin.energy_today.solar_energy_today!.value).toBeCloseTo(4.2, 9);
    expect(atUtc.energy_today.solar_energy_today!.value).toBeCloseTo(3.818, 9);

    // 23:30 UTC is already tomorrow in Berlin: the day that has just begun.
    const late = stubHa();
    await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, late.io, () => new Date("2026-10-01T23:30:00.000Z"));
    expect(start(late.urls)).toBe("2026-10-01T22:00:00.000Z");
  });

  test("one statistics request, for the configured energy-today sensor.* IDs only", async () => {
    const { urls, io } = stubHa();
    await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
    const stats = urls.filter((u) => u.includes("/api/history/statistics"));
    const history = urls.filter((u) => u.includes("/api/history/period/"));
    expect(stats).toHaveLength(1);
    expect(history).toHaveLength(1);
    const wanted = ["sensor.pv_today", "sensor.grid_import_today", "sensor.grid_export_daily"];
    expect(new URL(stats[0]).searchParams.get("statistic_ids")!.split(",")).toEqual(wanted);
    expect(new URL(history[0]).searchParams.get("filter_entity_id")!.split(",")).toEqual(wanted);
    expect(new URL(history[0]).searchParams.get("end_time")).toBe(NOW.toISOString());
    for (const u of [...stats, ...history]) {
      for (const never of ["lock.", "switch.", "config", "pv_power", "battery_soc", "unconfigured"]) expect(u, never).not.toContain(never);
    }
  });

  test("no energy-today sensor configured: no statistics request at all", async () => {
    const { urls, io } = stubHa();
    const status = await readEnergyStatus("fam", energySensorIds({ solar_power: "sensor.pv_power" }), BERLIN, io, () => NOW);
    expect(urls).toEqual(["http://ha.local:8123/api/states"]);
    expect(status.solar_energy_today).toBeNull();
  });

  test("Home Assistant's statistics endpoint, where there is one: summed change, a period without change skipped", async () => {
    const statistics = {
      "sensor.pv_today": [
        { start: "2026-09-30T22:00:00Z", end: "2026-10-01T22:00:00Z", change: 4.2, sum: 1636.318, state: 1636.318 },
      ],
      // A sensor with long-term statistics but no `change` (a measurement sensor).
      "sensor.grid_export_daily": [{ start: "2026-09-30T22:00:00Z", end: "2026-10-01T22:00:00Z", mean: 2 }],
    };
    const { urls, io } = stubHa({ statistics });
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
    expect(urls.some((u) => u.includes("/api/history/period/"))).toBe(false);
    expect(new URL(urls.find((u) => u.includes("/api/history/statistics"))!).searchParams.get("start_time")).toBe("2026-09-30T22:00:00.000Z");
    expect(status.energy_today.solar_energy_today).toEqual(today(4.2, 1636.318));
    expect(status.energy_today.grid_export).toEqual(today(null, 3.1, "no_statistics"));
    expect(summedChange([{ start: "", end: "", change: 1 }, { start: "", end: "", mean: 3 }, { start: "", end: "", change: 0.5 }])).toBe(1.5);
    expect(summedChange([])).toBeNull();
    expect(summedChange(undefined)).toBeNull();
  });

  test("a sensor without history is no_statistics; one that did not change today is 0", async () => {
    const history = JSON.stringify([
      [{ entity_id: "sensor.pv_today", state: "1636.318", last_changed: T }],
      [{ entity_id: "sensor.grid_export_daily", state: "unavailable", last_changed: T }],
    ]);
    const { io } = stubHa({ history });
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
    expect(status.energy_today.solar_energy_today).toEqual(today(0, 1636.318));
    expect(status.energy_today.grid_export).toEqual(today(null, 3.1, "no_statistics"));
  });

  for (const [name, mode] of [
    ["the statistics endpoint errors", { statistics: "500" }],
    ["the history errors", { history: "500" }],
    ["the history cannot be reached", { history: "throw" }],
    ["the answer is not history", { history: JSON.stringify({ not: "a list" }) }],
  ] as [string, Mode][]) {
    test(`statistics failing (${name}): energy today is null with a reason, power still comes back`, async () => {
      const { io } = stubHa(mode);
      const status = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
      expect(status.energy_today.solar_energy_today).toEqual(today(null, 1636.318, "statistics_unavailable"));
      expect(status.energy_today.grid_export).toEqual(today(null, 3.1, "statistics_unavailable"));
      expect(status.solar_energy_today).toEqual({ ...today(null, 1636.318, "statistics_unavailable"), entity_id: "sensor.pv_today" });
      expect(status.power.solar_power).toEqual({ value: 3420, unit: "W", observed_at: T });
      expect(status.battery_soc).toEqual({ value: 76, unit: "%", observed_at: T });
    });
  }

  test("the compatibility keys keep their fields, entity_id included", async () => {
    const { io } = stubHa();
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
    expect(status.solar_power).toEqual({ value: 3420, unit: "W", entity_id: "sensor.pv_power", observed_at: T });
    expect(Object.keys(status.solar_power!)).toEqual(["value", "unit", "entity_id", "observed_at"]);
    const compat = status.solar_energy_today!;
    expect(Object.keys(compat)).toEqual(["value", "unit", "entity_id", "observed_at", "total", "reason"]);
    expect(compat.value).toBeCloseTo(4.2, 9);
    expect(compat).toEqual({ value: compat.value, unit: "kWh", entity_id: "sensor.pv_today", observed_at: T, total: 1636.318, reason: null });
    expect(compat.value).toBe(status.energy_today.solar_energy_today!.value);
    expect(Object.keys(status)).toEqual(["solar_power", "solar_energy_today", "power", "energy_today", "battery_soc", "fetched_at"]);
  });

  test("a large install's states list (over 2 MiB) is read, up to the 16 MiB cap and no further", async () => {
    expect(HA_STATES_MAX_BYTES).toBe(16 * 1024 * 1024);
    const padded = (bytes: number) => {
      const filler = { entity_id: "sensor.filler", state: "1", attributes: { blob: "x".repeat(bytes) }, last_updated: T };
      return JSON.stringify([...STATES, filler]);
    };
    const io = (body: string) => ({
      fetch: (async (input: URL | RequestInfo) => String(input).endsWith("/api/states")
        ? new Response(body, { status: 200 })
        : new Response("{}", { status: 404 })) as typeof fetch,
      loadSettings: async () => SETTINGS,
    });
    const big = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io(padded(3 * 1024 * 1024)), () => NOW);
    expect(big.power.solar_power).toEqual({ value: 3420, unit: "W", observed_at: T });
    await expect(readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io(padded(HA_STATES_MAX_BYTES + 1)), () => NOW))
      .rejects.toBeInstanceOf(HomeUpstreamError);
  });

  test("history over the same 16 MiB cap is statistics_unavailable, not a failed request", async () => {
    const huge = JSON.stringify([[{ entity_id: "sensor.pv_today", state: "1", last_changed: T, pad: "x".repeat(HA_STATES_MAX_BYTES) }]]);
    const { io } = stubHa({ history: huge });
    const status = await readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io, () => NOW);
    expect(status.energy_today.solar_energy_today!.reason).toBe("statistics_unavailable");
    expect(status.power.solar_power!.value).toBe(3420);
  });

  test("Home Assistant failing is an error, not an empty picture", async () => {
    const io = {
      fetch: (async () => new Response("no", { status: 500 })) as typeof fetch,
      loadSettings: async () => SETTINGS,
    };
    await expect(readEnergyStatus("fam", energySensorIds(CONFIG), BERLIN, io)).rejects.toThrow();
  });
});

test.describe("counting a counter's growth", () => {
  test("Home Assistant's total_increasing rule: a fall of over 10% is a reset, a smaller one a dip", () => {
    expect(counterGrowth([])).toBe(0);
    expect(counterGrowth([5])).toBe(0);
    expect(counterGrowth([1632.118, 1633, 1636.318])).toBeCloseTo(4.2, 9);
    expect(counterGrowth([7.9, 0, 1.5, 3.1])).toBeCloseTo(3.1, 9); // reset to 0
    expect(counterGrowth([7.9, 0.4, 3.1])).toBeCloseTo(3.1, 9); // reset seen only at 0.4
    expect(counterGrowth([100, 99.5, 101])).toBeCloseTo(1.5, 9); // dip: no reset, no negative
  });

  test("the screens' statistics route goes through the same code path", () => {
    const src = readFileSync(join(__dirname, "../src/app/api/homeassistant/statistics/route.ts"), "utf8");
    expect(src).toContain("fetchHaStatistics(");
    expect(src).not.toMatch(/\/api\/history\//);
  });

  test("the statistics fallback asks only for the requested IDs and returns only them", async () => {
    const urls: string[] = [];
    const f = (async (input: URL | RequestInfo) => {
      urls.push(String(input));
      return String(input).includes("/statistics")
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify([[{ entity_id: "sensor.a", state: "1" }, { state: "2" }], [{ entity_id: "sensor.other", state: "9" }]]), { status: 200 });
    }) as typeof fetch;
    const stats = await fetchHaStatistics({
      base: new URL("http://ha.local:8123/proxy/"), token: "tok", ids: ["sensor.a"], period: "day",
      startTime: "2026-09-30T22:00:00.000Z", endTime: NOW.toISOString(), fetch: f,
    });
    expect(Object.keys(stats)).toEqual(["sensor.a"]);
    expect(stats["sensor.a"][0].change).toBe(1);
    expect(urls[0]).toMatch(/^http:\/\/ha\.local:8123\/proxy\/api\/history\/statistics\?/);
    expect(urls[1]).toMatch(/^http:\/\/ha\.local:8123\/proxy\/api\/history\/period\/2026-09-30T22%3A00%3A00\.000Z\?filter_entity_id=sensor\.a&/);
  });
});

test.describe("the family's midnight", () => {
  test("Berlin in summer and winter time, UTC, and a zone whose midnight is skipped", () => {
    expect(familyMidnight(NOW, "Europe/Berlin").toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(familyMidnight(NOW, "UTC").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(familyMidnight(new Date("2026-12-01T12:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-11-30T23:00:00.000Z");
    // The day the clocks go back: it still began at 00:00 summer time.
    expect(familyMidnight(new Date("2026-10-25T12:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(familyMidnight(NOW, "America/New_York").toISOString()).toBe("2026-10-01T04:00:00.000Z");
    // Chile skips 00:00 on its first September Sunday: that day starts at 01:00.
    expect(familyMidnight(new Date("2026-09-06T15:00:00Z"), "America/Santiago").toISOString()).toBe("2026-09-06T04:00:00.000Z");
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
    const status = buildEnergyStatus(energySensorIds({ battery_soc: "sensor.soc" }), new Map(), new Map(), NOW);
    expect(status.battery_soc).toBeNull();
    expect(status.solar_power).toBeNull();
    expect(Object.keys(status.power)).toEqual([...ENERGY_POWER_FIELDS]);
    expect(Object.keys(status.energy_today)).toEqual([...ENERGY_TODAY_FIELDS]);
  });
});

test("the route reads through readEnergyStatus with energy:read and nothing a client sends", () => {
  const src = readFileSync(join(__dirname, "../src/app/api/integration/v1/energy/current/route.ts"), "utf8");
  expect(src).toContain('withIntegrationAuth(request, "energy:read"');
  expect(src).toContain("readEnergyStatus(context.familyId, ids, timeZone");
  expect(src).toContain("await familyTimeZone(context.familyId)");
  expect(src).not.toMatch(/searchParams|request\.json/);
});
