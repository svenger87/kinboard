import { test, expect } from "@playwright/test";
import {
  ATTRIBUTE_WHITELIST,
  getHomeDevice,
  listHomeDevices,
  parseEntityParam,
  runHomeAction,
  whitelistAttributes,
  type HomeDeps,
} from "../src/lib/home/devices";
import { toCatalogueEntities, type CatalogueEntity } from "../src/lib/home/catalogue";
import { callHaService, getHaStates, haServiceUrl, haStatesUrl, type HaState } from "../src/lib/home/ha-client";
import { CatalogueUnavailable, HomeUnavailable, HomeUpstreamError } from "../src/lib/home/errors";
import type { HomeAssistantSettings } from "../src/types/home-assistant";

/**
 * The home routes (RFC-011 §3/§4): what an assistant can see of a household's
 * devices, and which of its requests reach Home Assistant.
 *
 * The routes are thin wrappers around `lib/home/devices.ts`, which takes its
 * catalogue and Home Assistant access as injected dependencies — so every
 * branch of the decision flow is tested here against stubs that *count* what
 * they were asked, and "never called Home Assistant" is an assertion, not an
 * assumption. The Home Assistant client is tested the same way with a stub
 * `fetch`. No stack; a live run against a mock Home Assistant is Task 11.
 */

const FAMILY = "11111111-1111-1111-1111-111111111111";
const ACTOR = { tokenId: "tok-1", tokenName: "Claude" };

// ── stubs ───────────────────────────────────────────────────────────────────

const CATALOGUE: CatalogueEntity[] = [
  { entityId: "light.kitchen", name: "Kitchen light", room: "Kitchen" },
  { entityId: "cover.living_blind", name: "Living room blind", room: "Living room" },
  { entityId: "cover.garage", name: "Garage", room: null },
  { entityId: "cover.mystery", name: "Unclassified cover", room: null },
  { entityId: "lock.front_door", name: "Front door", room: "Hall" },
  { entityId: "climate.hall", name: "Thermostat", room: "Hall" },
];

const STATES: HaState[] = [
  {
    entity_id: "light.kitchen",
    state: "on",
    attributes: { friendly_name: "Kitchen", brightness: 128, entity_picture: "/api/camera_proxy?token=secret", supported_features: 44 },
  },
  { entity_id: "cover.living_blind", state: "open", attributes: { device_class: "blind", current_position: 100 } },
  { entity_id: "cover.garage", state: "closed", attributes: { device_class: "garage" } },
  { entity_id: "cover.mystery", state: "closed", attributes: {} },
  { entity_id: "lock.front_door", state: "locked", attributes: { code_format: "^\\d{4}$", changed_by: "Mum" } },
  { entity_id: "climate.hall", state: "heat", attributes: { current_temperature: 20.5, temperature: 21, hvac_modes: ["off", "heat"] } },
  // In Home Assistant but not in this family's catalogue.
  { entity_id: "lock.back_door", state: "unlocked", attributes: {} },
];

interface Recorded {
  catalogueList: string[];
  catalogueOne: { familyId: string; entityId: string }[];
  states: { familyId: string; ids: string[] }[];
  calls: { familyId: string; domain: string; service: string; entityId: string; data: Record<string, unknown> }[];
  confirmations: unknown[];
}

function stubDeps(overrides: Partial<HomeDeps> = {}, opts: { serviceOk?: boolean } = {}) {
  const rec: Recorded = { catalogueList: [], catalogueOne: [], states: [], calls: [], confirmations: [] };
  const deps: HomeDeps = {
    catalogueEntities: async (familyId) => {
      rec.catalogueList.push(familyId);
      return CATALOGUE;
    },
    catalogueEntity: async (familyId, entityId) => {
      rec.catalogueOne.push({ familyId, entityId });
      return CATALOGUE.find((c) => c.entityId === entityId) ?? null;
    },
    getHaStates: async (familyId, ids) => {
      rec.states.push({ familyId, ids: [...ids] });
      return new Map(STATES.filter((s) => ids.includes(s.entity_id)).map((s) => [s.entity_id, s]));
    },
    callHaService: async (familyId, domain, service, entityId, data) => {
      rec.calls.push({ familyId, domain, service, entityId, data });
      return opts.serviceOk === false ? { ok: false, status: 500 } : { ok: true, status: 200 };
    },
    ...overrides,
  };
  return { deps, rec };
}

const act = (entity: string, body: unknown, deps: HomeDeps) =>
  runHomeAction({ familyId: FAMILY, ...ACTOR, rawEntity: entity, body }, deps);

// ── pure helpers ────────────────────────────────────────────────────────────

test.describe("the entity in the path", () => {
  test("accepts a plain entity id and its percent-encoded form", () => {
    expect(parseEntityParam("light.kitchen")).toBe("light.kitchen");
    expect(parseEntityParam("light%2Ekitchen")).toBe("light.kitchen");
  });

  test("refuses anything that is not an entity id, including malformed escapes", () => {
    for (const raw of [
      "", "light", "Light.Kitchen", "light.kitchen/../x", "light.kitchen%2F..", "%E0%A4%A",
      "light.kitchen ", "homeassistant", `light.${"a".repeat(300)}`, "light.kitchen\n",
    ]) {
      expect(parseEntityParam(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

test.describe("the catalogue", () => {
  test("keeps only this family's Home Assistant entities, and rooms of this family", () => {
    const rows = [
      { family_id: FAMILY, kind: "ha_entity", entity_id: "light.kitchen", name: "Kitchen", rooms: { name: "Kitchen", family_id: FAMILY } },
      { family_id: FAMILY, kind: "builtin", entity_id: null, name: "Clock", rooms: null },
      { family_id: "other", kind: "ha_entity", entity_id: "lock.theirs", name: "Theirs", rooms: null },
      { family_id: FAMILY, kind: "ha_entity", entity_id: "Not An Entity", name: "Bad", rooms: null },
      { family_id: FAMILY, kind: "ha_entity", entity_id: "switch.fan", name: "Fan", rooms: { name: "Somebody else's room", family_id: "other" } },
      { family_id: FAMILY, kind: "ha_entity", entity_id: "switch.tv", name: "TV", rooms: null },
    ];
    expect(toCatalogueEntities(rows, FAMILY)).toEqual([
      { entityId: "light.kitchen", name: "Kitchen", room: "Kitchen" },
      { entityId: "switch.fan", name: "Fan", room: null },
      { entityId: "switch.tv", name: "TV", room: null },
    ]);
  });

  test("tolerates a non-array answer by returning nothing", () => {
    expect(toCatalogueEntities(null, FAMILY)).toEqual([]);
  });
});

test.describe("attributes", () => {
  test("only whitelisted keys leave the server", () => {
    const out = whitelistAttributes({
      friendly_name: "Kitchen",
      brightness: 128,
      access_token: "abc",
      entity_picture: "/api/camera_proxy/camera.door?token=secret",
      code_format: "^\\d{4}$",
      changed_by: "Mum",
      latitude: 52.1,
      supported_features: 44,
    });
    expect(out).toEqual({ friendly_name: "Kitchen", brightness: 128 });
  });

  test("objects and long strings are dropped or bounded, hvac_modes stays a short list of strings", () => {
    const out = whitelistAttributes({
      friendly_name: { nested: "x" },
      media_title: "x".repeat(1000),
      hvac_modes: ["off", "heat", 7, { x: 1 }],
      temperature: Number.NaN,
      volume_level: 0.4,
    });
    expect(out.friendly_name).toBeUndefined();
    expect((out.media_title as string).length).toBe(200);
    expect(out.hvac_modes).toEqual(["off", "heat"]);
    expect(out.temperature).toBeUndefined();
    expect(out.volume_level).toBe(0.4);
  });

  test("the whitelist is exactly the documented one", () => {
    expect([...ATTRIBUTE_WHITELIST].sort()).toEqual([
      "brightness", "current_position", "current_temperature", "device_class", "friendly_name",
      "humidity", "hvac_mode", "hvac_modes", "media_title", "percentage", "temperature",
      "unit_of_measurement", "volume_level",
    ]);
  });
});

// ── reading ─────────────────────────────────────────────────────────────────

test.describe("GET /home/devices", () => {
  test("lists catalogue devices with whitelisted state and the actions allowed for each", async () => {
    const { deps, rec } = stubDeps();
    const res = await listHomeDevices(FAMILY, deps);
    expect(res.status).toBe(200);
    const devices = res.body.devices as Record<string, unknown>[];
    expect(devices.map((d) => d.entity_id)).toEqual(CATALOGUE.map((c) => c.entityId));
    // One state read, for exactly the catalogue's entities.
    expect(rec.states).toEqual([{ familyId: FAMILY, ids: CATALOGUE.map((c) => c.entityId) }]);

    const light = devices[0];
    expect(light).toMatchObject({ entity_id: "light.kitchen", name: "Kitchen light", room: "Kitchen", state: "on" });
    expect(light.attributes).toEqual({ friendly_name: "Kitchen", brightness: 128 });
    expect(light.allowed_actions).toContainEqual({ service: "turn_on", sensitive: false });

    // device_class is read live: the blind moves freely, the garage and the unclassified cover ask.
    const actions = (id: string) => (devices.find((d) => d.entity_id === id)!.allowed_actions as { sensitive: boolean }[]);
    expect(actions("cover.living_blind").every((a) => !a.sensitive)).toBe(true);
    expect(actions("cover.garage").every((a) => a.sensitive)).toBe(true);
    expect(actions("cover.mystery").every((a) => a.sensitive)).toBe(true);
    expect(actions("lock.front_door").every((a) => a.sensitive)).toBe(true);
    // The lock's code format and who unlocked it last are not whitelisted.
    expect(devices.find((d) => d.entity_id === "lock.front_door")!.attributes).toEqual({});
  });

  test("never mentions an entity outside the catalogue", async () => {
    const { deps } = stubDeps();
    const res = await listHomeDevices(FAMILY, deps);
    expect(JSON.stringify(res.body)).not.toContain("lock.back_door");
  });

  test("a catalogue device Home Assistant no longer reports has a null state", async () => {
    const { deps } = stubDeps({ getHaStates: async () => new Map() });
    const res = await listHomeDevices(FAMILY, deps);
    const first = (res.body.devices as Record<string, unknown>[])[0];
    expect(first).toMatchObject({ entity_id: "light.kitchen", state: null, attributes: {} });
  });

  test("an empty catalogue answers without contacting Home Assistant", async () => {
    const { deps, rec } = stubDeps({ catalogueEntities: async () => [] });
    const res = await listHomeDevices(FAMILY, deps);
    expect(res).toEqual({ status: 200, body: { devices: [] } });
    expect(rec.states).toEqual([]);
  });

  test("Home Assistant not connected is 503, unreachable is 502, catalogue unreadable is 503", async () => {
    const notConnected = stubDeps({ getHaStates: async () => { throw new HomeUnavailable(); } });
    expect((await listHomeDevices(FAMILY, notConnected.deps)).body.code).toBe("unavailable");
    expect((await listHomeDevices(FAMILY, notConnected.deps)).status).toBe(503);

    const down = stubDeps({ getHaStates: async () => { throw new HomeUpstreamError(); } });
    const r2 = await listHomeDevices(FAMILY, down.deps);
    expect([r2.status, r2.body.code]).toEqual([502, "upstream_unavailable"]);

    const noCatalogue = stubDeps({ catalogueEntities: async () => { throw new CatalogueUnavailable(); } });
    const r3 = await listHomeDevices(FAMILY, noCatalogue.deps);
    expect([r3.status, r3.body.code]).toEqual([503, "unavailable"]);
    expect(noCatalogue.rec.states).toEqual([]);
  });

  test("an unexpected failure is not swallowed into a success", async () => {
    const { deps } = stubDeps({ getHaStates: async () => { throw new Error("boom"); } });
    await expect(listHomeDevices(FAMILY, deps)).rejects.toThrow("boom");
  });
});

test.describe("GET /home/devices/{entity}", () => {
  test("reads one catalogue device, asking Home Assistant for that entity only", async () => {
    const { deps, rec } = stubDeps();
    const res = await getHomeDevice(FAMILY, "climate.hall", deps);
    expect(res.status).toBe(200);
    expect(res.body.device).toMatchObject({
      entity_id: "climate.hall", name: "Thermostat", room: "Hall", state: "heat",
      attributes: { current_temperature: 20.5, temperature: 21, hvac_modes: ["off", "heat"] },
    });
    expect(rec.catalogueOne).toEqual([{ familyId: FAMILY, entityId: "climate.hall" }]);
    expect(rec.states).toEqual([{ familyId: FAMILY, ids: ["climate.hall"] }]);
  });

  test("an entity outside the catalogue is 404, and its state is never fetched", async () => {
    const { deps, rec } = stubDeps();
    const res = await getHomeDevice(FAMILY, "lock.back_door", deps);
    expect([res.status, res.body.code]).toEqual([404, "not_found"]);
    expect(rec.states).toEqual([]);
  });

  test("a malformed entity is the same 404, without even a catalogue lookup", async () => {
    const { deps, rec } = stubDeps();
    const missing = await getHomeDevice(FAMILY, "lock.back_door", stubDeps().deps);
    const res = await getHomeDevice(FAMILY, "../../api/config", deps);
    expect(res).toEqual(missing);
    expect(rec.catalogueOne).toEqual([]);
    expect(rec.states).toEqual([]);
  });
});

// ── acting ──────────────────────────────────────────────────────────────────

test.describe("POST /home/devices/{entity}/actions", () => {
  test("a non-sensitive action calls Home Assistant once, with exactly the entity and the validated data", async () => {
    const { deps, rec } = stubDeps();
    const res = await act("light.kitchen", { service: "turn_on", data: { brightness_pct: 40 } }, deps);
    expect(res).toEqual({ status: 200, body: { status: "done" } });
    expect(rec.calls).toEqual([{
      familyId: FAMILY, domain: "light", service: "turn_on", entityId: "light.kitchen", data: { brightness_pct: 40 },
    }]);
  });

  test("a blind (device_class read live) moves without asking", async () => {
    const { deps, rec } = stubDeps();
    const res = await act("cover.living_blind", { service: "set_cover_position", data: { position: 30 } }, deps);
    expect(res.status).toBe(200);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).toMatchObject({ domain: "cover", service: "set_cover_position", data: { position: 30 } });
  });

  test("a refused action never reaches Home Assistant — not even a state read", async () => {
    for (const body of [
      { service: "unlock_everything" },
      { service: "homeassistant.restart" },
      { service: "turn_on", data: { brightness_pct: 400 } },
      { service: "turn_on", data: { entity_id: "lock.back_door" } },
      { service: "turn_on", data: { transition: 2 } },
      { service: "turn_on", data: "bright" },
    ]) {
      const { deps, rec } = stubDeps();
      const res = await act("light.kitchen", body, deps);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(["not_allowed", "invalid_data"]).toContain(res.body.reason);
      expect(rec.states).toEqual([]);
      expect(rec.calls).toEqual([]);
    }
  });

  test("a body without a service is 400 and touches nothing", async () => {
    for (const body of [{}, { service: 3 }, null, [], "turn_on"]) {
      const { deps, rec } = stubDeps();
      const res = await act("light.kitchen", body, deps);
      expect([res.status, res.body.code]).toEqual([400, "invalid_request"]);
      expect(rec.catalogueOne).toEqual([]);
      expect(rec.calls).toEqual([]);
    }
  });

  test("an entity outside the catalogue is 404 — no state read, no call", async () => {
    const { deps, rec } = stubDeps();
    const res = await act("lock.back_door", { service: "unlock" }, deps);
    expect([res.status, res.body.code]).toEqual([404, "not_found"]);
    expect(rec.states).toEqual([]);
    expect(rec.calls).toEqual([]);
    // Indistinguishable from an entity that does not exist anywhere.
    expect(await act("lock.nowhere", { service: "unlock" }, stubDeps().deps)).toEqual(res);
  });

  test("a cover whose state cannot be read is 503 and nothing moves", async () => {
    for (const getHaStates of [
      async () => { throw new HomeUpstreamError(); },
      async () => { throw new HomeUnavailable(); },
      async () => new Map<string, HaState>(),
    ]) {
      const { deps, rec } = stubDeps({ getHaStates });
      const res = await act("cover.living_blind", { service: "open_cover" }, deps);
      expect([res.status, res.body.code]).toEqual([503, "unavailable"]);
      expect(rec.calls).toEqual([]);
    }
  });

  test("the same holds for every other domain: no state, no call", async () => {
    const { deps, rec } = stubDeps({ getHaStates: async () => { throw new HomeUpstreamError(); } });
    const res = await act("light.kitchen", { service: "turn_off" }, deps);
    expect(res.status).toBe(503);
    expect(rec.calls).toEqual([]);
  });

  test("a device_class from the caller is never trusted", async () => {
    const { deps, rec } = stubDeps();
    const res = await act("cover.garage", { service: "open_cover", device_class: "blind", data: {} }, deps);
    expect(res.status).toBe(501);
    expect(rec.calls).toEqual([]);
  });

  test("sensitive actions do not run: garage, unclassified cover, lock", async () => {
    for (const [entity, service] of [
      ["cover.garage", "open_cover"],
      ["cover.mystery", "close_cover"],
      ["lock.front_door", "unlock"],
    ] as const) {
      const { deps, rec } = stubDeps();
      const res = await act(entity, { service }, deps);
      expect([res.status, res.body.code], entity).toEqual([501, "not_implemented"]);
      expect(rec.calls).toEqual([]);
    }
  });

  test("with a confirmation seam, a sensitive action is stored as requested and still not run", async () => {
    const requests: unknown[] = [];
    const { deps, rec } = stubDeps({
      requestConfirmation: async (req) => {
        requests.push(req);
        return { requestId: "req-1", expiresAt: "2026-10-01T12:02:00.000Z" };
      },
    });
    const res = await act("lock.front_door", { service: "unlock" }, deps);
    expect(res).toEqual({
      status: 202,
      body: { status: "pending_confirmation", request_id: "req-1", expires_at: "2026-10-01T12:02:00.000Z" },
    });
    expect(requests).toEqual([{
      familyId: FAMILY, tokenId: "tok-1", tokenName: "Claude",
      entityId: "lock.front_door", domain: "lock", service: "unlock", data: {},
    }]);
    expect(rec.calls).toEqual([]);
  });

  test("Home Assistant refusing or failing the call is 502", async () => {
    const { deps, rec } = stubDeps({}, { serviceOk: false });
    const res = await act("light.kitchen", { service: "toggle" }, deps);
    expect([res.status, res.body.code]).toEqual([502, "upstream_unavailable"]);
    expect(rec.calls).toHaveLength(1);
  });

  test("Home Assistant disconnected between the read and the call is 503", async () => {
    const { deps } = stubDeps({ callHaService: async () => { throw new HomeUnavailable(); } });
    const res = await act("light.kitchen", { service: "toggle" }, deps);
    expect([res.status, res.body.code]).toEqual([503, "unavailable"]);
  });
});

// ── the Home Assistant client ───────────────────────────────────────────────

const SETTINGS = { url: "http://ha.local:8123", access_token: "ha-secret-token" } as HomeAssistantSettings;

function stubIo(respond: (url: string, init: RequestInit) => Response | Promise<Response>, settings: HomeAssistantSettings | null = SETTINGS) {
  const fetches: { url: string; init: RequestInit }[] = [];
  return {
    fetches,
    io: {
      loadSettings: async () => settings,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        fetches.push({ url, init: init ?? {} });
        return respond(url, init ?? {});
      }) as typeof fetch,
    },
  };
}

test.describe("Home Assistant URLs", () => {
  test("domain and service are percent-encoded path segments under the configured base", () => {
    const base = new URL("http://ha.local:8123/proxy/");
    expect(haServiceUrl(base, "light", "turn_on").href).toBe("http://ha.local:8123/proxy/api/services/light/turn_on");
    expect(haServiceUrl(base, "a/../b", "x?y#z").href).toBe("http://ha.local:8123/proxy/api/services/a%2F..%2Fb/x%3Fy%23z");
    expect(haStatesUrl(new URL("http://ha.local:8123")).href).toBe("http://ha.local:8123/api/states");
  });
});

test.describe("getHaStates", () => {
  test("one GET /api/states with the token, no redirects, a timeout — and only the asked-for entities back", async () => {
    const { io, fetches } = stubIo(() => Response.json(STATES));
    const states = await getHaStates(FAMILY, ["light.kitchen", "cover.garage"], io);
    expect([...states.keys()]).toEqual(["light.kitchen", "cover.garage"]);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("http://ha.local:8123/api/states");
    expect(fetches[0].init.redirect).toBe("error");
    expect(fetches[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(fetches[0].init.headers).get("authorization")).toBe("Bearer ha-secret-token");
  });

  test("not configured, or an address we would not send a token to, throws before any request", async () => {
    for (const settings of [
      null,
      { url: "", access_token: "t" },
      { url: "http://ha.local:8123", access_token: "" },
      { url: "ftp://ha.local", access_token: "t" },
      { url: "http://user:pw@ha.local", access_token: "t" },
      { url: "not a url", access_token: "t" },
    ]) {
      const { io, fetches } = stubIo(() => Response.json([]), settings as HomeAssistantSettings | null);
      await expect(getHaStates(FAMILY, ["light.kitchen"], io)).rejects.toBeInstanceOf(HomeUnavailable);
      expect(fetches).toEqual([]);
    }
  });

  test("an error status, a network failure, or a non-list answer is HomeUpstreamError — and never carries the token", async () => {
    for (const respond of [
      () => new Response("nope", { status: 401 }),
      () => { throw new TypeError("fetch failed"); },
      () => Response.json({ message: "hi" }),
      () => new Response("<html>", { status: 200 }),
    ]) {
      const { io } = stubIo(respond);
      const err = await getHaStates(FAMILY, ["light.kitchen"], io).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HomeUpstreamError);
      expect(String((err as Error).message)).not.toContain("ha-secret-token");
    }
  });

  test("malformed state entries are skipped, missing attributes become {}", async () => {
    const { io } = stubIo(() => Response.json([
      { entity_id: "light.kitchen", state: "on" },
      { entity_id: "cover.garage", state: 7, attributes: {} },
      "junk",
    ]));
    const states = await getHaStates(FAMILY, ["light.kitchen", "cover.garage"], io);
    expect(states.get("light.kitchen")).toEqual({ entity_id: "light.kitchen", state: "on", attributes: {} });
    expect(states.has("cover.garage")).toBe(false);
  });
});

test.describe("callHaService", () => {
  test("POSTs exactly {entity_id, ...data} to the encoded service URL, once", async () => {
    const { io, fetches } = stubIo(() => Response.json([]));
    const res = await callHaService(FAMILY, "light", "turn_on", "light.kitchen", { brightness_pct: 40 }, io);
    expect(res).toEqual({ ok: true, status: 200 });
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("http://ha.local:8123/api/services/light/turn_on");
    expect(fetches[0].init.method).toBe("POST");
    expect(fetches[0].init.redirect).toBe("error");
    expect(fetches[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(fetches[0].init.body))).toEqual({ entity_id: "light.kitchen", brightness_pct: 40 });
  });

  test("the entity id cannot be overridden by data", async () => {
    const { io, fetches } = stubIo(() => Response.json([]));
    await callHaService(FAMILY, "light", "turn_on", "light.kitchen", { entity_id: "lock.back_door" }, io);
    expect(JSON.parse(String(fetches[0].init.body)).entity_id).toBe("light.kitchen");
  });

  test("an error status or a network failure is ok: false", async () => {
    const failing = stubIo(() => new Response("bad", { status: 400 }));
    expect(await callHaService(FAMILY, "light", "turn_on", "light.kitchen", {}, failing.io)).toEqual({ ok: false, status: 400 });
    const offline = stubIo(() => { throw new TypeError("fetch failed"); });
    expect(await callHaService(FAMILY, "light", "turn_on", "light.kitchen", {}, offline.io)).toEqual({ ok: false, status: 0 });
  });

  test("not configured throws before any request", async () => {
    const { io, fetches } = stubIo(() => Response.json([]), null);
    await expect(callHaService(FAMILY, "light", "turn_on", "light.kitchen", {}, io)).rejects.toBeInstanceOf(HomeUnavailable);
    expect(fetches).toEqual([]);
  });
});
