import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import {
  callHaService, getHaState, getHaStates, haServiceUrl, haStateUrl, haStatesUrl, HA_STATES_MAX_BYTES, type HaState,
} from "../src/lib/home/ha-client";
import { CatalogueUnavailable, HomeUnavailable, HomeUpstreamError } from "../src/lib/home/errors";
import type { HomeAssistantSettings } from "../src/types/home-assistant";
import type { ActionRecord, ConfirmationRequest } from "../src/lib/home/devices";

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
  confirmations: ConfirmationRequest[];
  records: ActionRecord[];
  budgets: { familyId: string; tokenId: string }[];
}

function stubDeps(overrides: Partial<HomeDeps> = {}, opts: { serviceOk?: boolean } = {}) {
  const rec: Recorded = { catalogueList: [], catalogueOne: [], states: [], calls: [], confirmations: [], records: [], budgets: [] };
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
    requestConfirmation: async (request) => {
      rec.confirmations.push(request);
      return { requestId: "req-1", expiresAt: "2026-10-01T12:02:00.000Z" };
    },
    recordAction: async (record) => {
      rec.records.push(record);
    },
    familyHasPin: async () => true,
    confirmationBudget: async (familyId, tokenId) => {
      rec.budgets.push({ familyId, tokenId });
      return { ok: true };
    },
    // One device is read with getHaState. By default the stub answers it from
    // getHaStates — overrides included — so a test that makes the states
    // unreadable makes the single read unreadable too; rec.states records it.
    getHaState: async (familyId, entityId) => (await deps.getHaStates(familyId, [entityId])).get(entityId),
    ...overrides,
  };
  return { deps, rec };
}

const act = (entity: string, body: unknown, deps: HomeDeps) =>
  runHomeAction({ familyId: FAMILY, ...ACTOR, rawEntity: entity, body }, deps);

// ── pure helpers ────────────────────────────────────────────────────────────

test.describe("the entity in the path", () => {
  test("accepts a plain entity id; Next has already decoded the segment, so it is not decoded again", () => {
    expect(parseEntityParam("light.kitchen")).toBe("light.kitchen");
    // What arrives for a request to /home/devices/light%252Ekitchen: one decode, by Next.
    expect(parseEntityParam("light%2Ekitchen")).toBeNull();
  });

  test("Next decodes a dynamic segment exactly once (the reason for the above)", async () => {
    const { getRouteMatcher } = await import("next/dist/shared/lib/router/utils/route-matcher.js");
    const { getRouteRegex } = await import("next/dist/shared/lib/router/utils/route-regex.js");
    const match = getRouteMatcher(getRouteRegex("/api/integration/v1/home/devices/[entity]/actions"));
    const base = "/api/integration/v1/home/devices/";
    expect(match(`${base}light%2Ekitchen/actions`)).toEqual({ entity: "light.kitchen" });
    expect(match(`${base}light%252Ekitchen/actions`)).toEqual({ entity: "light%2Ekitchen" });
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

  test("each key keeps its own type: numbers stay numbers, text stays text, null is null", () => {
    const out = whitelistAttributes({
      brightness: "255",
      current_temperature: null,
      temperature: Infinity,
      volume_level: true,
      current_position: 40,
      percentage: [50],
      humidity: { value: 40 },
      friendly_name: 7,
      unit_of_measurement: null,
      device_class: false,
      hvac_mode: "heat",
      media_title: ["a"],
    });
    expect(out).toEqual({ current_temperature: null, current_position: 40, unit_of_measurement: null, hvac_mode: "heat" });
  });

  test("hvac_modes: at most 10 strings of at most 32 characters, and never null or a string", () => {
    const many = Array.from({ length: 15 }, (_, i) => `mode_${i}`);
    expect(whitelistAttributes({ hvac_modes: many }).hvac_modes).toEqual(many.slice(0, 10));
    expect(whitelistAttributes({ hvac_modes: ["x".repeat(100)] }).hvac_modes).toEqual(["x".repeat(32)]);
    expect(whitelistAttributes({ hvac_modes: null })).toEqual({});
    expect(whitelistAttributes({ hvac_modes: "heat" })).toEqual({});
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
    expect(res.status).toBe(202);
    expect(rec.calls).toEqual([]);
  });

  test("sensitive actions do not run: garage, unclassified cover, lock — they wait for a person", async () => {
    for (const [entity, service] of [
      ["cover.garage", "open_cover"],
      ["cover.mystery", "close_cover"],
      ["lock.front_door", "unlock"],
    ] as const) {
      const { deps, rec } = stubDeps();
      const res = await act(entity, { service }, deps);
      expect([res.status, res.body.status], entity).toEqual([202, "pending_confirmation"]);
      expect(rec.calls).toEqual([]);
      expect(rec.confirmations).toHaveLength(1);
      // Not attributed as run: the request row is its record.
      expect(rec.records).toEqual([]);
    }
  });

  test("a sensitive action is stored as requested, with the household's name and room, and not run", async () => {
    const { deps, rec } = stubDeps();
    const res = await act("lock.front_door", { service: "unlock" }, deps);
    expect(res).toEqual({
      status: 202,
      body: { status: "pending_confirmation", request_id: "req-1", expires_at: "2026-10-01T12:02:00.000Z" },
    });
    expect(rec.confirmations).toEqual([{
      familyId: FAMILY, tokenId: "tok-1", tokenName: "Claude",
      entityId: "lock.front_door", entityName: "Front door", room: "Hall",
      domain: "lock", service: "unlock", data: {},
    }]);
    expect(rec.calls).toEqual([]);
  });

  test("a sensitive action in a family with no settings PIN is refused at once — no request nobody could allow", async () => {
    const { deps, rec } = stubDeps({ familyHasPin: async () => false });
    const res = await act("lock.front_door", { service: "unlock" }, deps);
    expect([res.status, res.body.code, res.body.reason]).toEqual([403, "forbidden", "pin_required"]);
    expect(String(res.body.error)).toContain("Set a settings PIN in Kinboard");
    expect(rec.confirmations).toEqual([]);
    expect(rec.calls).toEqual([]);
  });

  test("an unreadable PIN state refuses the sensitive action (503) and stores nothing", async () => {
    const { deps, rec } = stubDeps({ familyHasPin: async () => { throw new Error("db down"); } });
    const res = await act("cover.garage", { service: "open_cover" }, deps);
    expect([res.status, res.body.code]).toEqual([503, "unavailable"]);
    expect(rec.confirmations).toEqual([]);
    expect(rec.calls).toEqual([]);
  });

  test("ruling 9: past the confirmation budget a sensitive action is refused 429 before anything is stored or pushed", async () => {
    const { deps, rec } = stubDeps({ confirmationBudget: async () => ({ ok: false, retryAfterMs: 61_500 }) });
    const res = await act("lock.front_door", { service: "unlock" }, deps);
    expect([res.status, res.body.code]).toEqual([429, "rate_limited"]);
    expect(res.headers).toEqual({ "retry-after": "62" });
    expect(rec.confirmations).toEqual([]);
    expect(rec.calls).toEqual([]);
  });

  test("ruling 9: the budget is asked for the acting token, and only for a sensitive action", async () => {
    const { deps, rec } = stubDeps();
    await act("lock.front_door", { service: "unlock" }, deps);
    expect(rec.budgets).toEqual([{ familyId: FAMILY, tokenId: "tok-1" }]);
    const plain = stubDeps();
    await act("light.kitchen", { service: "toggle" }, plain.deps);
    expect(plain.rec.budgets).toEqual([]);
  });

  test("ruling 9: an unreadable budget refuses (503) and stores nothing", async () => {
    const { deps, rec } = stubDeps({ confirmationBudget: async () => { throw new Error("db down"); } });
    const res = await act("lock.front_door", { service: "unlock" }, deps);
    expect([res.status, res.body.code]).toEqual([503, "unavailable"]);
    expect(rec.confirmations).toEqual([]);
  });

  test("the PIN is not asked about for a non-sensitive action", async () => {
    const { deps, rec } = stubDeps({ familyHasPin: async () => false });
    const res = await act("light.kitchen", { service: "toggle" }, deps);
    expect(res.status).toBe(200);
    expect(rec.calls).toHaveLength(1);
  });

  test("every action that ran is recorded against the assistant, done or failed, with only the status", async () => {
    for (const [serviceOk, ok, status] of [[true, true, 200], [false, false, 500]] as const) {
      const { deps, rec } = stubDeps({}, { serviceOk });
      await act("light.kitchen", { service: "turn_on", data: { brightness_pct: 40 } }, deps);
      expect(rec.records).toEqual([{
        familyId: FAMILY, tokenId: "tok-1", tokenName: "Claude",
        entityId: "light.kitchen", entityName: "Kitchen light", domain: "light", service: "turn_on",
        data: { brightness_pct: 40 }, ok, status,
      }]);
    }
  });

  test("a failure to record does not fail an action that already ran", async () => {
    const { deps, rec } = stubDeps({ recordAction: async () => { throw new Error("db down"); } });
    const res = await act("light.kitchen", { service: "toggle" }, deps);
    expect(res).toEqual({ status: 200, body: { status: "done" } });
    expect(rec.calls).toHaveLength(1);
  });

  test("nothing is recorded when nothing was sent: refused, unreadable state, or not connected", async () => {
    const refused = stubDeps();
    await act("light.kitchen", { service: "explode" }, refused.deps);
    const noState = stubDeps({ getHaStates: async () => new Map<string, HaState>() });
    await act("light.kitchen", { service: "toggle" }, noState.deps);
    const disconnected = stubDeps({ callHaService: async () => { throw new HomeUnavailable(); } });
    await act("light.kitchen", { service: "toggle" }, disconnected.deps);
    for (const { rec } of [refused, noState, disconnected]) expect(rec.records).toEqual([]);
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

test.describe("one device's state (getHaState)", () => {
  test("GET /api/states/{encoded id} with the token, no redirects, a timeout", async () => {
    const { io, fetches } = stubIo(() => Response.json(STATES[0]));
    expect(await getHaState(FAMILY, "light.kitchen", io)).toMatchObject({ entity_id: "light.kitchen", state: "on" });
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("http://ha.local:8123/api/states/light.kitchen");
    expect(fetches[0].init.redirect).toBe("error");
    expect(fetches[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(fetches[0].init.headers).get("authorization")).toBe("Bearer ha-secret-token");
    expect(haStateUrl(new URL("http://ha.local:8123/p/"), "a/../b?c").href).toBe("http://ha.local:8123/p/api/states/a%2F..%2Fb%3Fc");
  });

  test("404 is 'no such entity' (undefined); other failures, or an answer about another entity, are HomeUpstreamError", async () => {
    expect(await getHaState(FAMILY, "light.kitchen", stubIo(() => new Response("{}", { status: 404 })).io)).toBeUndefined();
    for (const respond of [
      () => new Response("nope", { status: 500 }),
      () => { throw new TypeError("fetch failed"); },
      () => Response.json([STATES[0]]),
      () => Response.json({ ...STATES[0], entity_id: "lock.front_door" }),
      () => new Response("<html>", { status: 200 }),
    ]) {
      const err = await getHaState(FAMILY, "light.kitchen", stubIo(respond).io).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HomeUpstreamError);
      expect(String((err as Error).message)).not.toContain("ha-secret-token");
    }
  });

  test("reading or acting on one device never fetches the whole list", async () => {
    const { deps, rec } = stubDeps({ getHaStates: async () => { throw new Error("the full list was fetched"); } });
    const single = async (_f: string, id: string) => STATES.find((st) => st.entity_id === id);
    deps.getHaState = single;
    expect((await getHomeDevice(FAMILY, "climate.hall", deps)).status).toBe(200);
    expect((await act("light.kitchen", { service: "toggle" }, deps)).status).toBe(200);
    expect(rec.calls).toHaveLength(1);
  });
});

test.describe("the full state list is bounded", () => {
  test("a large install's list (over 2 MiB) is read, for the catalogue and the vehicles alike", async () => {
    expect(HA_STATES_MAX_BYTES).toBe(16 * 1024 * 1024);
    const filler = { entity_id: "sensor.filler", state: "1", attributes: { blob: "x".repeat(3 * 1024 * 1024) } };
    const body = JSON.stringify([{ entity_id: "light.kitchen", state: "on", attributes: {} }, filler]);
    const { io } = stubIo(() => new Response(body, { headers: { "content-length": String(body.length) } }));
    const states = await getHaStates(FAMILY, ["light.kitchen"], io);
    expect(states.get("light.kitchen")?.state).toBe("on");
    // Both read paths go through getHaStates and its one cap, with no override.
    for (const file of ["../src/lib/home/live.ts", "../src/app/api/integration/v1/vehicles/route.ts", "../src/lib/integration-energy-status.ts"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src, file).toMatch(/getHaStates\(familyId, (entityIds|\[\.\.\.new Set\(ids\.values\(\)\)\]), io\)|getHaStates\(familyId, entityIds\)/);
    }
  });

  test(`an answer over ${HA_STATES_MAX_BYTES} bytes is refused, announced or not`, async () => {
    const big = "x".repeat(HA_STATES_MAX_BYTES + 10);
    const announced = stubIo(() => new Response(JSON.stringify([big]), { headers: { "content-length": String(big.length + 4) } }));
    expect(await getHaStates(FAMILY, ["light.kitchen"], announced.io).catch((e: unknown) => e)).toBeInstanceOf(HomeUpstreamError);
    const streamed = stubIo(() => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(`["${big}"]`)); c.close(); },
    })));
    expect(await getHaStates(FAMILY, ["light.kitchen"], streamed.io).catch((e: unknown) => e)).toBeInstanceOf(HomeUpstreamError);
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
