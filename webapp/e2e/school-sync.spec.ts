import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  installEnabled,
  isDue,
  parseSyncSetting,
  syncFamily,
  INTERNAL_SYNC_ERROR,
  type SchoolSyncDeps,
  type SchoolSyncSetting,
  type SchoolSyncStore,
} from "../src/lib/school-sync/sync";
import type { FetchedBreak, SyncFetch } from "../src/lib/school-sync/openholidays";
import type { HolidayRegionSetting } from "../src/lib/holidays/region";
import { liveSchoolSyncFetch } from "../src/lib/school-sync/live";
import { liveSchoolSyncStore } from "../src/lib/school-sync/store";
import { codeOnly } from "./source-helpers";
import { COUNTRY_LANGUAGE, regionLanguage } from "../src/lib/family-language";

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

/** Mirrors apply_school_holiday_sync and record_school_holiday_sync_error: check, write and status in one step. */
class FakeStore implements SchoolSyncStore {
  applied: FetchedBreak[][] = [];
  windows: { from: string; to: string }[] = [];
  cleared = 0;
  future = 0;
  zone = "Europe/Berlin";
  constructor(public current: SchoolSyncSetting | null, public region: HolidayRegionSetting | null = { code: "DE-NI", chosen: true }) {}
  async holidayRegion() { return this.region; }
  async language(_familyId?: string) { return "de"; }
  async timeZone() { return this.zone; }
  async setting() { return this.current; }
  async saveSetting(_: string, s: SchoolSyncSetting) { this.current = s; }
  async deleteSetting() { this.current = null; }
  async futureSyncedCount() { return this.future; }
  async apply(_: string, rows: FetchedBreak[], window: { from: string; to: string }, expect: { region: string; group: string | null }, syncedAt: string) {
    const c = this.current;
    if (!c || !c.enabled || c.pending !== null || c.region !== expect.region || c.group !== expect.group) return { superseded: true };
    this.applied.push(rows);
    this.windows.push(window);
    this.current = { ...c, last_success_at: syncedAt, last_error_at: null, last_error: null };
    return { superseded: false };
  }
  async recordError(_: string, at: string, message: string, expect: { region: string | null; group: string | null } | null) {
    const c = this.current;
    if (!c) return;
    if (expect !== null && expect.region !== null && (!c.enabled || c.region !== expect.region || c.group !== expect.group)) return;
    this.current = { ...c, last_error_at: at, last_error: message };
  }
  async clear() { this.cleared++; }
  async enabledFamilies() { return this.current?.enabled ? [{ familyId: "f", setting: this.current }] : []; }
  async unsetFamilies() { return []; }
  async saveSettingIfAbsent(_: string, s: SchoolSyncSetting) {
    if (this.current) return false;
    this.current = s;
    return true;
  }
}

function deps(store: FakeStore, answer: () => Response | Promise<Response>, installOn = true, now = NOW) {
  const calls: string[] = [];
  const logs: string[] = [];
  const fetch: SyncFetch = async (url) => { calls.push(url); return answer(); };
  const d: SchoolSyncDeps = {
    fetch, store, now: () => now, installEnabled: installOn, userAgent: "Kinboard/test (+https://github.com/svenger87/kinboard)",
    log: (m) => { logs.push(m); },
  };
  return { d, calls, logs };
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

test("a database error while applying is a failure, recorded, not thrown, and its detail stays in the log", async () => {
  const store = new FakeStore(ON);
  store.apply = async () => { throw { message: "permission denied for function apply_school_holiday_sync", code: "42501" }; };
  const { d, logs } = deps(store, () => json([ROW("a", "2026-10-12", "2026-10-24")]));
  const outcome = await syncFamily("f", d);
  expect(outcome).toEqual({ status: "failed", error: INTERNAL_SYNC_ERROR });
  expect(store.current?.last_error).toBe(INTERNAL_SYNC_ERROR);
  expect(store.current?.last_success_at).toBeNull();
  expect(logs.join("\n")).toMatch(/permission denied/);
});

for (const where of ["setting", "holidayRegion", "timeZone"] as const) {
  test(`a database error reading the ${where} is a recorded failure, never a throw`, async () => {
    const store = new FakeStore(ON);
    const real = store[where].bind(store);
    let first = true;
    // Only the first read fails, so the error can still be recorded.
    (store as unknown as Record<string, unknown>)[where] = async (...args: unknown[]) => {
      if (first) { first = false; throw { message: "connection reset", code: "08006" }; }
      return (real as (...a: unknown[]) => unknown)(...args);
    };
    const { d, calls } = deps(store, () => json([]));
    expect(await syncFamily("f", d)).toEqual({ status: "failed", error: INTERNAL_SYNC_ERROR });
    expect(calls).toEqual([]);
    expect(store.current).toMatchObject({ enabled: true, last_error_at: NOW.toISOString(), last_error: INTERNAL_SYNC_ERROR });
  });
}

test("a slow failure for the old region is not recorded on the new one (final review #4)", async () => {
  const store = new FakeStore({ ...ON, last_success_at: "2026-09-30T00:00:00.000Z" });
  const recorded: unknown[] = [];
  const record = store.recordError.bind(store);
  store.recordError = async (...args) => { recorded.push(args[3]); return record(...args); };
  const BY = { ...ON, region: "DE-BY", last_success_at: null };
  // The family picks Bavaria while the request for Lower Saxony is out; then it fails.
  const { d } = deps(store, () => { store.current = BY; return new Response("", { status: 502 }); });
  expect((await syncFamily("f", d)).status).toBe("failed");
  expect(recorded).toEqual([{ region: "DE-NI", group: null }]);
  expect(store.current).toEqual(BY);
});

test("a failure to record the error is logged, and the sync still resolves", async () => {
  const store = new FakeStore(ON);
  store.recordError = async () => { throw new Error("connection reset"); };
  const { d, logs } = deps(store, () => new Response("", { status: 502 }));
  expect(await syncFamily("f", d)).toMatchObject({ status: "failed" });
  expect(logs.join("\n")).toMatch(/could not record the error/);
});

test("today is the family's day: just before midnight UTC it is already tomorrow in Berlin", async () => {
  const store = new FakeStore(ON);
  const { d, calls } = deps(store, () => json([ROW("a", "2026-10-12", "2026-10-24")]), true, new Date("2026-10-01T23:30:00Z"));
  await syncFamily("f", d);
  expect(new URL(calls[0]).searchParams.get("validFrom")).toBe("2026-09-02");
  store.zone = "UTC";
  const utc = deps(store, () => json([ROW("a", "2026-10-12", "2026-10-24")]), true, new Date("2026-10-01T23:30:00Z"));
  await syncFamily("f", utc.d);
  expect(new URL(utc.calls[0]).searchParams.get("validFrom")).toBe("2026-09-01");
});

test("a switch flipped after the early look but before the write is caught by apply's own check", async () => {
  const store = new FakeStore({ ...ON, enabled: false });
  // Every read says "on"; only apply sees the row as it is under the lock.
  store.setting = async () => ON;
  const { d } = deps(store, () => json([ROW("a", "2026-10-12", "2026-10-24")]));
  expect(await syncFamily("f", d)).toEqual({ status: "skipped", reason: "superseded" });
  expect(store.applied).toEqual([]);
  expect(store.current).toEqual({ ...ON, enabled: false });
});

test("a success clears an earlier error", async () => {
  const store = new FakeStore({ ...ON, last_error_at: "2026-09-30T00:00:00.000Z", last_error: "OpenHolidays answered 502" });
  const { d } = deps(store, () => json([ROW("a", "2026-10-12", "2026-10-24")]));
  expect((await syncFamily("f", d)).status).toBe("synced");
  expect(store.current).toEqual({ ...ON, last_success_at: NOW.toISOString() });
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

test("a failure while the switch was turned off neither turns it back on nor marks it as failing", async () => {
  const store = new FakeStore(ON);
  const { d } = deps(store, () => {
    store.current = { ...store.current!, enabled: false };
    return new Response("", { status: 503 });
  });
  expect((await syncFamily("f", d)).status).toBe("failed");
  // Final review #4: the error was for a choice the family no longer holds.
  expect(store.current).toMatchObject({ enabled: false, last_error_at: null });
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
    // TEST-NET-3: a public literal, so safeFetch lets it through to the
    // stubbed fetch, and looking up a literal sends no DNS query.
    await liveSchoolSyncFetch("https://203.0.113.1/SchoolHolidays", { headers: { Accept: "application/json" }, signal });
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

/**
 * The language synced names are fetched in (prod, v1.13.0-rc.2: a DE-NI
 * family with no saved `locale` got English school-holiday names, because
 * the `locale` row is only written by the language switcher). The saved
 * `locale` wins; else the holiday region's country; else English.
 */
test.describe("the language synced names are fetched in", () => {
  type Settings = Record<string, unknown>;
  const settingsDb = (rows: Settings, error: { key: string; message: string } | null = null) => {
    const make = () => {
      let key: unknown;
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => { if (column === "key") key = value; return chain; },
        maybeSingle: async () => {
          if (error && error.key === key) return { data: null, error: { message: error.message } };
          return { data: typeof key === "string" && key in rows ? { value: rows[key] } : null, error: null };
        },
      };
      return chain;
    };
    return { from: () => make() } as unknown as Parameters<typeof liveSchoolSyncStore>[0];
  };
  const region = (code: string, chosen = true) => ({ holiday_region: { code, chosen } });
  const language = (rows: Settings) => liveSchoolSyncStore(settingsDb(rows)).language("f");

  test("a German family with no saved language syncs in German (the prod report)", async () => {
    const live = liveSchoolSyncStore(settingsDb(region("DE-NI")));
    const store = new FakeStore(ON);
    store.language = (familyId: string) => live.language(familyId);
    const { d, calls } = deps(store, () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    await syncFamily("f", d);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get("languageIsoCode")).toBe("DE");
    // The backfilled, never-chosen region counts too.
    expect(await language(region("DE-NI", false))).toBe("de");
  });

  test("UK and US families get English; French, Austrian, Swiss and Belgian families their region's language", async () => {
    expect(await language(region("GB-ENG"))).toBe("en");
    expect(await language(region("US-CA"))).toBe("en");
    expect(await language(region("FR"))).toBe("fr");
    expect(await language(region("BE"))).toBe("fr");
    expect(await language(region("AT-9"))).toBe("de");
    expect(await language(region("CH-ZH"))).toBe("de");
    expect(await language(region("NL"))).toBe("en");
  });

  test("a saved language always wins over the region", async () => {
    expect(await language({ ...region("DE-NI"), locale: "en" })).toBe("en");
    expect(await language({ ...region("GB-ENG"), locale: "de" })).toBe("de");
    expect(await language({ ...region("DE-NI"), locale: "fr" })).toBe("fr");
  });

  test("no region, or a language Kinboard does not ship and no region, is English", async () => {
    expect(await language({})).toBe("en");
    expect(await language({ locale: "xx" })).toBe("en");
    expect(await language({ holiday_region: { code: "ZZ-99", chosen: true } })).toBe("en");
    // An unshipped saved language does not hide the region.
    expect(await language({ ...region("DE-NI"), locale: "xx" })).toBe("de");
  });

  test("a failed read throws rather than guessing", async () => {
    await expect(liveSchoolSyncStore(settingsDb(region("DE-NI"), { key: "locale", message: "down" })).language("f")).rejects.toMatchObject({ message: "down" });
    await expect(liveSchoolSyncStore(settingsDb({}, { key: "holiday_region", message: "down" })).language("f")).rejects.toMatchObject({ message: "down" });
    // A saved language needs no region, so an unreadable region does not matter then.
    expect(await liveSchoolSyncStore(settingsDb({ locale: "de" }, { key: "holiday_region", message: "down" })).language("f")).toBe("de");
  });

  test("the country map is small and explicit", () => {
    expect(COUNTRY_LANGUAGE).toEqual({ DE: "de", AT: "de", LI: "de", CH: "de", FR: "fr", MC: "fr", LU: "fr", BE: "fr" });
    expect(regionLanguage("LI")).toBe("de");
    expect(regionLanguage("MC")).toBe("fr");
    expect(regionLanguage("LU")).toBe("fr");
    expect(regionLanguage(null)).toBeNull();
  });

  test("the region picker's names are fetched in the same language as the sync's", () => {
    for (const route of ["options", "sync"]) {
      const source = codeOnly(readFileSync(join(process.cwd(), `src/app/api/school-holidays/${route}/route.ts`), "utf8"));
      expect(source, route).toMatch(/schoolRegionOptions\([^;]*deps\.store\.language\(familyId\)|const language = await deps\.store\.language\(familyId\);[\s\S]*schoolRegionOptions\([^;]*language/);
    }
  });
});
