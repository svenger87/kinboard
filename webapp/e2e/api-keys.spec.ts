import { test, expect } from "@playwright/test";
import { withoutServiceKey } from "./helpers/service-key";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import {
  API_KEY_ENV,
  API_KEY_FIELDS,
  API_KEY_NAMES,
  maskHint,
  pickCredential,
  statusOf,
} from "../src/lib/api-key-status";
import {
  apiKeysStatus,
  forgetPresenceTokens,
  generatePresenceToken,
  presenceSensorToken,
  resolveGoogleClient,
  resolveOpenWeatherKey,
  tokensMatch,
  type KeyLoader,
} from "../src/lib/api-keys";
import { SECRET_FIELDS } from "../src/lib/integration-secrets";
import { PUT as settingsPut, DELETE as settingsDelete } from "../src/app/api/settings/route";
import { GET as keysGet, PUT as keysPut, DELETE as keysDelete, POST as keysPost } from "../src/app/api/settings/keys/route";
import { POST as presencePost } from "../src/app/api/presence/route";

/**
 * RFC-023 §4.4: the OpenWeatherMap key, the Google OAuth client and the
 * presence sensor's token, per family in Settings, with the server's
 * environment as the fallback. No stack: the stored values come from a fake
 * loader. api-keys-live.spec.ts runs the same against a database.
 */

const FAMILY = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";

/** A loader over a fixed table: family → key name → stored value. */
function loader(table: Record<string, Partial<Record<string, Record<string, unknown>>>>): KeyLoader {
  return async (familyId, name) => table[familyId]?.[name] ?? null;
}

test.describe("precedence", () => {
  test("the family's value, then the environment's, then nothing", () => {
    const env = { OPENWEATHERMAP_API_KEY: "env-weather" };
    expect(pickCredential("openweathermap", { api_key: "own-weather" }, env)).toEqual({ source: "family", values: ["own-weather"] });
    expect(pickCredential("openweathermap", null, env)).toEqual({ source: "environment", values: ["env-weather"] });
    expect(pickCredential("openweathermap", { api_key: "" }, env)).toEqual({ source: "environment", values: ["env-weather"] });
    expect(pickCredential("openweathermap", { api_key: "   " }, env)).toEqual({ source: "environment", values: ["env-weather"] });
    expect(pickCredential("openweathermap", null, {})).toEqual({ source: "none", values: null });
    expect(pickCredential("openweathermap", null, { OPENWEATHERMAP_API_KEY: "" })).toEqual({ source: "none", values: null });
  });

  test("the Google client is a pair: never one half from the family and the other from the environment", () => {
    const env = { GOOGLE_CLIENT_ID: "env-id", GOOGLE_CLIENT_SECRET: "env-secret" };
    expect(pickCredential("google_oauth_client", { client_id: "own-id", client_secret: "own-secret" }, env).values).toEqual(["own-id", "own-secret"]);
    // Half a family pair is no family pair: the environment's whole pair.
    expect(pickCredential("google_oauth_client", { client_id: "own-id" }, env)).toEqual({ source: "environment", values: ["env-id", "env-secret"] });
    // Half an environment pair is none at all, as the routes treated it before.
    expect(pickCredential("google_oauth_client", null, { GOOGLE_CLIENT_ID: "env-id" }).source).toBe("none");
  });

  test("environment values are used exactly as before, not trimmed", () => {
    expect(pickCredential("presence_sensor", null, { PRESENCE_SENSOR_TOKEN: "abc " }).values).toEqual(["abc "]);
  });

  test("resolvers: a family with its own key gets it, another family and no family get the server's", async () => {
    const env = { OPENWEATHERMAP_API_KEY: "env-weather", GOOGLE_CLIENT_ID: "env-id", GOOGLE_CLIENT_SECRET: "env-secret" };
    const load = loader({ [FAMILY]: { openweathermap: { api_key: "own-weather" }, google_oauth_client: { client_id: "own-id", client_secret: "own-secret" } } });
    expect(await resolveOpenWeatherKey(FAMILY, { load, env })).toBe("own-weather");
    expect(await resolveOpenWeatherKey(OTHER, { load, env })).toBe("env-weather");
    expect(await resolveOpenWeatherKey(null, { load, env })).toBe("env-weather");
    expect(await resolveGoogleClient(FAMILY, { load, env })).toEqual({ clientId: "own-id", clientSecret: "own-secret", source: "family" });
    expect(await resolveGoogleClient(OTHER, { load, env })).toEqual({ clientId: "env-id", clientSecret: "env-secret", source: "environment" });
    expect(await resolveGoogleClient(OTHER, { load, env: {} })).toBeNull();
  });

  test("a failed read falls back to the server's key for weather and Google", async () => {
    const load: KeyLoader = async () => {
      throw new Error("db down");
    };
    const env = { OPENWEATHERMAP_API_KEY: "env-weather" };
    const errors = console.error;
    console.error = () => {};
    try {
      expect(await resolveOpenWeatherKey(FAMILY, { load, env })).toBe("env-weather");
    } finally {
      console.error = errors;
    }
  });
});

test.describe("the presence token", () => {
  const env = { PRESENCE_SENSOR_TOKEN: "server-token-0123456789" };
  const deviceFamily = async (id: string) => (id === DEVICE ? FAMILY : null);
  /** Some family has a token of its own, so devices are looked up. */
  const anyFamilyToken = async () => true;

  test("a device of a family with its own token needs that token; the server's no longer works for it", async () => {
    const load = loader({ [FAMILY]: { presence_sensor: { token: "family-token-0123456789" } } });
    expect(await presenceSensorToken(DEVICE, { load, deviceFamily, env, anyFamilyToken })).toBe("family-token-0123456789");
  });

  test("a device of a family without one, an unknown device and a malformed id get the server's", async () => {
    const load = loader({});
    expect(await presenceSensorToken(DEVICE, { load, deviceFamily, env, anyFamilyToken })).toBe("server-token-0123456789");
    expect(await presenceSensorToken("44444444-4444-4444-8444-444444444444", { load, deviceFamily, env, anyFamilyToken })).toBe("server-token-0123456789");
    let looked = false;
    const spy = async () => {
      looked = true;
      return null;
    };
    expect(await presenceSensorToken("test-device", { load, deviceFamily: spy, env, anyFamilyToken })).toBe("server-token-0123456789");
    expect(await presenceSensorToken(undefined, { load, deviceFamily: spy, env, anyFamilyToken })).toBe("server-token-0123456789");
    expect(looked).toBe(false);
    expect(await presenceSensorToken(DEVICE, { load, deviceFamily, env: {}, anyFamilyToken })).toBeNull();
  });

  test("a failed read throws instead of falling back to the server's token", async () => {
    const load: KeyLoader = async () => {
      throw new Error("db down");
    };
    await expect(presenceSensorToken(DEVICE, { load, deviceFamily, env, anyFamilyToken })).rejects.toThrow("db down");
    await expect(
      presenceSensorToken(DEVICE, {
        load: loader({}),
        anyFamilyToken,
        deviceFamily: async () => {
          throw new Error("db down");
        },
        env,
      }),
    ).rejects.toThrow("db down");
  });

  test("while no family has a token, nothing is looked up: the server's token, as before", async () => {
    let looked = 0;
    const counting = async () => {
      looked++;
      return FAMILY;
    };
    const none = async () => false;
    expect(await presenceSensorToken(DEVICE, { load: loader({}), deviceFamily: counting, env, anyFamilyToken: none })).toBe("server-token-0123456789");
    expect(looked).toBe(0);
  });

  test("the route refuses rather than falls back when the token can't be looked up", async () => {
    // No database to ask (no service-role key): the "does any family have a
    // token" read throws, and the server's token is not accepted instead.
    // Since RFC-024 §4.6 a missing key is derived from JWT_SECRET, so
    // "no key" means no name set and nothing to derive it from.
    const prior = { token: process.env.PRESENCE_SENSOR_TOKEN };
    forgetPresenceTokens();
    process.env.PRESENCE_SENSOR_TOKEN = "server-token-0123456789";
    const errors = console.error;
    console.error = () => {};
    try {
      const res = await withoutServiceKey(() => presencePost(new NextRequest("http://localhost/api/presence", {
        method: "POST",
        headers: { authorization: "Bearer server-token-0123456789" },
        body: JSON.stringify({ device_id: DEVICE, presence: true }),
      })));
      expect(res.status).toBe(503);
    } finally {
      console.error = errors;
      forgetPresenceTokens();
      if (prior.token === undefined) delete process.env.PRESENCE_SENSOR_TOKEN; else process.env.PRESENCE_SENSOR_TOKEN = prior.token;
    }
  });

  test("tokensMatch compares whole tokens, whatever their lengths", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
    expect(tokensMatch("", "abc")).toBe(false);
  });

  test("generated tokens are 32 random bytes in hex, and differ", () => {
    const a = generatePresenceToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generatePresenceToken()).not.toBe(a);
  });

  test("the timing-safe comparison stays: the route compares through tokensMatch, which uses timingSafeEqual", () => {
    const route = readFileSync(join(__dirname, "../src/app/api/presence/route.ts"), "utf8");
    expect(route).toContain("tokensMatch(supplied, expected)");
    expect(route).not.toMatch(/supplied\s*[!=]==?\s*expected|expected\s*[!=]==?\s*supplied/);
    const lib = readFileSync(join(__dirname, "../src/lib/api-keys.ts"), "utf8");
    expect(lib).toMatch(/timingSafeEqual\(a, b\)/);
  });
});

test.describe("what the browser is shown", () => {
  test("a masked hint of the family's value, never the value; nothing of the environment's", async () => {
    const env = { OPENWEATHERMAP_API_KEY: "env-weather-key-abcdef", PRESENCE_SENSOR_TOKEN: "server-token-0123456789" };
    const load = loader({
      [FAMILY]: {
        openweathermap: { api_key: "own-weather-key-1234wxyz" },
        google_oauth_client: { client_id: "1234.apps.googleusercontent.com", client_secret: "GOCSPX-supersecret-9876" },
      },
    });
    const status = await apiKeysStatus(FAMILY, { load, env });
    expect(status).toEqual({
      openweathermap: { source: "family", hint: "…wxyz", environment: true },
      google_oauth_client: { source: "family", hint: "…9876", environment: false },
      presence_sensor: { source: "environment", hint: null, environment: true },
    });
    const text = JSON.stringify(status);
    for (const secret of ["own-weather-key-1234wxyz", "GOCSPX-supersecret-9876", "1234.apps", "env-weather", "server-token"]) {
      expect(text).not.toContain(secret);
    }
  });

  test("a short value is not given away by its last four characters", () => {
    expect(maskHint("short")).toBe("…");
    expect(maskHint("0123456789ab")).toBe("…89ab");
    expect(statusOf("openweathermap", { api_key: "tiny" }, {}).hint).toBe("…");
  });
});

test.describe("storage", () => {
  test("every field is a secret field, so upsertSecrets keeps it", () => {
    for (const name of API_KEY_NAMES) expect(SECRET_FIELDS[name]).toEqual([...API_KEY_FIELDS[name]]);
  });

  test("the generic settings route refuses the key names: they are changed behind the PIN, in their own route", async () => {
    for (const key of API_KEY_NAMES) {
      const put = await settingsPut(new NextRequest("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({ family_id: FAMILY, key, value: { api_key: "x" } }),
      }));
      // No session: 401 before anything else, so ask the dedicated check directly.
      expect([401, 403]).toContain(put.status);
      const del = await settingsDelete(new NextRequest("http://localhost/api/settings", {
        method: "DELETE",
        body: JSON.stringify({ family_id: FAMILY, key }),
      }));
      expect([401, 403]).toContain(del.status);
    }
    const src = readFileSync(join(__dirname, "../src/app/api/settings/route.ts"), "utf8");
    expect(src).toMatch(/API_KEY_NAMES\.map\(\(name\) => \[name, "\/api\/settings\/keys"\]\)/);
  });

  test("/api/settings/keys answers nobody without a session", async () => {
    const url = "http://localhost/api/settings/keys";
    expect((await keysGet(new NextRequest(url))).status).toBe(401);
    expect((await keysPut(new NextRequest(url, { method: "PUT", body: JSON.stringify({ key: "openweathermap", values: { api_key: "x" } }) }))).status).toBe(401);
    expect((await keysDelete(new NextRequest(url, { method: "DELETE", body: JSON.stringify({ key: "openweathermap" }) }))).status).toBe(401);
    expect((await keysPost(new NextRequest(url, { method: "POST", body: JSON.stringify({ key: "presence_sensor", action: "generate" }) }))).status).toBe(401);
  });

  test("/api/settings/keys takes no family from the request, and asks for the settings unlock before every change", () => {
    const src = readFileSync(join(__dirname, "../src/app/api/settings/keys/route.ts"), "utf8");
    expect(src).not.toMatch(/family_id|searchParams|input\.family|input\[|\}\s*=\s*input\b/);
    for (const verb of ["PUT", "DELETE", "POST"]) {
      const body = src.slice(src.indexOf(`export async function ${verb}(`));
      const head = body.slice(0, body.indexOf("const input"));
      expect(head, verb).toContain("requireSettingsUnlock(auth.session)");
    }
  });
});

test.describe("every reader asks the resolver", () => {
  const SRC = join(__dirname, "../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
    });
  const VARS = Object.values(API_KEY_ENV).flat();

  /** The variables `src` reads from the environment by name: `env.X`, `env["X"]`, or `{ X } = process.env`. */
  function envReads(src: string): string[] {
    const found = new Set<string>();
    for (const v of VARS) {
      if (new RegExp(`env(\\.|\\[["'\`])${v}\\b`).test(src)) found.add(v);
    }
    for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*(?:process\.)?env\b/g)) {
      for (const v of VARS) if (new RegExp(`\\b${v}\\b`).test(m[1])) found.add(v);
    }
    return [...found];
  }

  test("nothing in src reads the three keys from the environment", () => {
    const readers: string[] = [];
    for (const file of files(SRC)) {
      for (const v of envReads(readFileSync(file, "utf8"))) readers.push(`${relative(SRC, file)}: ${v}`);
    }
    expect(readers).toEqual([]);
  });

  test("the scan finds a reader in every form", () => {
    expect(envReads("const K = process.env.OPENWEATHERMAP_API_KEY;")).toEqual(["OPENWEATHERMAP_API_KEY"]);
    expect(envReads('const id = process.env["GOOGLE_CLIENT_ID"];')).toEqual(["GOOGLE_CLIENT_ID"]);
    expect(envReads("const { PRESENCE_SENSOR_TOKEN: t, OTHER } = process.env;")).toEqual(["PRESENCE_SENSOR_TOKEN"]);
    expect(envReads("const { GOOGLE_CLIENT_SECRET } = env;")).toEqual(["GOOGLE_CLIENT_SECRET"]);
    // A name in a comment or a string is not a read.
    expect(envReads("// set OPENWEATHERMAP_API_KEY in .env\nconst name = 'PRESENCE_SENSOR_TOKEN';")).toEqual([]);
  });
});

test.describe("the presence route", () => {
  const request = (token: string | undefined, body: unknown) =>
    new NextRequest("http://localhost/api/presence", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  test("without a token anywhere it is not configured; a broken body with the right token is a 400", async () => {
    const prior = process.env.PRESENCE_SENSOR_TOKEN;
    try {
      delete process.env.PRESENCE_SENSOR_TOKEN;
      expect((await presencePost(request("x", { device_id: "test-device", presence: true }))).status).toBe(503);
      process.env.PRESENCE_SENSOR_TOKEN = "test-sensor-secret";
      expect((await presencePost(request("test-sensor-secret", "{not json"))).status).toBe(400);
      expect((await presencePost(request("wrong", "{not json"))).status).toBe(401);
      expect((await presencePost(request("test-sensor-secret", { device_id: "test-device" }))).status).toBe(400);
    } finally {
      if (prior === undefined) delete process.env.PRESENCE_SENSOR_TOKEN;
      else process.env.PRESENCE_SENSOR_TOKEN = prior;
    }
  });
});
