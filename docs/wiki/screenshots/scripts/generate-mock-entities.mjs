#!/usr/bin/env node
// generate-mock-entities.mjs — read every entity_id referenced anywhere in
// public.settings (rooms_config, dashboards, energy_config, tesla_config,
// dashboard_cards, etc.) and emit a matching mocks/ha/entities.json so
// every reference resolves to a believable mock entity.
//
// Run AFTER 4-anonymize.mjs (the anonymized DB still has the same entity
// IDs as prod — anonymization only scrubs auth, it doesn't rewrite IDs).

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---- Read demo.env ---------------------------------------------------
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "demo.env"), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i+1).trim()]; }),
);
const PROJECT = env.PROJECT_NAME || "familyboard-demo";
const DB = `${PROJECT}-db`;

// ---- Pull all settings JSON ----------------------------------------
const settingsRaw = spawnSync("docker", [
  "exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c",
  "SELECT value::text FROM public.settings WHERE key='home_assistant'",
], { encoding: "utf8" });
if (settingsRaw.status !== 0) {
  console.error("Could not read home_assistant settings from demo DB:", settingsRaw.stderr);
  process.exit(1);
}
const haSettings = JSON.parse(settingsRaw.stdout.trim());

// ---- Walk the tree, collect every entity_id ----------------------
const ids = new Set();
const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;
function walk(node) {
  if (typeof node === "string" && ENTITY_RE.test(node)) ids.add(node);
  if (Array.isArray(node)) for (const v of node) walk(v);
  else if (node && typeof node === "object") for (const v of Object.values(node)) walk(v);
}
walk(haSettings);

console.log(`Collected ${ids.size} unique entity IDs from settings`);

// ---- Generate believable mock states ------------------------------
function defaultState(id) {
  const [domain, slug] = id.split(".");
  const friendly = slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Energy sensors that need numeric values for charts to render
  const ENERGY_NUM = {
    solar_input_power: 2418, solar_power: 2418,
    pv_power: 2418, pv_input_power: 2418,
    output_pack_power: 820,
    pack_input_power: 820,
    grid_input_power: 0,
    grid_export_power: 0, grid_import_power: 1340,
    electric_level: 78, battery_level: 78, soc: 78,
    aggr_solar: 12.4, aggr_charge: 4.1, aggr_discharge: 2.7,
    aggr_grid_input_power: 0,
    grid_export_energy: 3.8, grid_import_energy: 5.2,
    home_consumption_power: 3578, home_consumption: 3578,
  };
  for (const [key, val] of Object.entries(ENERGY_NUM)) {
    if (slug.includes(key)) return { state: String(val), attrs: { friendly_name: friendly, unit_of_measurement: key.includes("aggr") || key.includes("energy") ? "kWh" : (key.includes("level") || key.includes("soc") ? "%" : "W"), device_class: key.includes("level") || key.includes("soc") ? "battery" : (key.includes("aggr") || key.includes("energy") ? "energy" : "power"), state_class: key.includes("aggr") || key.includes("energy") ? "total_increasing" : "measurement" } };
  }

  switch (domain) {
    case "light": {
      const colorModes = slug.includes("rgb") || slug.includes("strip") ? ["rgb"] : ["onoff"];
      const isOn = !slug.includes("garden") && !slug.includes("aussen") && !slug.includes("garten");
      return {
        state: isOn ? "on" : "off",
        attrs: { friendly_name: friendly, supported_color_modes: colorModes, brightness: isOn ? 200 : 0 },
      };
    }
    case "switch":
    case "input_boolean":
      return { state: slug.includes("waschmaschine") || slug.includes("washing") ? "on" : "off", attrs: { friendly_name: friendly } };
    case "climate":
      return { state: "heat", attrs: { friendly_name: friendly, current_temperature: 21.5, temperature: 22.0, hvac_modes: ["off","heat","auto"], min_temp: 7, max_temp: 30 } };
    case "cover":
      return { state: "open", attrs: { friendly_name: friendly, current_position: 100 } };
    case "media_player":
      return { state: "playing", attrs: { friendly_name: friendly, media_title: "Lofi Beats", media_artist: "Various Artists", volume_level: 0.4 } };
    case "lock":
      return { state: "locked", attrs: { friendly_name: friendly } };
    case "vacuum":
      return { state: "docked", attrs: { friendly_name: friendly, battery_level: 100 } };
    case "weather":
      return { state: "partlycloudy", attrs: { friendly_name: friendly, temperature: 14.5, humidity: 65, wind_speed: 12, forecast: [] } };
    case "person":
    case "device_tracker":
      return { state: "home", attrs: { friendly_name: friendly, latitude: 52.52, longitude: 13.405 } };
    case "binary_sensor":
      return { state: slug.includes("motion") ? "on" : "off", attrs: { friendly_name: friendly, device_class: slug.includes("door") ? "door" : (slug.includes("motion") ? "motion" : "opening") } };
    case "sensor": {
      // Generic sensor — temperature-ish, otherwise just "ok"
      if (slug.includes("temperatur") || slug.includes("temperature")) {
        return { state: "21.5", attrs: { friendly_name: friendly, unit_of_measurement: "°C", device_class: "temperature" } };
      }
      if (slug.includes("kilometer") || slug.includes("odometer") || slug.includes("range") || slug.includes("reichweite")) {
        return { state: "245.4", attrs: { friendly_name: friendly, unit_of_measurement: "km", device_class: "distance" } };
      }
      if (slug.includes("humidity") || slug.includes("luftfeuchte")) {
        return { state: "65", attrs: { friendly_name: friendly, unit_of_measurement: "%", device_class: "humidity" } };
      }
      return { state: "0", attrs: { friendly_name: friendly } };
    }
    case "scene":
      return { state: "scening", attrs: { friendly_name: friendly } };
    case "camera":
      return { state: "streaming", attrs: { friendly_name: friendly, entity_picture: `/api/camera_proxy/${id}` } };
    case "automation":
    case "script":
      return { state: "on", attrs: { friendly_name: friendly } };
    default:
      return { state: "unknown", attrs: { friendly_name: friendly } };
  }
}

const entities = [...ids].sort().map((id) => {
  const { state, attrs } = defaultState(id);
  return { entity_id: id, state, attributes: attrs };
});

// Always also keep a baseline of common entities the camera mock + a few
// other features expect even if not in prod settings.
const DEFAULTS = [
  "person.parent_a", "person.parent_b",
];
for (const id of DEFAULTS) {
  if (!ids.has(id)) {
    const { state, attrs } = defaultState(id);
    entities.push({ entity_id: id, state, attributes: attrs });
  }
}

const out = resolve(ROOT, "mocks/ha/entities.json");
writeFileSync(out, JSON.stringify(entities, null, 2));
console.log(`Wrote ${entities.length} entities to ${out}`);
