import { test, expect } from "@playwright/test";
import { runSchoolSyncCron } from "../src/lib/school-sync/cron";
import type { SchoolSyncDeps, SchoolSyncSetting, SchoolSyncStore } from "../src/lib/school-sync/sync";
import type { FetchedBreak, SyncFetch } from "../src/lib/school-sync/openholidays";
import type { HolidayRegionSetting } from "../src/lib/holidays/region";

/**
 * The weekly cron (RFC-014 §5.2), against a fake store holding several
 * families. Final review #2: a family with a chosen, covered region and no
 * sync setting has the default, on -- the card shows it so -- and the cron
 * must sync it too, not only the families whose setting some change saved.
 */

const NOW = new Date("2026-10-02T10:00:00Z");
const FRESH = { last_success_at: null, last_error_at: null, last_error: null };
const ON = (region: string, extra: Partial<SchoolSyncSetting> = {}): SchoolSyncSetting => ({
  enabled: true, region, group: null, pending: null, ...FRESH, ...extra,
});

class CronStore implements SchoolSyncStore {
  settings = new Map<string, SchoolSyncSetting>();
  regions = new Map<string, HolidayRegionSetting>();
  applied: string[] = [];
  inserts: string[] = [];
  /** A pick a session route saves between the cron's listing and its insert. */
  raceOn: string | null = null;
  /** The public-holiday region; a family set up with only a sync setting picked the matching one. */
  async holidayRegion(f: string): Promise<HolidayRegionSetting | null> {
    const region = this.settings.get(f)?.region ?? null;
    return this.regions.get(f) ?? (region ? { code: region, chosen: true } : null);
  }
  async language() { return "de"; }
  async timeZone() { return "Europe/Berlin"; }
  async setting(f: string) { return this.settings.get(f) ?? null; }
  async saveSetting(f: string, s: SchoolSyncSetting) { this.settings.set(f, s); }
  async deleteSetting(f: string) { this.settings.delete(f); }
  async futureSyncedCount() { return 0; }
  async apply(f: string, _rows: FetchedBreak[], _w: { from: string; to: string }, expect: { region: string; group: string | null }, at: string) {
    const c = this.settings.get(f);
    if (!c || !c.enabled || c.pending !== null || c.region !== expect.region || c.group !== expect.group) return { superseded: true };
    this.applied.push(f);
    this.settings.set(f, { ...c, last_success_at: at, last_error_at: null, last_error: null });
    return { superseded: false };
  }
  async recordError(f: string, at: string, message: string) {
    const c = this.settings.get(f);
    if (c) this.settings.set(f, { ...c, last_error_at: at, last_error: message });
  }
  async clear() {}
  async enabledFamilies() {
    return [...this.settings].filter(([, s]) => s.enabled).map(([familyId, setting]) => ({ familyId, setting }));
  }
  async unsetFamilies() {
    return [...this.regions]
      .filter(([f, r]) => r.chosen && r.code && !this.settings.has(f))
      .map(([familyId, r]) => ({ familyId, holidayRegion: r.code as string }));
  }
  async saveSettingIfAbsent(f: string, s: SchoolSyncSetting) {
    this.inserts.push(f);
    if (this.raceOn === f) this.settings.set(f, { ...ON("DE-BY"), enabled: false });
    if (this.settings.has(f)) return false;
    this.settings.set(f, s);
    return true;
  }
}

function cronDeps(store: CronStore, installEnabled = true) {
  const calls: string[] = [];
  const fetch: SyncFetch = async (url) => {
    calls.push(url);
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  const deps: SchoolSyncDeps = {
    fetch, store, now: () => NOW, installEnabled, userAgent: "Kinboard/test (+https://github.com/svenger87/kinboard)", log: () => {},
  };
  return { deps, calls };
}

test("a chosen, covered family with no sync setting gets the default saved and is synced", async () => {
  const store = new CronStore();
  store.regions.set("ni", { code: "DE-NI", chosen: true });
  const { deps, calls } = cronDeps(store);
  expect(await runSchoolSyncCron(deps)).toEqual({ due: 1, synced: 1, failed: 0, skipped: 0, adopted: 1 });
  expect(store.settings.get("ni")).toMatchObject({ enabled: true, region: "DE-NI", group: null, pending: null, last_success_at: NOW.toISOString() });
  expect(store.applied).toEqual(["ni"]);
  expect(calls).toHaveLength(1);
  expect(new URL(calls[0]).searchParams.get("subdivisionCode")).toBe("DE-NI");
});

test("a default that names a group is saved with it (Mecklenburg-Vorpommern)", async () => {
  const store = new CronStore();
  store.regions.set("mv", { code: "DE-MV", chosen: true });
  const { deps } = cronDeps(store);
  await runSchoolSyncCron(deps);
  expect(store.settings.get("mv")).toMatchObject({ region: "DE-MV", group: "DE-MV-ABS", pending: null });
});

test("unchosen, uncovered and still-to-pick regions are left alone", async () => {
  const store = new CronStore();
  store.regions.set("unchosen", { code: "DE-NI", chosen: false });
  store.regions.set("gb", { code: "GB-ENG", chosen: true });
  store.regions.set("us", { code: "US-CA", chosen: true });
  store.regions.set("nl", { code: "NL", chosen: true }); // a province to pick first
  store.regions.set("gr", { code: "CH-GR", chosen: true }); // a Region to pick first
  const { deps, calls } = cronDeps(store);
  expect(await runSchoolSyncCron(deps)).toEqual({ due: 0, synced: 0, failed: 0, skipped: 0, adopted: 0 });
  expect(store.inserts).toEqual([]);
  expect(store.settings.size).toBe(0);
  expect(calls).toEqual([]);
});

test("a family that switched it off is not turned back on", async () => {
  const store = new CronStore();
  store.regions.set("off", { code: "DE-NI", chosen: true });
  store.settings.set("off", { ...ON("DE-NI"), enabled: false });
  const { deps, calls } = cronDeps(store);
  await runSchoolSyncCron(deps);
  expect(store.settings.get("off")?.enabled).toBe(false);
  expect(calls).toEqual([]);
});

test("a pick saved between the listing and the insert wins", async () => {
  const store = new CronStore();
  store.regions.set("race", { code: "DE-NI", chosen: true });
  store.raceOn = "race";
  const { deps, calls } = cronDeps(store);
  expect(await runSchoolSyncCron(deps)).toMatchObject({ adopted: 0, due: 0 });
  expect(store.settings.get("race")).toMatchObject({ enabled: false, region: "DE-BY" });
  expect(calls).toEqual([]);
});

test("SCHOOL_HOLIDAY_SYNC=off: nothing is listed, saved or fetched", async () => {
  const store = new CronStore();
  store.regions.set("ni", { code: "DE-NI", chosen: true });
  store.settings.set("by", ON("DE-BY"));
  const listed: string[] = [];
  store.unsetFamilies = async () => { listed.push("unset"); return []; };
  store.enabledFamilies = async () => { listed.push("enabled"); return []; };
  const { deps, calls } = cronDeps(store, false);
  expect(await runSchoolSyncCron(deps)).toEqual({ skipped: "SCHOOL_HOLIDAY_SYNC=off" });
  expect(listed).toEqual([]);
  expect(store.inserts).toEqual([]);
  expect(calls).toEqual([]);
});

test("the hour's back-off after a failure still holds, and a week-old success is due again", async () => {
  const store = new CronStore();
  store.settings.set("failing", ON("DE-NI", { last_error_at: "2026-10-02T09:30:00.000Z", last_error: "down" }));
  store.settings.set("fresh", ON("DE-BY", { last_success_at: "2026-10-01T10:00:00.000Z" }));
  store.settings.set("stale", ON("DE-HH", { last_success_at: "2026-09-20T10:00:00.000Z" }));
  const { deps, calls } = cronDeps(store);
  expect(await runSchoolSyncCron(deps)).toEqual({ due: 1, synced: 1, failed: 0, skipped: 0, adopted: 0 });
  expect(store.applied).toEqual(["stale"]);
  expect(calls).toHaveLength(1);
});

test("one family's failure does not stop the run, and a failed listing of unset families does not stop the rest", async () => {
  const store = new CronStore();
  store.settings.set("a", ON("DE-NI"));
  store.settings.set("b", ON("DE-BY"));
  store.timeZone = async () => { throw new Error("boom"); };
  store.recordError = async (f: string) => { if (f === "a") throw new Error("also boom"); };
  store.unsetFamilies = async () => { throw new Error("rpc missing"); };
  const { deps } = cronDeps(store);
  const result = await runSchoolSyncCron(deps);
  expect(result).toEqual({ due: 2, synced: 0, failed: 2, skipped: 0, adopted: 0 });
});

test("a failure to list the switched-on families is the route's 500", async () => {
  const store = new CronStore();
  store.enabledFamilies = async () => { throw new Error("db down"); };
  const { deps } = cronDeps(store);
  await expect(runSchoolSyncCron(deps)).rejects.toThrow("db down");
});
