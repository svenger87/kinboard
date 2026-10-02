import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applySyncChange,
  fetchIfReady,
  reconcileOnRegionPick,
  restoredSyncSetting,
  type RegionOptions,
  type SyncChange,
} from "../src/lib/school-sync/reconcile";
import { resetOptionsCache, schoolRegionOptions } from "../src/lib/school-sync/options";
import { backingOff, syncLimited } from "../src/lib/school-sync/limit";
import { defaultSchoolRegion } from "../src/lib/school-sync/school-region";
import type { SchoolSyncDeps, SchoolSyncSetting, SchoolSyncStore } from "../src/lib/school-sync/sync";
import type { FetchedBreak, SyncFetch } from "../src/lib/school-sync/openholidays";
import type { HolidayRegionSetting } from "../src/lib/holidays/region";
import { codeOnly } from "./source-helpers";

/** RFC-014 §5.2, §5.4 and §6.2: the switch, its default, and which changes empty the synced rows. */

const FRESH = { last_success_at: null, last_error_at: null, last_error: null };
const SYNCED: SchoolSyncSetting = {
  enabled: true, region: "DE-NI", group: null, pending: null,
  last_success_at: "2026-09-30T00:00:00.000Z", last_error_at: null, last_error: null,
};
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test.describe("picking a public-holiday region", () => {
  test("turns the sync on the first time, where OpenHolidays covers the country", () => {
    expect(reconcileOnRegionPick("DE-NI", "DE-NI", null, true)).toEqual({
      setting: { enabled: true, region: "DE-NI", group: null, pending: null, ...FRESH }, clear: false,
    });
    expect(reconcileOnRegionPick(null, "AT-9", null, true).setting).toMatchObject({ enabled: true, region: "AT-WI" });
    expect(reconcileOnRegionPick(null, "NL", null, true).setting).toMatchObject({ enabled: true, region: null, pending: "region" });
  });

  test("does nothing where there is no sync: GB, the US, an install that switched it off", () => {
    expect(reconcileOnRegionPick(null, "GB-SCT", null, true)).toEqual({ setting: null, clear: false });
    expect(reconcileOnRegionPick(null, "DE-NI", null, false)).toEqual({ setting: null, clear: false });
    // Moving to an uncovered country clears what was synced and forgets the decision.
    expect(reconcileOnRegionPick("DE-NI", "US-CA", SYNCED, true)).toEqual({ setting: null, clear: true });
  });

  test("confirming the same region changes nothing", () => {
    expect(reconcileOnRegionPick("DE-NI", "DE-NI", SYNCED, true)).toEqual({ setting: SYNCED, clear: false });
  });

  test("a new region is off and then on: the old rows go, the new region is fetched", () => {
    expect(reconcileOnRegionPick("DE-NI", "DE-BY", SYNCED, true)).toEqual({
      setting: { enabled: true, region: "DE-BY", group: null, pending: null, ...FRESH }, clear: true,
    });
  });

  test("a family that switched it off keeps it off", () => {
    const off = { ...SYNCED, enabled: false };
    expect(reconcileOnRegionPick("DE-NI", "DE-BY", off, true).setting).toMatchObject({ enabled: false, region: "DE-BY" });
  });
});

test.describe("a change from the card", () => {
  const NI = { region: "DE-NI", group: null, pending: null } as const;
  const GR: RegionOptions = {
    subdivisions: [{ code: "CH-GR", name: "Graubünden" }, { code: "CH-ZH", name: "Zürich" }],
    children: [{ code: "CH-GR-ML", name: "Maloja" }, { code: "CH-GR-MS", name: "Moesa" }],
    groups: [{ code: "CH-GR-VS", name: "Volksschule" }],
  };
  const GE: RegionOptions = {
    subdivisions: [{ code: "NL-GE", name: "Gelderland" }],
    children: [],
    groups: [{ code: "NL-MI", name: "midden" }, { code: "NL-NO", name: "noord" }],
  };

  test("switching off empties the synced rows; switching on starts from the default", () => {
    expect(applySyncChange(SYNCED, { enabled: false }, NI, null)).toEqual({ setting: { ...SYNCED, enabled: false }, clear: true });
    expect(applySyncChange(null, { enabled: true }, NI, null)).toEqual({
      setting: { enabled: true, ...NI, ...FRESH }, clear: false,
    });
    // Back on after off: the rows went with "off", so the family is due again
    // (a rate-limited Refresh leaves it to the cron, not to next week).
    expect(applySyncChange({ ...SYNCED, enabled: false }, { enabled: true }, NI, null)).toEqual({
      setting: { ...SYNCED, ...FRESH }, clear: false,
    });
    // Already on: "on" changes nothing.
    expect(applySyncChange(SYNCED, { enabled: true }, NI, null)).toEqual({ setting: SYNCED, clear: false });
  });

  test("a canton scoped below itself waits for the Region; the Region brings its only group", () => {
    const parent = applySyncChange(SYNCED, { region: "CH-GR" }, NI, GR);
    expect(parent).toEqual({ setting: { ...SYNCED, region: "CH-GR", group: null, pending: "region", ...FRESH }, clear: true });
    const child = applySyncChange((parent as { setting: SchoolSyncSetting }).setting, { region: "CH-GR-ML" }, NI, GR);
    expect(child).toEqual({ setting: { ...SYNCED, region: "CH-GR-ML", group: "CH-GR-VS", pending: null, ...FRESH }, clear: true });
  });

  test("a province split between regions waits for the group", () => {
    const province = applySyncChange(null, { enabled: true, region: "NL-GE" }, { region: null, group: null, pending: "region" }, GE);
    expect(province).toMatchObject({ setting: { enabled: true, region: "NL-GE", group: null, pending: "group" } });
    const group = applySyncChange((province as { setting: SchoolSyncSetting }).setting, { group: "NL-MI" }, NI, GE);
    expect(group).toMatchObject({ setting: { region: "NL-GE", group: "NL-MI", pending: null }, clear: true });
  });

  test("codes that were not offered are refused", () => {
    expect(applySyncChange(SYNCED, { region: "CH-XX" }, NI, GR)).toEqual({ error: "invalid_region" });
    expect(applySyncChange(SYNCED, { region: "CH-GR-ML", group: "CH-ZH-VS" }, NI, GR)).toEqual({ error: "invalid_group" });
    expect(applySyncChange(SYNCED, { group: "NL-ZU" }, NI, GE)).toEqual({ error: "invalid_group" });
  });

  test("an empty change (Refresh now) keeps everything", () => {
    expect(applySyncChange(SYNCED, {}, NI, null)).toEqual({ setting: SYNCED, clear: false });
  });
});

test("options: Graubünden offers the Regions its rows use, and they are cached for a day", async () => {
  resetOptionsCache();
  const subdivisions = [
    { code: "CH-GR", name: [{ language: "DE", text: "Graubünden" }], children: [
      { code: "CH-GR-ML", name: [{ language: "DE", text: "Maloja" }] },
      { code: "CH-GR-MS", name: [{ language: "DE", text: "Moesa" }] },
      { code: "CH-GR-XX", name: [{ language: "DE", text: "Nirgendwo" }] },
    ] },
    { code: "CH-ZH", name: [{ language: "DE", text: "Zürich" }] },
  ];
  const groups = [{ code: "CH-GR-VS", name: [{ language: "DE", text: "Volksschule" }], subdivisions: [{ code: "CH-GR" }] }];
  const rows = JSON.parse(read("e2e/fixtures/openholidays/school-ch-gr.json"));
  const calls: string[] = [];
  const fetch: SyncFetch = async (url) => {
    calls.push(new URL(url).pathname);
    const body = url.includes("/Subdivisions") ? subdivisions : url.includes("/Groups") ? groups : rows;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const deps = { fetch, userAgent: "Kinboard/test (+https://github.com/svenger87/kinboard)", now: () => new Date("2026-10-02T10:00:00Z") };
  const options = await schoolRegionOptions("CH", "CH-GR", "de", deps);
  expect(options.subdivisions.map((s) => s.code)).toEqual(["CH-GR", "CH-ZH"]);
  expect(options.children.map((c) => c.code)).toEqual(["CH-GR-ML", "CH-GR-MS"]);
  expect(options.groups).toEqual([{ code: "CH-GR-VS", name: "Volksschule" }]);
  await schoolRegionOptions("CH", "CH-GR", "de", deps);
  expect(calls).toEqual(["/Subdivisions", "/Groups", "/SchoolHolidays"]);
});

test("the routes take the family from the session and fetch at most once a minute", () => {
  const sync = codeOnly(read("src/app/api/school-holidays/sync/route.ts"));
  for (const route of [sync, codeOnly(read("src/app/api/school-holidays/options/route.ts"))]) {
    expect(route).toContain("requireSession(request)");
    expect(route).toContain("auth.session.familyId");
    expect(route).not.toMatch(/family_id/);
  }
  expect(sync).toContain("syncLimited(familyId)");
  const region = codeOnly(read("src/app/api/holidays/region/route.ts"));
  expect(region).toContain("reconcileOnRegionPick(");
  expect(region).toContain("syncLimited(familyId)");
  expect(codeOnly(read("src/lib/school-sync/limit.ts"))).toMatch(/hitLimit\(`school-sync:\$\{familyId\}`, 1, 60_000\)/);
  // Task 12 review #1: the setting is saved before the rows are cleared, so a
  // sync in flight re-checks it and cannot write the old rows back.
  for (const route of [sync, region]) {
    const save = route.search(/store\.(saveSetting|deleteSetting)\(/);
    expect(save).toBeGreaterThan(-1);
    expect(save).toBeLessThan(route.indexOf("store.clear("));
  }
  const settings = codeOnly(read("src/app/api/settings/route.ts"));
  expect(settings).toMatch(/\[SETTINGS_KEYS\.schoolHolidaySync\]: "\/api\/school-holidays\/sync"/);
});

test("the cron route is behind CRON_SECRET, honours the off switch, and only syncs families that are due", () => {
  const route = codeOnly(read("src/app/api/cron/sync-school-holidays/route.ts"));
  expect(route).toContain("`Bearer ${CRON_SECRET}`");
  expect(route).toContain("deps.installEnabled");
  expect(route).toContain("runSchoolSyncCron(deps)");
  // The run itself (e2e/school-sync-cron.spec.ts drives it with a fake store).
  const cron = codeOnly(read("src/lib/school-sync/cron.ts"));
  expect(cron).toContain("if (!deps.installEnabled)");
  expect(cron).toContain("isDue(setting, now)");
  // One family's thrown error does not end the run for the rest.
  expect(cron).toMatch(/try \{\s*const outcome = await syncFamily\(familyId, deps\)/);
});

test("the job is wired like sync-ics, and operators can switch it off", () => {
  expect(read("docker/Dockerfile")).toContain("http://localhost:3000/api/cron/sync-school-holidays");
  const compose = read("docker/docker-compose.yml");
  expect(compose).toContain('ofelia.job-exec.sync-school-holidays.schedule: "@every 24h"');
  expect(compose).toContain('ofelia.job-exec.sync-school-holidays.command: "/usr/local/bin/sync-school-holidays"');
  expect(compose).toMatch(/SCHOOL_HOLIDAY_SYNC: \$\{SCHOOL_HOLIDAY_SYNC:-\}/);
  expect(read("docker/ofelia.demo.ini")).toMatch(/\[job-exec "sync-school-holidays"\]\nschedule = @every 10m/);
  expect(read("docker/.env.example")).toMatch(/^SCHOOL_HOLIDAY_SYNC=$/m);
});

// ---- Fix round 1 -----------------------------------------------------------

/** Mirrors the store contract the session routes use (and apply's re-check). */
class RouteStore implements SchoolSyncStore {
  applied: FetchedBreak[][] = [];
  cleared = 0;
  constructor(public region: HolidayRegionSetting, public current: SchoolSyncSetting | null = null) {}
  async holidayRegion() { return this.region; }
  async language() { return "de"; }
  async timeZone() { return "Europe/Zurich"; }
  async setting() { return this.current; }
  async saveSetting(_: string, s: SchoolSyncSetting) { this.current = s; }
  async deleteSetting() { this.current = null; }
  async futureSyncedCount() { return 0; }
  async apply(_: string, rows: FetchedBreak[], __: { from: string; to: string }, expect: { region: string; group: string | null }, syncedAt: string) {
    const c = this.current;
    if (!c || !c.enabled || c.pending !== null || c.region !== expect.region || c.group !== expect.group) return { superseded: true };
    this.applied.push(rows);
    this.current = { ...c, last_success_at: syncedAt, last_error_at: null, last_error: null };
    return { superseded: false };
  }
  async recordError() {}
  async clear() { this.cleared++; }
  async enabledFamilies() { return []; }
  async unsetFamilies() { return []; }
  async saveSettingIfAbsent() { return false; }
}

/** What POST /api/school-holidays/sync does with a change, minus HTTP: the route's own steps, in its order. */
async function post(familyId: string, store: RouteStore, change: SyncChange, options: RegionOptions | null, deps: SchoolSyncDeps, limits: string[]) {
  const derived = defaultSchoolRegion(store.region.code!)!;
  const result = applySyncChange(await store.setting(), change, derived, options);
  if ("error" in result) throw new Error(result.error);
  await store.saveSetting(familyId, result.setting);
  if (result.clear) await store.clear();
  return fetchIfReady(familyId, result.setting, deps, () => { limits.push(familyId); return syncLimited(familyId); });
}

function routeDeps(store: RouteStore, body: unknown): { deps: SchoolSyncDeps; calls: string[] } {
  const calls: string[] = [];
  const fetch: SyncFetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return {
    calls,
    deps: {
      fetch, store, now: () => new Date("2026-10-02T10:00:00Z"), installEnabled: true,
      userAgent: "Kinboard/test (+https://github.com/svenger87/kinboard)", log: () => {},
    },
  };
}

test.describe("a two-step pick fetches on the second step (review #1)", () => {
  test("a Dutch province, then its group", async () => {
    const family = `claude-nl-${Date.now()}`;
    const store = new RouteStore({ code: "NL", chosen: true });
    const { deps, calls } = routeDeps(store, []);
    const limits: string[] = [];
    const GE: RegionOptions = {
      subdivisions: [{ code: "NL-GE", name: "Gelderland" }],
      children: [],
      groups: [{ code: "NL-MI", name: "midden" }, { code: "NL-NO", name: "noord" }],
    };
    expect(await post(family, store, { region: "NL-GE" }, GE, deps, limits)).toEqual({ status: "skipped", reason: "needs-group" });
    expect(limits).toEqual([]);
    expect(await post(family, store, { group: "NL-MI" }, GE, deps, limits)).toEqual({ status: "synced", rows: 0 });
    expect(limits).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(store.current).toMatchObject({ enabled: true, region: "NL-GE", group: "NL-MI", pending: null, last_success_at: "2026-10-02T10:00:00.000Z" });
    // And the minute is now used: a Refresh right after is limited, without a request.
    expect(await post(family, store, {}, null, deps, limits)).toMatchObject({ status: "rate-limited" });
    expect(calls).toHaveLength(1);
  });

  test("Graubünden, then one of its Regions", async () => {
    const family = `claude-gr-${Date.now()}`;
    const store = new RouteStore({ code: "CH-GR", chosen: true });
    const { deps, calls } = routeDeps(store, JSON.parse(read("e2e/fixtures/openholidays/school-ch-gr-ml.json")));
    const limits: string[] = [];
    const GR: RegionOptions = {
      subdivisions: [{ code: "CH-GR", name: "Graubünden" }],
      children: [{ code: "CH-GR-ML", name: "Maloja" }],
      groups: [{ code: "CH-GR-VS", name: "Volksschule" }],
    };
    // A Refresh before the Region is picked: nothing to fetch, nothing used up.
    expect(await post(family, store, {}, null, deps, limits)).toEqual({ status: "skipped", reason: "needs-region" });
    expect(await post(family, store, { region: "CH-GR" }, GR, deps, limits)).toEqual({ status: "skipped", reason: "needs-region" });
    expect(limits).toEqual([]);
    const second = await post(family, store, { region: "CH-GR-ML" }, GR, deps, limits);
    expect(second.status).toBe("synced");
    expect((second as { rows: number }).rows).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(store.current).toMatchObject({ region: "CH-GR-ML", group: "CH-GR-VS", pending: null });
  });

  test("off asks no limit; a limited fetch says so", async () => {
    const store = new RouteStore({ code: "DE-NI", chosen: true });
    const { deps, calls } = routeDeps(store, []);
    const never = () => { throw new Error("asked the limit"); };
    expect(await fetchIfReady("f", { ...SYNCED, enabled: false }, deps, never)).toEqual({ status: "skipped", reason: "disabled" });
    expect(await fetchIfReady("f", SYNCED, deps, () => ({ limited: true, retryAfterMs: 1234 }))).toEqual({ status: "rate-limited", retryAfterMs: 1234 });
    expect(calls).toEqual([]);
  });
});

test("no row with a chosen, covered region is the default, on: a Refresh saves it on (review #2)", () => {
  const NI = { region: "DE-NI", group: null, pending: null } as const;
  expect(applySyncChange(null, {}, NI, null)).toEqual({ setting: { enabled: true, ...NI, ...FRESH }, clear: false });
  expect(applySyncChange(null, { enabled: false }, NI, null)).toMatchObject({ setting: { enabled: false } });
});

test("re-picking the same region repairs a sync that still names another (review #3)", () => {
  // The region was saved as DE-BY; the sync update that should have followed failed.
  expect(reconcileOnRegionPick("DE-BY", "DE-BY", SYNCED, true)).toEqual({
    setting: { enabled: true, region: "DE-BY", group: null, pending: null, ...FRESH }, clear: true,
  });
  // A switched-off family stays off while being repaired.
  expect(reconcileOnRegionPick("DE-BY", "DE-BY", { ...SYNCED, enabled: false }, true).setting).toMatchObject({ enabled: false, region: "DE-BY" });
  // A choice the card made inside the region is kept.
  const maloja = { ...SYNCED, region: "CH-GR-ML", group: "CH-GR-VS" };
  expect(reconcileOnRegionPick("CH-GR", "CH-GR", maloja, true)).toEqual({ setting: maloja, clear: false });
  const gelderland = { ...SYNCED, region: "NL-GE", group: "NL-MI" };
  expect(reconcileOnRegionPick("NL", "NL", gelderland, true)).toEqual({ setting: gelderland, clear: false });
});

test("the cron leaves a failing family alone for an hour, and a reseeded one not at all", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const failed = (at: string, success: string | null = null) => ({ ...SYNCED, last_success_at: success, last_error_at: at, last_error: "down" });
  expect(backingOff(failed("2026-10-02T09:30:00Z"), now)).toBe(true);
  expect(backingOff(failed("2026-10-02T08:59:00Z"), now)).toBe(false);
  expect(backingOff(failed("2026-10-02T09:30:00Z", "2026-10-02T09:40:00Z"), now)).toBe(false);
  expect(backingOff({ ...SYNCED, ...FRESH }, now)).toBe(false);
});

test("a restored backup keeps the family's choice and drops the old status", () => {
  const old = { ...SYNCED, region: "CH-ZH", group: "CH-ZH-VS", last_error_at: "2026-09-01T00:00:00Z", last_error: "down" };
  expect(restoredSyncSetting(old)).toEqual({ ...old, ...FRESH });
  expect(restoredSyncSetting({ enabled: "yes" })).toBeNull();
  expect(codeOnly(read("src/app/api/import/route.ts"))).toContain("restoredSyncSetting(row.value)");
});

test("both session routes fetch through fetchIfReady, and the region route reports what happened", () => {
  const sync = codeOnly(read("src/app/api/school-holidays/sync/route.ts"));
  expect(sync.match(/syncLimited\(/g)).toHaveLength(1);
  expect(sync).toContain("fetchIfReady(familyId, change.setting, deps, () => syncLimited(familyId))");
  expect(sync).not.toContain("syncFamily(");
  const region = codeOnly(read("src/app/api/holidays/region/route.ts"));
  expect(region).toContain("fetchIfReady(familyId, result.setting, deps, () => syncLimited(familyId))");
  expect(region).not.toContain("syncFamily(");
  expect(region).toContain('outcome = { status: "failed", error: INTERNAL_SYNC_ERROR }');
  const cron = codeOnly(read("src/lib/school-sync/cron.ts"));
  expect(cron).toContain("isDue(setting, now) && !backingOff(setting, now)");
  const store = codeOnly(read("src/lib/school-sync/store.ts"));
  expect(store).toContain('.eq("value->>enabled", "true")');
  expect(store).toContain(".range(from, from + ENABLED_PAGE - 1)");
});
