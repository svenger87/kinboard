import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  installEnabled,
  isDue,
  parseSyncSetting,
  syncFamily,
  type SchoolSyncDeps,
  type SchoolSyncSetting,
  type SchoolSyncStore,
} from "../src/lib/school-sync/sync";
import type { FetchedBreak, SyncFetch } from "../src/lib/school-sync/openholidays";
import type { HolidayRegionSetting } from "../src/lib/holidays/region";
import { liveSchoolSyncFetch } from "../src/lib/school-sync/live";
import { codeOnly } from "./source-helpers";

/** RFC-014 §5.2 and §9, against a fake store and a counting fake fetch (§12). */

const NOW = new Date("2026-10-02T10:00:00Z");
const DAY = 86_400_000;
const ON: SchoolSyncSetting = {
  enabled: true, region: "DE-NI", group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null,
};
const ROW = (id: string, from: string, to: string) => ({
  id, startDate: from, endDate: to, type: "School", name: [{ language: "DE", text: `Ferien ${id}` }], nationwide: false,
  subdivisions: [{ code: "DE-NI" }],
});

class FakeStore implements SchoolSyncStore {
  applied: FetchedBreak[][] = [];
  cleared = 0;
  future = 0;
  constructor(public current: SchoolSyncSetting | null, public region: HolidayRegionSetting | null = { code: "DE-NI", chosen: true }) {}
  async holidayRegion() { return this.region; }
  async language() { return "de"; }
  async setting() { return this.current; }
  async saveSetting(_: string, s: SchoolSyncSetting) { this.current = s; }
  async deleteSetting() { this.current = null; }
  async futureSyncedCount() { return this.future; }
  async apply(_: string, rows: FetchedBreak[]) { this.applied.push(rows); }
  async clear() { this.cleared++; }
  async enabledFamilies() { return this.current?.enabled ? [{ familyId: "f", setting: this.current }] : []; }
}

function deps(store: FakeStore, answer: () => Response | Promise<Response>, installOn = true) {
  const calls: string[] = [];
  const fetch: SyncFetch = async (url) => { calls.push(url); return answer(); };
  const d: SchoolSyncDeps = { fetch, store, now: () => NOW, installEnabled: installOn, userAgent: "Kinboard/test (+https://github.com/svenger87/kinboard)", log: () => {} };
  return { d, calls };
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("a sync fetches once and hands the family's rows to the store", async () => {
  const store = new FakeStore(ON);
  const { d, calls } = deps(store, () => json([ROW("a", "2026-10-12", "2026-10-24"), ROW("b", "2026-12-23", "2027-01-06")]));
  expect(await syncFamily("f", d)).toEqual({ status: "synced", rows: 2 });
  expect(calls).toHaveLength(1);
  expect(store.applied).toEqual([[
    { externalId: "a", name: "Ferien a", startsOn: "2026-10-12", endsOn: "2026-10-24" },
    { externalId: "b", name: "Ferien b", startsOn: "2026-12-23", endsOn: "2027-01-06" },
  ]]);
  expect(store.current?.last_success_at).toBe(NOW.toISOString());
});

for (const [label, answer] of [
  ["DNS or a refused connection", () => { throw new TypeError("fetch failed"); }],
  ["a timeout", () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }],
  ["a 5xx", () => new Response("", { status: 502 })],
  ["a 4xx", () => new Response("", { status: 404 })],
  ["invalid JSON", () => new Response("{", { status: 200, headers: { "content-type": "application/json" } })],
  ["a schema mismatch", () => json({ rows: [] })],
] as const) {
  test(`${label} leaves every row as it was and records the error`, async () => {
    const store = new FakeStore({ ...ON, last_success_at: "2026-09-01T00:00:00.000Z" });
    const { d } = deps(store, answer as () => Response);
    const outcome = await syncFamily("f", d);
    expect(outcome.status).toBe("failed");
    expect(store.applied).toEqual([]);
    expect(store.cleared).toBe(0);
    expect(store.current).toMatchObject({ last_success_at: "2026-09-01T00:00:00.000Z", last_error_at: NOW.toISOString() });
    expect(store.current?.last_error).toBeTruthy();
  });
}

test("an empty answer where there were future rows is an error, not every holiday cancelled", async () => {
  const store = new FakeStore(ON);
  store.future = 3;
  const { d } = deps(store, () => json([]));
  expect((await syncFamily("f", d)).status).toBe("failed");
  expect(store.applied).toEqual([]);
});

test("an empty answer for a region with nothing stored yet is just empty", async () => {
  const store = new FakeStore(ON);
  const { d } = deps(store, () => json([]));
  expect(await syncFamily("f", d)).toEqual({ status: "synced", rows: 0 });
});

test("nothing is fetched while the switch is off, the install is off, the country is not covered, or a pick is pending", async () => {
  const cases: [FakeStore, boolean, string][] = [
    [new FakeStore({ ...ON, enabled: false }), true, "disabled"],
    [new FakeStore(null), true, "disabled"],
    [new FakeStore(ON), false, "install-off"],
    [new FakeStore(ON, { code: "GB-ENG", chosen: true }), true, "not-covered"],
    [new FakeStore(ON, { code: null, chosen: false }), true, "not-covered"],
    [new FakeStore({ ...ON, region: null, pending: "region" }), true, "needs-region"],
    [new FakeStore({ ...ON, region: "CH-GR", pending: "region" }, { code: "CH-GR", chosen: true }), true, "needs-region"],
    [new FakeStore({ ...ON, region: "NL-GE", pending: "group" }, { code: "NL", chosen: true }), true, "needs-group"],
  ];
  for (const [store, installOn, reason] of cases) {
    const { d, calls } = deps(store, () => json([]), installOn);
    expect(await syncFamily("f", d)).toEqual({ status: "skipped", reason });
    expect(calls, reason).toEqual([]);
  }
});

test("due means enabled, complete, and last synced over a week ago", () => {
  expect(isDue(ON, NOW)).toBe(true);
  expect(isDue({ ...ON, last_success_at: new Date(NOW.getTime() - 6 * DAY).toISOString() }, NOW)).toBe(false);
  expect(isDue({ ...ON, last_success_at: new Date(NOW.getTime() - 8 * DAY).toISOString() }, NOW)).toBe(true);
  expect(isDue({ ...ON, enabled: false }, NOW)).toBe(false);
  expect(isDue({ ...ON, pending: "group" }, NOW)).toBe(false);
  // A failing family is retried daily: only success moves it out of "due".
  expect(isDue({ ...ON, last_success_at: new Date(NOW.getTime() - 9 * DAY).toISOString(), last_error_at: NOW.toISOString() }, NOW)).toBe(true);
});

test("SCHOOL_HOLIDAY_SYNC=off turns the whole install off", () => {
  expect(installEnabled({})).toBe(true);
  expect(installEnabled({ SCHOOL_HOLIDAY_SYNC: "off" })).toBe(false);
  expect(installEnabled({ SCHOOL_HOLIDAY_SYNC: " OFF " })).toBe(false);
  expect(installEnabled({ SCHOOL_HOLIDAY_SYNC: "on" })).toBe(true);
});

test("the stored setting is validated", () => {
  expect(parseSyncSetting(ON)).toEqual(ON);
  expect(parseSyncSetting({ enabled: "yes" })).toBeNull();
  expect(parseSyncSetting(null)).toBeNull();
  expect(parseSyncSetting({ ...ON, pending: "elsewhere" })).toBeNull();
});

test("the live sync goes through safeFetch, identifies itself, and writes through the one SQL function", () => {
  const liveSource = readFileSync(join(process.cwd(), "src/lib/school-sync/live.ts"), "utf8");
  const live = codeOnly(liveSource);
  expect(live).toContain("safeFetch(url, init)");
  // On the raw source: codeOnly is not string-aware, and the "//" in the
  // URL would blank the rest of the line.
  expect(liveSource).toMatch(/^[^/\n]*Kinboard\/\$\{[^}]+\} \(\+https:\/\/github\.com\/svenger87\/kinboard\)/m);
  const store = codeOnly(readFileSync(join(process.cwd(), "src/lib/school-sync/store.ts"), "utf8"));
  expect(store).toContain('rpc("apply_school_holiday_sync"');
  expect(store).not.toMatch(/from\("school_holidays"\)\s*\.(insert|update|upsert|delete)/);
});

/* ---- Beyond the plan's cases: the recorded fixture, races, and the live fetch. ---- */

const fixtureBody = (name: string) => readFileSync(join(process.cwd(), "e2e/fixtures/openholidays", name), "utf8");

test("the recorded Niedersachsen answer becomes its eight breaks, and the request names the family's region", async () => {
  const store = new FakeStore(ON);
  const { d, calls } = deps(store, () => new Response(fixtureBody("school-de-ni.json"), { status: 200, headers: { "content-type": "application/json" } }));
  expect(await syncFamily("f", d)).toEqual({ status: "synced", rows: 8 });
  expect(calls).toHaveLength(1);
  const url = new URL(calls[0]);
  expect(url.searchParams.get("subdivisionCode")).toBe("DE-NI");
  expect(url.searchParams.get("validFrom")).toBe("2026-09-02");
  expect(store.applied[0].map((r) => r.name)).toContain("Herbstferien");
});

test("an answer that only had other regions' rows counts as empty, so future rows stay", async () => {
  const store = new FakeStore(ON);
  store.future = 2;
  const elsewhere = { ...ROW("x", "2026-10-12", "2026-10-24"), subdivisions: [{ code: "DE-BY" }] };
  const { d } = deps(store, () => json([elsewhere]));
  expect((await syncFamily("f", d)).status).toBe("failed");
  expect(store.applied).toEqual([]);
  expect(store.current?.last_error).toMatch(/no school holidays/);
});

test("a database error while applying is a failure, recorded, not thrown", async () => {
  const store = new FakeStore(ON);
  store.apply = async () => { throw { message: "permission denied for function apply_school_holiday_sync", code: "42501" }; };
  const { d } = deps(store, () => json([ROW("a", "2026-10-12", "2026-10-24")]));
  const outcome = await syncFamily("f", d);
  expect(outcome).toMatchObject({ status: "failed" });
  expect(store.current?.last_error).toMatch(/permission denied/);
  expect(store.current?.last_success_at).toBeNull();
});

for (const [label, change] of [
  ["switched off", (s: SchoolSyncSetting) => ({ ...s, enabled: false })],
  ["moved to another region", (s: SchoolSyncSetting) => ({ ...s, region: "DE-HB" })],
  ["given a group to pick", (s: SchoolSyncSetting) => ({ ...s, pending: "group" as const })],
] as const) {
  test(`a family ${label} while the request was out keeps what that change left`, async () => {
    const store = new FakeStore(ON);
    const { d } = deps(store, () => {
      store.current = change(store.current!);
      return json([ROW("a", "2026-10-12", "2026-10-24")]);
    });
    expect(await syncFamily("f", d)).toEqual({ status: "skipped", reason: "superseded" });
    expect(store.applied).toEqual([]);
    expect(store.current).toEqual(change(ON));
  });
}

test("a failure while the switch was turned off records the error without turning it back on", async () => {
  const store = new FakeStore(ON);
  const { d } = deps(store, () => {
    store.current = { ...store.current!, enabled: false };
    return new Response("", { status: 503 });
  });
  expect((await syncFamily("f", d)).status).toBe("failed");
  expect(store.current).toMatchObject({ enabled: false, last_error_at: NOW.toISOString() });
});

test("a failure after the setting was deleted does not bring it back", async () => {
  const store = new FakeStore(ON);
  const { d } = deps(store, () => {
    store.current = null;
    return new Response("", { status: 503 });
  });
  expect((await syncFamily("f", d)).status).toBe("failed");
  expect(store.current).toBeNull();
});

test("the live fetch is safeFetch with the running version in the User-Agent and the caller's signal", async () => {
  const version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;
  const real = globalThis.fetch;
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return json([]);
  }) as typeof fetch;
  try {
    const signal = AbortSignal.timeout(10_000);
    // .invalid never resolves, so nothing leaves the machine; safeFetch's
    // address check lets an unresolvable name through to fetch.
    await liveSchoolSyncFetch("https://openholidays.invalid/SchoolHolidays", { headers: { Accept: "application/json" }, signal });
    // A private address is refused before fetch is called: safeFetch, not fetch.
    await expect(liveSchoolSyncFetch("http://10.0.0.1/SchoolHolidays", { headers: {}, signal })).rejects.toThrow(/not a public address/);
  } finally {
    globalThis.fetch = real;
  }
  expect(seen).toHaveLength(1);
  expect(seen[0].init.redirect).toBe("manual");
  expect(seen[0].init.signal).toBeDefined();
  expect(seen[0].init.headers).toEqual({
    Accept: "application/json",
    "User-Agent": `Kinboard/${version} (+https://github.com/svenger87/kinboard)`,
  });
});
