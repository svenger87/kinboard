import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { createAdminClient } from "../src/lib/supabase/server";
import { SESSION_COOKIE } from "../src/lib/session";
import { POST as createFamily } from "../src/app/api/session/create/route";
import { POST as pinRoute } from "../src/app/api/pin/route";
import { PUT as settingsPut } from "../src/app/api/settings/route";
import { GET as keysGet, PUT as keysPut, DELETE as keysDelete, POST as keysPost } from "../src/app/api/settings/keys/route";
import { GET as weatherGet } from "../src/app/api/weather/route";
import { GET as forecastGet } from "../src/app/api/weather/forecast/route";
import { GET as citiesGet } from "../src/app/api/cities/route";
import { GET as googleConfigured } from "../src/app/api/google/configured/route";
import { GET as googleAuth } from "../src/app/api/google/auth/route";
import { POST as presencePost } from "../src/app/api/presence/route";

/**
 * RFC-023 §4.4 end to end against a real database: two throwaway families,
 * A and B. A sets its own OpenWeatherMap key, Google client and presence
 * token behind its settings PIN; B sets nothing. The routes are called in
 * process with each family's real session cookie, and the weather provider
 * is a stub that records which key it was asked with.
 *
 * Needs a stack: SUPABASE_SERVICE_ROLE_KEY and POSTGREST_URL (or SUPABASE_URL),
 * e.g. the kbfresh stack's PostgREST on :3010 with `webapp/.env.local`
 * exported. Skipped without them. Every family it makes is deleted again
 * (sessions, devices and stored keys cascade), and its devices
 * (`claude-keys-*`) are swept by hardware id too.
 */

const HAS_STACK =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!(process.env.POSTGREST_URL || process.env.SUPABASE_URL);
test.skip(!HAS_STACK, "needs SUPABASE_SERVICE_ROLE_KEY and POSTGREST_URL for a running stack");
test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const ENV_WEATHER = "env-weather-key-000000000000";
const ENV_PRESENCE = "env-presence-token-0000000000000000";
const OWN_WEATHER = "own-weather-key-a1b2c3d4e5f6";
const OWN_ID = `claude-${STAMP}.apps.googleusercontent.com`;
const OWN_SECRET = "GOCSPX-claude-own-secret-9z8y";

interface Fam {
  id: string;
  device: string;
  cookie: string;
}
const made: string[] = [];
let A: Fam;
let B: Fam;
let db: any;
const envBefore: Record<string, string | undefined> = {};
const ENV_KEYS = ["OPENWEATHERMAP_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "PRESENCE_SENSOR_TOKEN", "OPENWEATHERMAP_BASE_URL", "OPENWEATHERMAP_GEO_URL"];

function req(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.98.${Math.floor(Math.random() * 250)}.1`,
      ...(init.cookie ? { cookie: `${SESSION_COOKIE}=${init.cookie}` } : {}),
    },
  });
}

async function family(name: string): Promise<Fam> {
  const res = await createFamily(
    req("/api/session/create", { method: "POST", body: { familyName: name, deviceName: name, hardwareId: name } }),
  );
  const json = await res.json();
  if (json.family?.id) made.push(json.family.id);
  expect(res.status, JSON.stringify(json)).toBe(200);
  const cookie = res.cookies.get(SESSION_COOKIE)?.value;
  expect(cookie).toBeTruthy();
  return { id: json.family.id, device: json.device.id, cookie: cookie! };
}

/** Upstream weather requests, by the key they carried; everything else goes to the real network (the database). */
const asked: string[] = [];
const realFetch = globalThis.fetch;

test.beforeAll(async () => {
  db = createAdminClient();
  for (const k of ENV_KEYS) envBefore[k] = process.env[k];
  process.env.OPENWEATHERMAP_API_KEY = ENV_WEATHER;
  process.env.PRESENCE_SENSOR_TOKEN = ENV_PRESENCE;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  process.env.OPENWEATHERMAP_BASE_URL = "https://owm.stub/data/2.5";
  process.env.OPENWEATHERMAP_GEO_URL = "https://owm.stub/geo/1.0";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    // The city search reads its base address at import, before this file
    // can set it, so the real provider's address is caught here too: no
    // request leaves this machine.
    if (!url.startsWith("https://owm.stub/") && !/^https:\/\/[a-z.]*openweathermap\.org\//.test(url)) return realFetch(input, init);
    asked.push(new URL(url).searchParams.get("appid") ?? "");
    const path = new URL(url).pathname;
    if (path.endsWith("/direct")) return new Response(JSON.stringify([{ name: "Hamburg", lat: 53.55, lon: 10, country: "DE" }]));
    if (path.endsWith("/air_pollution")) return new Response(JSON.stringify({ list: [{ main: { aqi: 1 } }] }));
    if (path.endsWith("/forecast")) return new Response(JSON.stringify({ list: [], city: { name: "Hamburg", coord: { lat: 53.55, lon: 10 }, timezone: 3600 } }));
    return new Response(JSON.stringify({
      dt: 1, coord: { lat: 53.55, lon: 10 }, main: { temp: 1, feels_like: 1, humidity: 1, temp_min: 1, temp_max: 1 },
      weather: [{ id: 800, main: "Clear", description: "", icon: "01d" }], wind: { speed: 1 }, visibility: 10000,
      sys: { sunrise: 1, sunset: 2 }, name: "Hamburg", timezone: 3600,
    }));
  }) as typeof fetch;

  A = await family(`claude-keys-a-${STAMP}`);
  B = await family(`claude-keys-b-${STAMP}`);
});

test.afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (envBefore[k] === undefined) delete process.env[k];
    else process.env[k] = envBefore[k];
  }
  if (!db) return;
  try {
    if (made.length) await db.from("families").delete().in("id", made);
    await db.from("families").delete().like("name", "claude-keys-%");
  } finally {
    await db.from("devices").delete().like("hardware_id", "claude-keys-%");
  }
});

async function weatherKeyFor(cookie: string | undefined): Promise<string> {
  asked.length = 0;
  const res = await weatherGet(req("/api/weather?city=Hamburg&lang=en&units=metric", { cookie }));
  expect(res.status).toBe(200);
  return asked[0];
}

test("a fresh family uses the server's keys, and is told so without a value", async () => {
  const res = await keysGet(req("/api/settings/keys", { cookie: A.cookie }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.keys).toEqual({
    openweathermap: { source: "environment", hint: null, environment: true },
    google_oauth_client: { source: "none", hint: null, environment: false },
    presence_sensor: { source: "environment", hint: null, environment: true },
  });
  expect(JSON.stringify(body)).not.toContain(ENV_WEATHER);
  expect(JSON.stringify(body)).not.toContain(ENV_PRESENCE);
  expect(await weatherKeyFor(A.cookie)).toBe(ENV_WEATHER);
});

test("with a PIN set, changing a key needs the settings unlock", async () => {
  const set = await pinRoute(req("/api/pin", { method: "POST", cookie: A.cookie, body: { family_id: A.id, action: "set", pin: "4826" } }));
  expect(set.status).toBe(200);
  // Choosing the PIN unlocked this device; end that, as fifteen minutes would.
  await db.from("device_sessions").update({ settings_unlocked_until: null }).eq("family_id", A.id);

  const put = await keysPut(req("/api/settings/keys", { method: "PUT", cookie: A.cookie, body: { key: "openweathermap", values: { api_key: OWN_WEATHER } } }));
  expect(put.status).toBe(403);
  expect((await put.json()).error).toBe("pin_required");
  const del = await keysDelete(req("/api/settings/keys", { method: "DELETE", cookie: A.cookie, body: { key: "openweathermap" } }));
  expect(del.status).toBe(403);
  const gen = await keysPost(req("/api/settings/keys", { method: "POST", cookie: A.cookie, body: { key: "presence_sensor", action: "generate" } }));
  expect(gen.status).toBe(403);
  const { count } = await db.from("integration_secrets").select("key", { count: "exact", head: true }).eq("family_id", A.id).in("key", ["openweathermap", "google_oauth_client", "presence_sensor"]);
  expect(count).toBe(0);

  const verify = await pinRoute(req("/api/pin", { method: "POST", cookie: A.cookie, body: { family_id: A.id, action: "verify", pin: "4826" } }));
  expect((await verify.json()).valid).toBe(true);
});

test("the generic settings route refuses the key names, even unlocked", async () => {
  for (const key of ["openweathermap", "google_oauth_client", "presence_sensor"]) {
    const res = await settingsPut(req("/api/settings", { method: "PUT", cookie: A.cookie, body: { family_id: A.id, key, value: { api_key: "x" } } }));
    expect(res.status, key).toBe(403);
    expect((await res.json()).error).toContain("/api/settings/keys");
  }
});

test("bad values are refused and nothing is stored", async () => {
  for (const [key, values, error] of [
    ["openweathermap", { api_key: "has space" }, "bad_value"],
    ["openweathermap", { api_key: "" }, "bad_value"],
    ["openweathermap", { api_key: "x".repeat(513) }, "bad_value"],
    ["google_oauth_client", { client_id: "only-the-id" }, "bad_value"],
    ["presence_sensor", { token: "short" }, "token_too_short"],
    ["not_a_key", { api_key: "abc" }, "bad_key"],
  ] as const) {
    const res = await keysPut(req("/api/settings/keys", { method: "PUT", cookie: A.cookie, body: { key, values } }));
    expect(res.status, `${key} ${JSON.stringify(values)}`).toBe(400);
    expect((await res.json()).error).toBe(error);
  }
  const { count } = await db.from("integration_secrets").select("key", { count: "exact", head: true }).eq("family_id", A.id).in("key", ["openweathermap", "google_oauth_client", "presence_sensor"]);
  expect(count).toBe(0);
});

test("A's own keys: stored server-side, shown masked, used by A only", async () => {
  // A body naming another family changes nothing about which family is written.
  const put = await keysPut(req("/api/settings/keys", { method: "PUT", cookie: A.cookie, body: { key: "openweathermap", family_id: B.id, values: { api_key: OWN_WEATHER } } }));
  expect(put.status).toBe(200);
  const body = await put.json();
  expect(body.keys.openweathermap).toEqual({ source: "family", hint: "…e5f6", environment: true });
  expect(JSON.stringify(body)).not.toContain(OWN_WEATHER);

  const google = await keysPut(req("/api/settings/keys", { method: "PUT", cookie: A.cookie, body: { key: "google_oauth_client", values: { client_id: OWN_ID, client_secret: OWN_SECRET } } }));
  expect(google.status).toBe(200);
  const gBody = await google.json();
  expect(gBody.keys.google_oauth_client).toEqual({ source: "family", hint: "…9z8y", environment: false });
  expect(JSON.stringify(gBody)).not.toContain(OWN_SECRET);
  expect(JSON.stringify(gBody)).not.toContain(OWN_ID);

  // In integration_secrets, not in the browser-readable settings table.
  const { data: secret } = await db.from("integration_secrets").select("value").eq("family_id", A.id).eq("key", "openweathermap").single();
  expect(secret.value).toEqual({ api_key: OWN_WEATHER });
  const { count: leaked } = await db.from("settings").select("key", { count: "exact", head: true }).in("family_id", [A.id, B.id]).in("key", ["openweathermap", "google_oauth_client", "presence_sensor"]);
  expect(leaked).toBe(0);
  const { count: onB } = await db.from("integration_secrets").select("key", { count: "exact", head: true }).eq("family_id", B.id);
  expect(onB).toBe(0);

  // The weather: A's key for A, the server's for B and for no session at all.
  expect(await weatherKeyFor(A.cookie)).toBe(OWN_WEATHER);
  expect(await weatherKeyFor(B.cookie)).toBe(ENV_WEATHER);
  expect(await weatherKeyFor(undefined)).toBe(ENV_WEATHER);
  asked.length = 0;
  expect((await forecastGet(req("/api/weather/forecast?city=Hamburg&lang=en&units=metric", { cookie: A.cookie }))).status).toBe(200);
  expect((await citiesGet(req("/api/cities?q=Hamb", { cookie: A.cookie }))).status).toBe(200);
  expect(asked).toEqual([OWN_WEATHER, OWN_WEATHER]);

  // B sees none of it.
  const bKeys = (await (await keysGet(req("/api/settings/keys", { cookie: B.cookie }))).json()).keys;
  expect(bKeys.openweathermap).toEqual({ source: "environment", hint: null, environment: true });
  expect(bKeys.google_oauth_client).toEqual({ source: "none", hint: null, environment: false });
});

test("Google: A is configured with its own client and Connect asks Google with it; B is not configured", async () => {
  const a = await (await googleConfigured(req("/api/google/configured", { cookie: A.cookie }))).json();
  expect(a.configured).toBe(true);
  // The redirect URI still follows the address Kinboard is opened on (#503).
  expect(a.redirectUri).toBe("http://localhost:3000/api/google/callback");
  const b = await (await googleConfigured(req("/api/google/configured", { cookie: B.cookie }))).json();
  expect(b.configured).toBe(false);

  const connect = await googleAuth(req(`/api/google/auth?family_id=${A.id}`, { cookie: A.cookie }));
  expect(connect.status).toBe(307);
  const to = new URL(connect.headers.get("location")!);
  expect(to.hostname).toBe("accounts.google.com");
  expect(to.searchParams.get("client_id")).toBe(OWN_ID);
  expect(to.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/google/callback");
  expect(to.toString()).not.toContain(OWN_SECRET);

  const bConnect = await googleAuth(req(`/api/google/auth?family_id=${B.id}`, { cookie: B.cookie }));
  expect(new URL(bConnect.headers.get("location")!).search).toBe("?error=not_configured");
});

test("presence: A's new token works for A's screens, the server's stops working for them, B is unchanged", async () => {
  const gen = await keysPost(req("/api/settings/keys", { method: "POST", cookie: A.cookie, body: { key: "presence_sensor", action: "generate" } }));
  expect(gen.status).toBe(200);
  expect(gen.headers.get("cache-control")).toBe("no-store");
  const { token, keys } = await gen.json();
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect(keys.presence_sensor).toEqual({ source: "family", hint: `…${token.slice(-4)}`, environment: true });
  // Shown once: a GET never carries it.
  expect(JSON.stringify(await (await keysGet(req("/api/settings/keys", { cookie: A.cookie }))).json())).not.toContain(token);

  const report = (bearer: string, device: string) =>
    presencePost(new NextRequest("http://localhost:3000/api/presence", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ device_id: device, presence: true, distance: 80 }),
    }));
  expect((await report(token, A.device)).status).toBe(200);
  expect((await report(ENV_PRESENCE, A.device)).status).toBe(401);
  expect((await report(ENV_PRESENCE, B.device)).status).toBe(200);
  expect((await report(token, B.device)).status).toBe(401);

  // A new token replaces the old one.
  const again = await (await keysPost(req("/api/settings/keys", { method: "POST", cookie: A.cookie, body: { key: "presence_sensor", action: "generate" } }))).json();
  expect(again.token).not.toBe(token);
  expect((await report(token, A.device)).status).toBe(401);
  expect((await report(again.token, A.device)).status).toBe(200);
});

test("removing A's keys falls back to the server's, exactly as before", async () => {
  for (const key of ["openweathermap", "google_oauth_client", "presence_sensor"]) {
    const res = await keysDelete(req("/api/settings/keys", { method: "DELETE", cookie: A.cookie, body: { key } }));
    expect(res.status, key).toBe(200);
  }
  const keys = (await (await keysGet(req("/api/settings/keys", { cookie: A.cookie }))).json()).keys;
  expect(keys).toEqual({
    openweathermap: { source: "environment", hint: null, environment: true },
    google_oauth_client: { source: "none", hint: null, environment: false },
    presence_sensor: { source: "environment", hint: null, environment: true },
  });
  expect(await weatherKeyFor(A.cookie)).toBe(ENV_WEATHER);
  const ok = await presencePost(new NextRequest("http://localhost:3000/api/presence", {
    method: "POST",
    headers: { authorization: `Bearer ${ENV_PRESENCE}`, "content-type": "application/json" },
    body: JSON.stringify({ device_id: A.device, presence: false }),
  }));
  expect(ok.status).toBe(200);
});
