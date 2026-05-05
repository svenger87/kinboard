// Mock Home Assistant — minimum viable HA REST + WebSocket API.
// Lights, climate, covers, sensors, energy, cameras — enough that all
// Familyboard surfaces touching HA render with believable state.
//
// Only the routes Familyboard actually hits are implemented. We don't
// emulate the full HA spec.

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "8123", 10);

let entities = JSON.parse(readFileSync(resolve(__dirname, "entities.json"), "utf8"))
  .map((e) => ({ ...e, last_changed: new Date().toISOString(), last_updated: new Date().toISOString(), context: { id: cryptoId(), parent_id: null, user_id: null } }));

function cryptoId() {
  return Array.from({ length: 26 }, () => "ABCDEFGHJKMNPQRSTVWXYZ0123456789"[Math.floor(Math.random() * 32)]).join("");
}

function send(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(obj));
}

function findEntity(id) {
  return entities.find((e) => e.entity_id === id);
}

function applyServiceCall(domain, service, data) {
  // Update local entity state for visual feedback during screenshots.
  if (!data?.entity_id) return;
  const ids = Array.isArray(data.entity_id) ? data.entity_id : [data.entity_id];
  for (const id of ids) {
    const ent = findEntity(id);
    if (!ent) continue;

    if (domain === "light" || domain === "switch" || domain === "input_boolean") {
      if (service === "turn_on") ent.state = "on";
      if (service === "turn_off") ent.state = "off";
      if (service === "toggle") ent.state = ent.state === "on" ? "off" : "on";
      if (data.brightness != null) ent.attributes.brightness = data.brightness;
      if (data.rgb_color) ent.attributes.rgb_color = data.rgb_color;
    } else if (domain === "climate") {
      if (service === "set_temperature" && data.temperature != null) ent.attributes.temperature = data.temperature;
      if (service === "set_hvac_mode" && data.hvac_mode) ent.state = data.hvac_mode;
    } else if (domain === "cover") {
      if (service === "open_cover") { ent.state = "open"; ent.attributes.current_position = 100; }
      if (service === "close_cover") { ent.state = "closed"; ent.attributes.current_position = 0; }
      if (service === "set_cover_position" && data.position != null) {
        ent.state = data.position > 0 ? "open" : "closed";
        ent.attributes.current_position = data.position;
      }
    } else if (domain === "media_player") {
      if (service === "media_play") ent.state = "playing";
      if (service === "media_pause") ent.state = "paused";
    } else if (domain === "lock") {
      if (service === "lock") ent.state = "locked";
      if (service === "unlock") ent.state = "unlocked";
    }

    ent.last_updated = new Date().toISOString();
    broadcastState(ent);
  }
}

// -----------------------------------------------------------------------
// HTTP server
// -----------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Status check / config
  if (path === "/api/" || path === "/api") {
    return send(res, 200, { message: "API running." });
  }

  if (path === "/api/config") {
    return send(res, 200, {
      version: "2026.5.0-mock",
      location_name: "Demo Home",
      latitude: 52.52, longitude: 13.405, time_zone: "Europe/Berlin",
      unit_system: { length: "km", mass: "g", temperature: "°C", volume: "L" },
      components: ["light", "switch", "climate", "cover", "media_player", "lock", "vacuum", "weather", "person", "sensor", "binary_sensor", "scene", "camera"],
    });
  }

  // /api/states — full entity list
  if (path === "/api/states" && req.method === "GET") {
    return send(res, 200, entities);
  }

  // /api/states/<entity_id>
  const stateMatch = path.match(/^\/api\/states\/([^/]+)$/);
  if (stateMatch && req.method === "GET") {
    const ent = findEntity(decodeURIComponent(stateMatch[1]));
    if (!ent) return send(res, 404, { message: "Entity not found." });
    return send(res, 200, ent);
  }

  // /api/services/<domain>/<service>
  const serviceMatch = path.match(/^\/api\/services\/([^/]+)\/([^/]+)$/);
  if (serviceMatch && req.method === "POST") {
    const body = await readBody(req);
    applyServiceCall(serviceMatch[1], serviceMatch[2], body);
    return send(res, 200, []);
  }

  // /api/history/period[/<start>]?filter_entity_id=...&end_time=...
  if (path.startsWith("/api/history/period") && req.method === "GET") {
    const ids = (url.searchParams.get("filter_entity_id") || "").split(",").filter(Boolean);
    const start = new Date(url.searchParams.get("start") || decodeURIComponent(path.split("/").pop() || "") || Date.now() - 86400000);
    const end = new Date(url.searchParams.get("end_time") || Date.now());
    const data = ids.map((id) => generateHistory(id, start, end));
    return send(res, 200, data);
  }

  // /api/services — list of available services (Familyboard probes this)
  if (path === "/api/services" && req.method === "GET") {
    return send(res, 200, [
      { domain: "light", services: { turn_on: { fields: {} }, turn_off: { fields: {} }, toggle: { fields: {} } } },
      { domain: "switch", services: { turn_on: { fields: {} }, turn_off: { fields: {} }, toggle: { fields: {} } } },
      { domain: "climate", services: { set_temperature: { fields: {} }, set_hvac_mode: { fields: {} } } },
      { domain: "cover", services: { open_cover: { fields: {} }, close_cover: { fields: {} }, set_cover_position: { fields: {} } } },
      { domain: "media_player", services: { media_play: { fields: {} }, media_pause: { fields: {} } } },
      { domain: "lock", services: { lock: { fields: {} }, unlock: { fields: {} } } },
      { domain: "vacuum", services: { start: { fields: {} }, return_to_base: { fields: {} } } },
      { domain: "scene", services: { turn_on: { fields: {} } } },
    ]);
  }

  // Camera proxy — return a static SVG placeholder so <img> tags render.
  const camMatch = path.match(/^\/api\/camera_proxy\/(.+)$/);
  if (camMatch) {
    const label = decodeURIComponent(camMatch[1]).replace(/^camera\./, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1a1f2e"/><stop offset="100%" stop-color="#2a3142"/></linearGradient></defs>
      <rect width="800" height="450" fill="url(#g)"/>
      <text x="400" y="225" text-anchor="middle" fill="#a8b3c7" font-family="system-ui" font-size="48">${label}</text>
      <circle cx="730" cy="40" r="12" fill="#ef4444"/>
      <text x="730" y="44" text-anchor="middle" fill="#fff" font-family="system-ui" font-size="12" font-weight="bold">REC</text>
    </svg>`;
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" });
    return res.end(svg);
  }

  // Statistics endpoints (energy dashboard hits these for kWh totals)
  if (path === "/api/history/period" && req.method === "GET") {
    return send(res, 200, []);
  }

  if (path.startsWith("/api/recorder/statistics_during_period")) {
    return send(res, 200, {});
  }

  send(res, 404, { message: `Mock HA: not implemented: ${req.method} ${path}` });
});

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

// -----------------------------------------------------------------------
// History generator — believable curves so charts have shape
// -----------------------------------------------------------------------
function generateHistory(entityId, start, end) {
  const ent = findEntity(entityId);
  if (!ent) return [];
  const samples = [];
  const stepMs = (end - start) / 144; // ~10 min steps over 24 h
  const baseStr = ent.state;
  const isNumeric = !isNaN(parseFloat(baseStr));

  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const date = new Date(t);
    let stateValue = baseStr;
    if (isNumeric) {
      const baseNum = parseFloat(baseStr);
      const hr = date.getHours() + date.getMinutes() / 60;
      let num = baseNum;
      if (entityId.includes("solar") || entityId.includes("pv")) {
        // Solar — sine wave peaking at noon, zero at night
        const angle = ((hr - 6) / 12) * Math.PI;
        num = hr >= 6 && hr <= 18 ? baseNum * Math.sin(angle) : 0;
      } else if (entityId.includes("battery_soc")) {
        // Battery SoC — slow ramp +/- 30% over the day
        num = Math.max(20, Math.min(100, baseNum + 25 * Math.sin((hr / 24) * 2 * Math.PI)));
      } else {
        // Default — ±10% jitter
        num = baseNum * (0.9 + Math.random() * 0.2);
      }
      stateValue = num.toFixed(1);
    }
    samples.push({
      entity_id: entityId,
      state: stateValue,
      attributes: ent.attributes,
      last_changed: date.toISOString(),
      last_updated: date.toISOString(),
    });
  }
  return samples;
}

// -----------------------------------------------------------------------
// WebSocket — minimal subscribe_events / get_states support
// -----------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url, "http://x").pathname === "/api/websocket") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wsClients.add(ws);
      ws.send(JSON.stringify({ type: "auth_required", ha_version: "2026.5.0-mock" }));

      ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === "auth") {
          ws.send(JSON.stringify({ type: "auth_ok", ha_version: "2026.5.0-mock" }));
        } else if (msg.type === "subscribe_events") {
          ws.send(JSON.stringify({ id: msg.id, type: "result", success: true }));
        } else if (msg.type === "get_states") {
          ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: entities }));
        } else if (msg.type === "get_services") {
          ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: {} }));
        } else if (msg.type === "get_config") {
          ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: { components: [] } }));
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ id: msg.id, type: "pong" }));
        } else {
          ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: null }));
        }
      });

      ws.on("close", () => wsClients.delete(ws));
    });
  } else {
    socket.destroy();
  }
});

function broadcastState(entity) {
  const evt = JSON.stringify({
    type: "event",
    event: {
      event_type: "state_changed",
      data: { entity_id: entity.entity_id, new_state: entity, old_state: entity },
      time_fired: new Date().toISOString(),
    },
  });
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(evt);
  }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mock HA listening on :${PORT} (${entities.length} entities)`);
});
