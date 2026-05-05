// Mock Tesla Fleet API — minimum viable to feed Kinboard's Tesla widget
// and /tesla page with believable data so the silver Model Y Juniper render
// has live numbers next to it.

import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "8124", 10);

// Demo vehicle — silver Model Y Juniper, parked at home, charging.
const vehicle = {
  id: 1700000001234,
  vehicle_id: 1700000001235,
  vin: "DEMOVINNOTREAL1234",
  display_name: "Model Y",
  state: "online",
  in_service: false,
  api_version: 71,
  charge_state: {
    battery_level: 67,
    battery_range: 245.4,
    est_battery_range: 240.1,
    ideal_battery_range: 312.5,
    charging_state: "Charging",
    charge_limit_soc: 80,
    charge_limit_soc_max: 100,
    charge_limit_soc_min: 50,
    charger_actual_current: 16,
    charger_voltage: 230,
    charger_power: 11,
    charge_rate: 32.5,
    time_to_full_charge: 1.4,
    minutes_to_full_charge: 84,
    fast_charger_present: false,
  },
  drive_state: {
    speed: null,
    gear: "P",
    heading: 90,
    latitude: 52.520,
    longitude: 13.405,
    native_location_supported: 1,
    native_latitude: 52.520,
    native_longitude: 13.405,
    native_type: "wgs",
    power: 0,
    shift_state: null,
  },
  climate_state: {
    inside_temp: 18.5,
    outside_temp: 14.2,
    is_climate_on: false,
    is_preconditioning: false,
    driver_temp_setting: 21.0,
    passenger_temp_setting: 21.0,
    seat_heater_left: 0,
    seat_heater_right: 0,
  },
  vehicle_state: {
    locked: true,
    odometer: 14823.4,
    sentry_mode: false,
    car_version: "2025.32.6",
    software_update: { status: "" },
    tpms_pressure_fl: 2.4,
    tpms_pressure_fr: 2.4,
    tpms_pressure_rl: 2.4,
    tpms_pressure_rr: 2.4,
  },
  vehicle_config: {
    car_type: "modely",
    exterior_color: "MidnightSilver",
    wheel_type: "Stiletto19",
  },
};

function send(res, status, body, contentType = "application/json") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // OAuth — accept anything, return a permanent demo token
  if (path === "/oauth2/v3/token" && req.method === "POST") {
    return send(res, 200, {
      access_token: "demo-tesla-access-token",
      refresh_token: "demo-tesla-refresh-token",
      expires_in: 28800,
      token_type: "Bearer",
    });
  }

  // List vehicles
  if (path === "/api/1/vehicles" || path === "/api/1/products") {
    return send(res, 200, { response: [vehicle], count: 1 });
  }

  // Single vehicle
  if (path === `/api/1/vehicles/${vehicle.id}`) {
    return send(res, 200, { response: vehicle });
  }

  // /vehicle_data — single combined endpoint Kinboard probably hits
  if (path === `/api/1/vehicles/${vehicle.id}/vehicle_data`) {
    return send(res, 200, { response: vehicle });
  }

  // Specific data buckets
  for (const bucket of ["charge_state", "drive_state", "climate_state", "vehicle_state", "vehicle_config"]) {
    if (path === `/api/1/vehicles/${vehicle.id}/data_request/${bucket}`) {
      return send(res, 200, { response: vehicle[bucket] });
    }
  }

  // Wake-up endpoint — pretend it succeeds immediately
  if (path === `/api/1/vehicles/${vehicle.id}/wake_up`) {
    return send(res, 200, { response: { ...vehicle, state: "online" } });
  }

  // Generic command endpoints — accept and return success
  if (path.startsWith(`/api/1/vehicles/${vehicle.id}/command/`)) {
    return send(res, 200, { response: { reason: "", result: true } });
  }

  send(res, 404, { error: "not_found", message: `Mock Tesla: ${req.method} ${path}` });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mock Tesla listening on :${PORT}`);
});
