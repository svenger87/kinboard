import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { evaluateToken, hashIntegrationToken, requireIntegrationAuth } from "../src/lib/integration-auth";
import { readFamilyWeather, type WeatherIo } from "../src/lib/integration-weather";
import { OPENWEATHER_REVALIDATE } from "../src/lib/weather-provider";
import { GET as weatherRoute } from "../src/app/api/integration/v1/weather/route";
import { GET as widgetCurrent } from "../src/app/api/weather/route";
import { GET as widgetForecast } from "../src/app/api/weather/forecast/route";
import { createKinboardMcpServer, registeredTools, TOOL_SCOPES } from "../src/lib/mcp/server";
import { IntegrationCallError, type CallOptions, type RouteHandler } from "../src/lib/mcp/call-integration";
import { codeOnly } from "./source-helpers";

/**
 * `GET /api/integration/v1/weather` and the `get_weather_forecast` tool: who
 * may read it, what it says when weather is not set up, the shape and units of
 * what it returns, and that it asks the provider exactly what the Weather
 * widget asks — the same URL and cache options, so it lands on the widget's
 * cache entry instead of spending quota of its own. No stack: the provider is
 * a stub `fetch`, settings a stub reader.
 */

const NOW = new Date("2026-10-07T13:30:00Z"); // Wednesday, 15:30 in Berlin
const KEY = "owm-test-key";
const H = 3600;

/** Five days of 3-hour steps from 15:00Z today, as OpenWeatherMap sends them. */
function forecastFixture(opts: { name?: string } = {}) {
  const start = Date.parse("2026-10-07T15:00:00Z") / 1000;
  const list = Array.from({ length: 40 }, (_, i) => {
    const dt = start + i * 3 * H;
    // Thursday (Berlin) is wet in the afternoon; every other step is dry.
    const thursdayAfternoon = dt >= Date.parse("2026-10-08T09:00:00Z") / 1000 && dt <= Date.parse("2026-10-08T15:00:00Z") / 1000;
    return {
      dt,
      main: { temp: 10 + (i % 8), feels_like: 9, temp_min: 0, temp_max: 0, humidity: 70 },
      weather: [{ id: 800, main: thursdayAfternoon ? "Rain" : "Clear", description: "", icon: "01d" }],
      wind: { speed: 5 },
      pop: thursdayAfternoon ? 0.83 : 0,
      ...(thursdayAfternoon ? { rain: { "3h": 2.54 } } : {}),
      dt_txt: new Date(dt * 1000).toISOString(),
    };
  });
  return { list, city: { name: opts.name ?? "Hamburg", coord: { lat: 53.55, lon: 10 }, timezone: 7200 } };
}

const CURRENT = {
  dt: Date.parse("2026-10-07T13:20:00Z") / 1000,
  main: { temp: 14.4, feels_like: 13.6, humidity: 61, temp_min: 12, temp_max: 16 },
  weather: [{ id: 803, main: "Clouds", description: "", icon: "04d" }],
  wind: { speed: 5 },
  visibility: 10000,
  sys: { sunrise: 1, sunset: 2 },
  name: "Hamburg",
  timezone: 7200,
};

type Recorded = { url: string; init: unknown };
type Answer = { status: number; body?: unknown } | "throw";

/** A stub provider: records every request and answers per endpoint. */
function provider(answers: { forecast?: Answer; weather?: Answer } = {}) {
  const requests: Recorded[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    const kind = new URL(url).pathname.endsWith("/forecast") ? "forecast" : "weather";
    const answer = answers[kind] ?? { status: 200, body: kind === "forecast" ? forecastFixture() : CURRENT };
    if (answer === "throw") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { requests, fetchStub };
}

function io(over: Partial<WeatherIo> & { settings?: Record<string, unknown> } = {}): WeatherIo {
  const settings: Record<string, unknown> = over.settings ?? {
    weather_location: { type: "city", city: "Hamburg" },
    weather_units: "metric",
    locale: "en",
  };
  return {
    setting: async (key) => settings[key] ?? null,
    timeZone: async () => "Europe/Berlin",
    apiKey: () => KEY,
    fetch: provider().fetchStub,
    now: () => NOW,
    ...over,
  };
}

// ── Who may read it ─────────────────────────────────────────────────────

test.describe("auth and scope", () => {
  const route = () => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "weather", "route.ts"), "utf8"));

  test("no token is a 401 from the route itself, before anything is read", async () => {
    const res = await weatherRoute(new NextRequest("https://kb.example.com/api/integration/v1/weather"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "not_authenticated" });
  });

  test("a token without family:read is refused; family:read is enough", async () => {
    const request = new NextRequest("https://kb.example.com/api/integration/v1/weather", {
      headers: { authorization: "Bearer kbi_example" },
    });
    const row = (scopes: string[]) => async () => ({
      id: "tok-1", family_id: "fam-1", name: "ChatGPT", scopes,
      token_hash: hashIntegrationToken("kbi_example"), expires_at: null, revoked_at: null,
      last_used_at: null, oauth_client_id: "client-1",
    }) as Parameters<typeof evaluateToken>[0];

    for (const scopes of [[], ["energy:read"], ["calendar:write", "tasks:write", "home:read"]]) {
      const refused = await requireIntegrationAuth(request, "family:read", row(scopes));
      expect(refused.ok, scopes.join(",")).toBe(false);
      expect(!refused.ok && refused.response.status).toBe(401);
    }
    expect((await requireIntegrationAuth(request, "family:read", row(["family:read"]))).ok).toBe(true);
  });

  test("the route asks for family:read — no scope of its own — and takes the family only from the token", () => {
    const src = route();
    expect(src.match(/withIntegrationAuth\(/g)).toHaveLength(1);
    expect(src).toContain('withIntegrationAuth(request, "family:read"');
    expect(src).toContain("context.familyId");
    expect(src).not.toMatch(/searchParams|request\.json|family_id"\s*,\s*request/);
    expect(TOOL_SCOPES.get_weather_forecast).toBe("family:read");
  });
});

// ── Not set up ──────────────────────────────────────────────────────────

test.describe("weather that is not set up", () => {
  const notSetUp = (result: Awaited<ReturnType<typeof readFamilyWeather>>) => {
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ code: "not_found", reason: "weather_not_configured" });
    expect((result.body as { error: string }).error).toMatch(/^Weather isn't set up in Kinboard yet/);
  };

  test("no API key on the server: a clear 404, and the provider is never asked", async () => {
    const { requests, fetchStub } = provider();
    const result = await readFamilyWeather(io({ apiKey: () => undefined, fetch: fetchStub }));
    notSetUp(result);
    expect(requests).toEqual([]);
  });

  test("no location chosen: a clear 404, not the widget's Hamburg fallback", async () => {
    for (const location of [null, {}, { type: "city", city: "  " }, { type: "coordinates" }, { type: "coordinates", lat: 91, lon: 10 }]) {
      const { requests, fetchStub } = provider();
      const result = await readFamilyWeather(io({ settings: { weather_location: location }, fetch: fetchStub }));
      notSetUp(result);
      expect((result.body as { error: string }).error).toContain("Settings → Weather");
      expect(requests, JSON.stringify(location)).toEqual([]);
    }
  });

  test("a place the provider does not know is its own 404, and an outage is a 502 — never a 500", async () => {
    const unknown = await readFamilyWeather(io({ fetch: provider({ forecast: { status: 404 } }).fetchStub }));
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: "not_found", reason: "location_not_found" });

    for (const forecast of [{ status: 500 }, { status: 401 }, "throw"] as Answer[]) {
      const down = await readFamilyWeather(io({ fetch: provider({ forecast }).fetchStub }));
      expect(down.status).toBe(502);
      expect(down.body).toMatchObject({ code: "upstream_unavailable" });
    }
  });
});

// ── Shape and units ─────────────────────────────────────────────────────

test.describe("what it returns", () => {
  test("metric: location, units, current conditions, family-calendar days and today's steps", async () => {
    const result = await readFamilyWeather(io());
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    const body = result.body;

    expect(Object.keys(body).sort()).toEqual(["current", "daily", "fetched_at", "hourly_today", "location", "time_zone", "units"]);
    expect(body.location).toBe("Hamburg");
    expect(body.time_zone).toBe("Europe/Berlin");
    expect(body.units).toEqual({ system: "metric", temperature: "°C", wind_speed: "km/h", precipitation: "mm" });
    expect(body.fetched_at).toBe(NOW.toISOString());
    expect(body.current).toEqual({
      temperature: 14, feels_like: 14, condition: "Cloudy", condition_code: "Clouds",
      humidity_pct: 61, wind_speed: 18, observed_at: "2026-10-07T13:20:00.000Z",
    });

    // Today (Wed) to Monday: 15:00Z..12:00Z five days later, on Berlin's calendar.
    expect(body.daily.map((d) => d.date)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
    for (const day of body.daily) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(day.rain_chance_pct)).toBe(true);
      expect(day.temp_min).toBeLessThanOrEqual(day.temp_max);
    }
    const thursday = body.daily[1];
    expect(thursday).toEqual({
      date: "2026-10-08", temp_min: 10, temp_max: 17, condition: "Rain", condition_code: "Rain",
      rain_chance_pct: 83, rain_amount: 7.6, snow_amount: 0, partial: false,
    });
    // A dry day says 0, not nothing.
    expect(body.daily[2]).toMatchObject({ date: "2026-10-09", rain_chance_pct: 0, condition: "Clear", partial: false });
    // Today from 17:00 Berlin, and the last day, are only part of a day.
    expect(body.daily[0].partial).toBe(true);
    expect(body.daily.at(-1)!.partial).toBe(true);

    // Today's steps in Berlin time: 17:00, 20:00, 23:00.
    expect(body.hourly_today).toEqual([
      { time: "17:00", temperature: 10, condition: "Clear", condition_code: "Clear", rain_chance_pct: 0 },
      { time: "20:00", temperature: 11, condition: "Clear", condition_code: "Clear", rain_chance_pct: 0 },
      { time: "23:00", temperature: 12, condition: "Clear", condition_code: "Clear", rain_chance_pct: 0 },
    ]);
  });

  test("imperial: the units say so, wind stays mph and rain becomes inches", async () => {
    const result = await readFamilyWeather(io({ settings: { weather_location: { type: "city", city: "Hamburg" }, weather_units: "imperial", locale: "en" } }));
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.units).toEqual({ system: "imperial", temperature: "°F", wind_speed: "mph", precipitation: "in" });
    // 5 from the provider is already mph in imperial; metric made it 18 km/h.
    expect(result.body.current?.wind_speed).toBe(5);
    // 3 × 2.54 mm = 0.3 in.
    expect(result.body.daily[1].rain_amount).toBe(0.3);
  });

  test("days are the family's: a New York family's Wednesday runs to 03:00Z Thursday", async () => {
    const berlin = await readFamilyWeather(io());
    const newYork = await readFamilyWeather(io({ timeZone: async () => "America/New_York" }));
    if (berlin.status !== 200 || newYork.status !== 200) throw new Error("expected 200s");
    // 15:00Z..03:00Z is 11:00..23:00 in New York: five steps of Wednesday, not three.
    expect(newYork.body.hourly_today.map((h) => h.time)).toEqual(["11:00", "14:00", "17:00", "20:00", "23:00"]);
    expect(newYork.body.daily[0].date).toBe("2026-10-07");
    expect(newYork.body.time_zone).toBe("America/New_York");
    expect(berlin.body.hourly_today).toHaveLength(3);
  });

  test("the family's language labels the conditions; condition_code stays English", async () => {
    const result = await readFamilyWeather(io({ settings: { weather_location: { type: "city", city: "Hamburg" }, locale: "de" } }));
    if (result.status !== 200) throw new Error("expected 200");
    expect(result.body.daily[1]).toMatchObject({ condition: "Regen", condition_code: "Rain" });
    expect(result.body.units.system).toBe("metric"); // no units setting: the widget's default
  });

  test("current conditions failing does not fail the forecast", async () => {
    const result = await readFamilyWeather(io({ fetch: provider({ weather: { status: 500 } }).fetchStub }));
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.current).toBeNull();
    expect(result.body.daily.length).toBeGreaterThan(0);
  });
});

// ── Quota: the widget's requests, not new ones ──────────────────────────

test.describe("provider requests and cache", () => {
  const withKey = async <T>(fn: () => Promise<T>) => {
    const before = process.env.OPENWEATHERMAP_API_KEY;
    process.env.OPENWEATHERMAP_API_KEY = KEY;
    try { return await fn(); } finally {
      if (before === undefined) delete process.env.OPENWEATHERMAP_API_KEY; else process.env.OPENWEATHERMAP_API_KEY = before;
    }
  };

  /** What the widget's two routes send upstream, for the query use-weather.ts builds. */
  async function widgetRequests(query: string) {
    const { requests, fetchStub } = provider();
    const real = globalThis.fetch;
    globalThis.fetch = fetchStub;
    try {
      await withKey(async () => {
        const forecast = await widgetForecast(new NextRequest(`https://kb.example.com/api/weather/forecast?${query}`));
        const current = await widgetCurrent(new NextRequest(`https://kb.example.com/api/weather?${query}`));
        expect(forecast.status).toBe(200);
        expect(current.status).toBe(200);
      });
    } finally {
      globalThis.fetch = real;
    }
    return requests;
  }

  for (const [label, location, query] of [
    ["a city", { type: "city", city: "Saint-Étienne & Co" }, `city=${encodeURIComponent("Saint-Étienne & Co")}&lang=fr&units=imperial`],
    ["coordinates", { type: "coordinates", lat: 53.5511, lon: 9.9937, city: "ignored" }, "lat=53.5511&lon=9.9937&lang=fr&units=imperial"],
  ] as const) {
    test(`for ${label}, the same two requests as the widget, byte for byte, so they share its cache entries`, async () => {
      const { requests, fetchStub } = provider();
      const result = await readFamilyWeather(io({
        fetch: fetchStub,
        settings: { weather_location: location, weather_units: "imperial", locale: "fr" },
      }));
      expect(result.status).toBe(200);
      const widget = await widgetRequests(query);
      const sort = (r: Recorded[]) => [...r].sort((a, b) => a.url.localeCompare(b.url));
      expect(requests).toHaveLength(2);
      expect(sort(requests)).toEqual(sort(widget));
      for (const r of requests) {
        const kind = new URL(r.url).pathname.endsWith("/forecast") ? "forecast" : "weather";
        expect(r.init).toEqual({ next: { revalidate: OPENWEATHER_REVALIDATE[kind] } });
      }
    });
  }

  test("the cache lifetimes are the widget's: 10 minutes now, 30 the forecast", () => {
    expect(OPENWEATHER_REVALIDATE).toEqual({ weather: 600, forecast: 1800 });
  });

  test("nothing weather-shaped calls the provider except through lib/weather-provider", () => {
    for (const file of ["src/app/api/weather/route.ts", "src/app/api/weather/forecast/route.ts", "src/lib/integration-weather.ts", "src/app/api/integration/v1/weather/route.ts"]) {
      const src = codeOnly(readFileSync(join(__dirname, "..", file), "utf8"));
      expect(src, file).not.toMatch(/openweathermap\.org|OPENWEATHERMAP_API_KEY|appid=/);
      expect(src.match(/\bawait fetch\(/g), file).toBeNull();
    }
  });
});

// ── The MCP tool ────────────────────────────────────────────────────────

test.describe("get_weather_forecast", () => {
  type RecordedCall = Omit<CallOptions, "origin" | "token">;
  function buildServer(scopes: string[], run?: () => unknown) {
    const calls: RecordedCall[] = [];
    const handlers: RouteHandler[] = [];
    const callFn = async (handler: RouteHandler, opts: CallOptions) => {
      const { origin: _o, token: _t, ...rest } = opts;
      calls.push(rest);
      handlers.push(handler);
      return run ? run() : { ok: true };
    };
    const server = createKinboardMcpServer({ token: "kbi_test", clientId: "c", scopes } as AuthInfo, "https://kb.example.com", callFn);
    return { server, calls, handlers };
  }
  const tool = (server: ReturnType<typeof createKinboardMcpServer>) =>
    registeredTools(server).get_weather_forecast as unknown as {
      handler: (args: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
      annotations?: Record<string, unknown>;
      description: string;
    };

  test("reads /weather with no arguments through the route itself, and is read-only and closed-world", async () => {
    const answer = { location: "Hamburg", daily: [] };
    const { server, calls, handlers } = buildServer(["family:read"], () => answer);
    const t = tool(server);
    expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    const result = await t.handler({});
    expect(calls).toEqual([{ path: "/weather" }]);
    expect(handlers).toEqual([weatherRoute]);
    expect(JSON.parse(result.content[0].text)).toEqual(answer);
    expect(result.isError).toBeUndefined();
  });

  test("is refused without family:read, naming it", async () => {
    const { server, calls } = buildServer(["energy:read", "calendar:write"]);
    const result = await tool(server).handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("family:read");
    expect(calls).toEqual([]);
  });

  test("hands the not-set-up answer to the model as it is, to be explained", async () => {
    const { server } = buildServer(["family:read"], () => {
      throw new IntegrationCallError("Weather isn't set up in Kinboard yet: no weather location is chosen in Settings → Weather.", 404, "not_found");
    });
    const result = await tool(server).handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Weather isn't set up in Kinboard yet/);
  });

  test("the server's instructions say to report a missing setup or an out-of-range date, not guess", async () => {
    const { KINBOARD_INSTRUCTIONS } = await import("../src/lib/mcp/server");
    expect(KINBOARD_INSTRUCTIONS).toContain("something is not set up or out of range, say so rather than guess");
  });

  test("the description says what the fields mean, whose location it is, and where names come from", () => {
    const { server } = buildServer(["family:read"]);
    const d = tool(server).description;
    for (const phrase of [
      "family's own location", "no location argument", "YYYY-MM-DD in the family's time zone", "temp_min", "temp_max",
      "rain_chance_pct", "0 is a real figure", "partial", "hourly_today", "units", "isn't set up in Kinboard yet",
      "come from the family's settings and the weather service",
    ]) expect(d, phrase).toContain(phrase);
  });
});
