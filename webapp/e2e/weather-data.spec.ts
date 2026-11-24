import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { GET as currentRoute } from "../src/app/api/weather/route";
import { GET as forecastRoute } from "../src/app/api/weather/forecast/route";
import { fetchAirQuality, withoutPartialLastDay } from "../src/lib/weather-provider";
import { locationDateKey, todayRange } from "../src/lib/weather-today";
import { compassPoint, windArrowRotation } from "../src/lib/wind-direction";
import { aqiOnCard } from "../src/lib/air-quality";

/**
 * What the free OpenWeatherMap plan gives the Weather card beyond the basics:
 * today's real range, the wind's direction, air quality, and a forecast
 * without a half-day at its end. No stack: the provider is a stub `fetch`.
 */

const KEY = "owm-test-key";
const H = 3600;

const CURRENT = {
  dt: Date.parse("2026-10-07T13:20:00Z") / 1000,
  coord: { lat: 53.55, lon: 10 },
  main: { temp: 14.4, feels_like: 13.6, humidity: 61, temp_min: 14, temp_max: 15 },
  weather: [{ id: 803, main: "Clouds", description: "", icon: "04d" }],
  wind: { speed: 5, deg: 315 },
  visibility: 10000,
  sys: { sunrise: 1, sunset: 2 },
  name: "Hamburg",
  timezone: 7200,
};

/** Forty 3-hour steps from 15:00Z, as the provider sends them: Monday (Berlin) gets only 02:00-14:00. */
function forecastFixture() {
  const start = Date.parse("2026-10-07T15:00:00Z") / 1000;
  return {
    list: Array.from({ length: 40 }, (_, i) => ({
      dt: start + i * 3 * H,
      main: { temp: 10 + (i % 8), feels_like: 9, temp_min: 0, temp_max: 0, humidity: 70 },
      weather: [{ id: 800, main: "Clear", description: "", icon: "01d" }],
      wind: { speed: 5 },
      pop: 0,
      dt_txt: "",
    })),
    city: { name: "Hamburg", coord: { lat: 53.55, lon: 10 }, timezone: 7200 },
  };
}

type Answer = { status: number; body?: unknown } | "throw";

async function withProvider<T>(answers: { air?: Answer; weather?: unknown }, fn: (urls: { url: string; init: unknown }[]) => Promise<T>) {
  const requests: { url: string; init: unknown }[] = [];
  const real = globalThis.fetch;
  const before = process.env.OPENWEATHERMAP_API_KEY;
  process.env.OPENWEATHERMAP_API_KEY = KEY;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    const path = new URL(url).pathname;
    if (path.endsWith("/air_pollution")) {
      const a = answers.air ?? { status: 200, body: { list: [{ main: { aqi: 2 } }] } };
      if (a === "throw") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
    }
    const body = path.endsWith("/forecast") ? forecastFixture() : (answers.weather ?? CURRENT);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    return await fn(requests);
  } finally {
    globalThis.fetch = real;
    if (before === undefined) delete process.env.OPENWEATHERMAP_API_KEY; else process.env.OPENWEATHERMAP_API_KEY = before;
  }
}

const current = async () => (await currentRoute(new NextRequest("https://kb.example.com/api/weather?city=Hamburg&lang=en&units=metric"))).json();

test.describe("air quality", () => {
  test("comes with the current weather: one more provider request, cached like it, by the provider's coordinates", async () => {
    await withProvider({}, async (requests) => {
      const body = await current();
      expect(body.airQuality).toBe(2);
      expect(requests).toHaveLength(2);
      const air = requests.find((r) => new URL(r.url).pathname.endsWith("/air_pollution"))!;
      expect(new URL(air.url).searchParams.get("lat")).toBe("53.55");
      expect(new URL(air.url).searchParams.get("lon")).toBe("10");
      expect(air.init).toEqual({ next: { revalidate: 600 } });
    });
  });

  for (const [label, air] of [
    ["refuses the key", { status: 401, body: { cod: 401 } }],
    ["has nothing for the place", { status: 200, body: { list: [] } }],
    ["sends an index off the 1-5 scale", { status: 200, body: { list: [{ main: { aqi: 7 } }] } }],
    ["cannot be reached", "throw"],
  ] as const) {
    test(`is left out, and the weather still comes, when the provider ${label}`, async () => {
      await withProvider({ air }, async () => {
        const body = await current();
        expect(body.temp).toBe(14);
        expect("airQuality" in body).toBe(false);
      });
    });
  }

  test("is not asked for without coordinates", async () => {
    const { coord: _coord, ...noCoord } = CURRENT;
    await withProvider({ weather: noCoord }, async (requests) => {
      const body = await current();
      expect("airQuality" in body).toBe(false);
      expect(requests).toHaveLength(1);
    });
    expect(await fetchAirQuality({ lat: 1, lon: 2 }, KEY, (async () => { throw new Error("x"); }) as typeof fetch)).toBeNull();
  });

  test("the card shows it only from Poor up; the detail view always", () => {
    expect([1, 2, 3, 4, 5].map((l) => aqiOnCard(l as 1))).toEqual([false, false, false, true, true]);
    expect(aqiOnCard(undefined)).toBe(false);
  });
});

test.describe("wind direction", () => {
  test("the current weather passes the provider's direction on, and leaves it out in calm air", async () => {
    await withProvider({}, async () => expect((await current()).windDeg).toBe(315));
    await withProvider({ weather: { ...CURRENT, wind: { speed: 0 } } }, async () => {
      expect("windDeg" in (await current())).toBe(false);
    });
  });

  test("degrees name the compass point the wind comes from", () => {
    expect([0, 10, 350, 44, 45, 90, 135, 180, 225, 270, 315, 360, -45, 720].map(compassPoint))
      .toEqual(["n", "n", "n", "ne", "ne", "e", "se", "s", "sw", "w", "nw", "n", "nw", "n"]);
    expect(compassPoint(undefined)).toBeNull();
    expect(compassPoint(Number.NaN)).toBeNull();
  });

  test("the arrow points downwind: a north wind blows south", () => {
    expect(windArrowRotation(0)).toBe(180);
    expect(windArrowRotation(270)).toBe(90);
    expect(windArrowRotation(315)).toBe(135);
  });
});

test.describe("today's range", () => {
  const daily = [
    { date: "2026-10-07", tempMax: 17, tempMin: 9 },
    { date: "2026-10-08", tempMax: 20, tempMin: 8 },
  ];
  const at = new Date("2026-10-07T13:30:00Z");

  test("is the forecast's day plus the reading now, not the city spread", () => {
    expect(todayRange(14, daily, 7200, at)).toEqual({ high: 17, low: 9 });
    // Warmer now than any step left today: the high is now.
    expect(todayRange(19, daily, 7200, at)).toEqual({ high: 19, low: 9 });
    expect(todayRange(5, daily, 7200, at)).toEqual({ high: 17, low: 5 });
  });

  test("follows the weather location's calendar, and is null without a day for today", () => {
    // 23:30Z on the 7th is already the 8th in Berlin.
    expect(locationDateKey(new Date("2026-10-07T23:30:00Z"), 7200)).toBe("2026-10-08");
    expect(todayRange(14, daily, 7200, new Date("2026-10-07T23:30:00Z"))).toEqual({ high: 20, low: 8 });
    expect(todayRange(14, daily, 7200, new Date("2026-10-10T12:00:00Z"))).toBeNull();
    expect(todayRange(14, undefined, 7200, at)).toBeNull();
  });
});

test.describe("the forecast's last day", () => {
  test("a last day the forecast reaches only for its first hours is left out", async () => {
    await withProvider({}, async () => {
      const res = await forecastRoute(new NextRequest("https://kb.example.com/api/weather/forecast?city=Hamburg&lang=en&units=metric"));
      const body = await res.json();
      // Wed (from 17:00) to Sun; Monday has only 02:00-14:00 and is dropped.
      expect(body.daily.map((d: { date: string }) => d.date)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    });
  });

  test("the first day stays even when partial; a whole last day stays", () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => i);
    expect(withoutPartialLastDay([["a", steps(3)], ["b", steps(8)], ["c", steps(5)]]).map(([d]) => d)).toEqual(["a", "b"]);
    expect(withoutPartialLastDay([["a", steps(3)], ["b", steps(8)]]).map(([d]) => d)).toEqual(["a", "b"]);
    expect(withoutPartialLastDay([["a", steps(3)]]).map(([d]) => d)).toEqual(["a"]);
  });
});
