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
const FRESH = { last_success_at: null, last_error_at: null, last_error: null, language: null };
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
  /** The language each family would fetch in now; "de" unless a spec says otherwise. */
  langs = new Map<string, string>();
  languageCalls: string[][] = [];
  async language(f: string) { return this.langs.get(f) ?? "de"; }
  async languages(ids: string[]) {
    this.languageCalls.push(ids);
    return new Map(ids.map((id) => [id, this.langs.get(id) ?? "de"]));
  }
  async timeZone() { return "Europe/Berlin"; }
  async setting(f: string) { return this.settings.get(f) ?? null; }
  async saveSetting(f: string, s: SchoolSyncSetting) { this.settings.set(f, s); }
  async deleteSetting(f: string) { this.settings.delete(f); }
  async futureSyncedCount() { return 0; }
  async apply(f: string, _rows: FetchedBreak[], _w: { from: string; to: string }, expect: { region: string; group: string | null }, at: string, language: string) {
    const c = this.settings.get(f);
    if (!c || !c.enabled || c.pending !== null || c.region !== expect.region || c.group !== expect.group) return { superseded: true };
    this.applied.push(f);
    this.settings.set(f, { ...c, last_success_at: at, last_error_at: null, last_error: null, language });
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
  store.settings.set("fresh", ON("DE-BY", { last_success_at: "2026-10-01T10:00:00.000Z", language: "de" }));
  store.settings.set("stale", ON("DE-HH", { last_success_at: "2026-09-20T10:00:00.000Z", language: "de" }));
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

/*
 * Prod, v1.13.0-rc.4: a German family's rows were fetched in English before
 * rc.3 and kept "Autumn Holidays", because the cron only looked at the week.
 * The language a success fetched in is recorded; one that differs from the
 * family's now makes it due at the next daily run.
 */
test.describe("a language change makes a family due", () => {
  const RECENT = "2026-10-01T10:00:00.000Z";

  test("a setting with no recorded language (every install before this) is fetched once, then left alone", async () => {
    const store = new CronStore();
    store.settings.set("legacy", ON("DE-NI", { last_success_at: RECENT }));
    const { deps, calls } = cronDeps(store);
    expect(await runSchoolSyncCron(deps)).toEqual({ due: 1, synced: 1, failed: 0, skipped: 0, adopted: 0 });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get("languageIsoCode")).toBe("DE");
    expect(store.settings.get("legacy")).toMatchObject({ language: "de", last_success_at: NOW.toISOString() });
    expect(await runSchoolSyncCron(deps)).toMatchObject({ due: 0, synced: 0 });
    expect(calls).toHaveLength(1);
  });

  test("names fetched in another language are due within the week", async () => {
    const store = new CronStore();
    store.settings.set("switched", ON("DE-NI", { last_success_at: RECENT, language: "en" }));
    store.settings.set("to-english", ON("DE-BY", { last_success_at: RECENT, language: "de" }));
    store.langs.set("to-english", "en");
    const { deps, calls } = cronDeps(store);
    expect(await runSchoolSyncCron(deps)).toEqual({ due: 2, synced: 2, failed: 0, skipped: 0, adopted: 0 });
    expect(calls.map((u) => new URL(u).searchParams.get("languageIsoCode")).sort()).toEqual(["DE", "EN"]);
    expect(store.settings.get("switched")?.language).toBe("de");
    expect(store.settings.get("to-english")?.language).toBe("en");
  });

  test("the same language within the week is not due", async () => {
    const store = new CronStore();
    store.settings.set("current", ON("DE-NI", { last_success_at: RECENT, language: "de" }));
    const { deps, calls } = cronDeps(store);
    expect(await runSchoolSyncCron(deps)).toEqual({ due: 0, synced: 0, failed: 0, skipped: 0, adopted: 0 });
    expect(calls).toEqual([]);
  });

  test("the hour's back-off still holds for a language mismatch, and costs no language lookup", async () => {
    const store = new CronStore();
    store.settings.set("failing", ON("DE-NI", { last_success_at: "2026-09-30T10:00:00.000Z", language: "en", last_error_at: "2026-10-02T09:30:00.000Z", last_error: "down" }));
    store.settings.set("current", ON("DE-BY", { last_success_at: RECENT, language: "de" }));
    const { deps, calls } = cronDeps(store);
    expect(await runSchoolSyncCron(deps)).toMatchObject({ due: 0 });
    expect(calls).toEqual([]);
    expect(store.languageCalls).toEqual([["current"]]);
  });

  test("the languages are read in one batch for the whole run, not per family", async () => {
    const store = new CronStore();
    for (const f of ["a", "b", "c"]) store.settings.set(f, ON("DE-NI", { last_success_at: RECENT, language: "de" }));
    let single = 0;
    store.language = async () => { single++; return "de"; };
    const { deps } = cronDeps(store);
    await runSchoolSyncCron(deps);
    expect(store.languageCalls).toEqual([["a", "b", "c"]]);
    expect(single).toBe(0);
  });

  test("a failed language lookup falls back to the week, and the run goes on", async () => {
    const store = new CronStore();
    store.settings.set("mismatch", ON("DE-NI", { last_success_at: RECENT, language: "en" }));
    store.settings.set("stale", ON("DE-HH", { last_success_at: "2026-09-20T10:00:00.000Z", language: "de" }));
    store.languages = async () => { throw new Error("db down"); };
    const logs: string[] = [];
    const { deps } = cronDeps(store);
    deps.log = (m) => { logs.push(m); };
    expect(await runSchoolSyncCron(deps)).toEqual({ due: 1, synced: 1, failed: 0, skipped: 0, adopted: 0 });
    expect(store.applied).toEqual(["stale"]);
    expect(logs.join("\n")).toContain("could not read the families' languages (db down)");
  });
});
