import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAdminClient } from "../src/lib/supabase/server";
import { liveSchoolSyncStore } from "../src/lib/school-sync/store";
import { runSchoolSyncCron } from "../src/lib/school-sync/cron";
import { syncFamily, type SchoolSyncDeps, type SchoolSyncSetting, type SchoolSyncStore } from "../src/lib/school-sync/sync";
import type { SyncFetch } from "../src/lib/school-sync/openholidays";

/**
 * RFC-014 §5.2 and §9 end to end: syncFamily on the real store, against a
 * real database, with the recorded fixture behind a fake fetch -- nothing
 * here reaches OpenHolidays. school-sync.spec.ts covers the same logic with
 * a fake store; this proves what lands in school_holidays: a manual row with
 * the same name and dates as a fetched one survives every sync path, and
 * every failure leaves the family's rows byte-identical.
 *
 * Needs a stack: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL), e.g. Kong on :8130 here. Skipped without them,
 * unless FAMILY_CODE says a stack is there. The family it makes is deleted
 * again; settings and school_holidays cascade.
 */

const HAS_STACK = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
test.skip(!HAS_STACK && !process.env.FAMILY_CODE, "needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL for a running stack");
test.describe.configure({ mode: "serial" });

const NOW = new Date("2026-10-02T10:00:00Z");
const ON: SchoolSyncSetting = {
  enabled: true, region: "DE-NI", group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null,
};
const NI = readFileSync(join(process.cwd(), "e2e/fixtures/openholidays/school-de-ni.json"), "utf8");
const jsonResponse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

let db: any;
let store: SchoolSyncStore;
let family = "";

/** Every row of the family, as text, in a fixed order: "byte-identical" means this string. */
async function table(): Promise<string> {
  const { data, error } = await db
    .from("school_holidays")
    .select("id, source, external_id, name, starts_on, ends_on, hidden, synced_at, updated_at")
    .eq("family_id", family)
    .order("source")
    .order("starts_on")
    .order("name");
  if (error) throw error;
  return JSON.stringify(data);
}
async function rows(source: "manual" | "openholidays") {
  const { data, error } = await db
    .from("school_holidays")
    .select("id, name, starts_on, ends_on, updated_at")
    .eq("family_id", family)
    .eq("source", source)
    .order("starts_on");
  if (error) throw error;
  return data as { id: string; name: string; starts_on: string; ends_on: string; updated_at: string }[];
}

function run(answer: () => Response | Promise<Response>) {
  let calls = 0;
  const fetch: SyncFetch = async () => { calls++; return answer(); };
  const deps: SchoolSyncDeps = {
    fetch, store, now: () => NOW, installEnabled: true,
    userAgent: "Kinboard/test (+https://github.com/svenger87/kinboard)", log: () => {},
  };
  return { outcome: syncFamily(family, deps), calls: () => calls };
}

test.beforeAll(async () => {
  db = createAdminClient();
  store = liveSchoolSyncStore(db);
  const code = `SL${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const { data, error } = await db.from("families").insert({ name: "claude-school-sync-live", join_code: code }).select("id").single();
  if (error) throw error;
  family = data.id;
  const settings = await db.from("settings").insert([
    { family_id: family, key: "holiday_region", value: { code: "DE-NI", chosen: true } },
    { family_id: family, key: "school_holiday_sync", value: ON },
  ]);
  if (settings.error) throw settings.error;
  // The same name and dates as the fixture's Herbstferien, and one of the family's own.
  const manual = await db.from("school_holidays").insert([
    { family_id: family, name: "Herbstferien", starts_on: "2026-10-12", ends_on: "2026-10-24" },
    { family_id: family, name: "Brückentag", starts_on: "2026-11-02", ends_on: "2026-11-02" },
  ]);
  if (manual.error) throw manual.error;
});

const others: string[] = [];
test.afterAll(async () => {
  const ids = [family, ...others].filter(Boolean);
  if (ids.length) await db.from("families").delete().in("id", ids);
});

let manualBefore = "";

test("a sync writes the fixture's breaks next to the family's own, and leaves those as they were", async () => {
  manualBefore = JSON.stringify(await rows("manual"));
  const { outcome, calls } = run(() => jsonResponse(NI));
  expect(await outcome).toEqual({ status: "synced", rows: 8 });
  expect(calls()).toBe(1);
  const synced = await rows("openholidays");
  expect(synced).toHaveLength(8);
  expect(synced.filter((r) => r.name === "Herbstferien" && r.starts_on === "2026-10-12")).toHaveLength(1);
  expect(JSON.stringify(await rows("manual"))).toBe(manualBefore);
  expect(await store.futureSyncedCount(family, "2026-10-02")).toBe(7);
  expect((await store.setting(family))?.last_success_at).toBe(NOW.toISOString());
  expect((await store.enabledFamilies()).map((f) => f.familyId)).toContain(family);
});

for (const [label, answer] of [
  ["DNS or a refused connection", () => { throw new TypeError("fetch failed"); }],
  ["a timeout", () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }],
  ["a 5xx", () => new Response("", { status: 502 })],
  ["a 4xx", () => new Response("", { status: 404 })],
  ["HTML instead of JSON", () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } })],
  ["invalid JSON", () => jsonResponse("{")],
  ["a schema mismatch", () => jsonResponse(JSON.stringify({ rows: [] }))],
  ["an empty answer", () => jsonResponse("[]")],
  ["an answer over 1 MB", () => jsonResponse(`[${" ".repeat(1_000_001)}]`)],
] as const) {
  test(`${label} leaves every row byte-identical`, async () => {
    const before = await table();
    const { outcome } = run(answer as () => Response);
    expect((await outcome).status).toBe("failed");
    expect(await table()).toBe(before);
    expect(await store.setting(family)).toMatchObject({ last_success_at: NOW.toISOString(), last_error_at: NOW.toISOString() });
  });
}

for (const [label, change] of [
  ["switched off", { enabled: false }],
  ["moved to another region", { region: "DE-HB" }],
  ["given a group to pick", { pending: "group" }],
] as const) {
  test(`a family ${label} after the early look but before the write gets nothing written`, async () => {
    const before = await table();
    const setting = (await store.setting(family))!;
    const real = store.apply.bind(store);
    // The route's change commits in the gap between syncFamily's own re-read
    // and the function call; only the function's check under the lock can
    // see it.
    store.apply = async (...args) => {
      await store.saveSetting(family, { ...setting, ...change });
      return real(...args);
    };
    try {
      const { outcome } = run(() => jsonResponse(NI));
      expect(await outcome).toEqual({ status: "skipped", reason: "superseded" });
    } finally {
      store.apply = real;
    }
    expect(await table()).toBe(before);
    expect(await store.setting(family)).toEqual({ ...setting, ...change });
    await store.saveSetting(family, setting);
  });
}

test("a success after failures clears the error, and only the status moves", async () => {
  const before = (await store.setting(family))!;
  expect(before.last_error).toBeTruthy();
  const { outcome } = run(() => jsonResponse(NI));
  expect(await outcome).toEqual({ status: "synced", rows: 8 });
  expect(await store.setting(family)).toEqual({ ...before, last_success_at: NOW.toISOString(), last_error_at: null, last_error: null });
});

test("a break gone from the answer goes; the family's row with the same name and dates stays", async () => {
  const withoutHerbst = (JSON.parse(NI) as { name: { text: string }[] }[]).filter((r) => r.name[0].text !== "Herbstferien");
  const { outcome } = run(() => jsonResponse(JSON.stringify(withoutHerbst)));
  expect(await outcome).toEqual({ status: "synced", rows: 7 });
  expect((await rows("openholidays")).map((r) => r.name)).not.toContain("Herbstferien");
  expect(JSON.stringify(await rows("manual"))).toBe(manualBefore);
});

test("clearing removes every synced row and only those", async () => {
  await store.clear(family);
  expect(await rows("openholidays")).toEqual([]);
  expect(JSON.stringify(await rows("manual"))).toBe(manualBefore);
  expect(await store.futureSyncedCount(family, "2026-10-02")).toBe(0);
});

test("with nothing synced, an empty answer is just empty", async () => {
  const { outcome } = run(() => jsonResponse("[]"));
  expect(await outcome).toEqual({ status: "synced", rows: 0 });
  expect(JSON.stringify(await rows("manual"))).toBe(manualBefore);
});

test("a failure is recorded only on the choice it was for (final review #4)", async () => {
  const before = (await store.setting(family))!;
  await store.recordError(family, "2026-10-02T11:00:00.000Z", "down", { region: "DE-HB", group: null });
  expect(await store.setting(family)).toEqual(before);
  await store.recordError(family, "2026-10-02T11:00:00.000Z", "down", { region: "DE-NI", group: null });
  expect(await store.setting(family)).toMatchObject({ last_error_at: "2026-10-02T11:00:00.000Z", last_error: "down" });
});

test("the cron saves the default for a chosen family that has no sync setting, and syncs it (final review #2)", async () => {
  const make = async (region: unknown) => {
    const code = `SL${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const { data, error } = await db.from("families").insert({ name: "claude-school-sync-live", join_code: code }).select("id").single();
    if (error) throw error;
    others.push(data.id);
    const r = await db.from("settings").insert({ family_id: data.id, key: "holiday_region", value: region });
    if (r.error) throw r.error;
    return data.id as string;
  };
  const chosen = await make({ code: "DE-NI", chosen: true });
  const unchosen = await make({ code: "DE-NI", chosen: false });
  const ours = new Set([chosen, unchosen]);
  // The real store and its RPC, limited to this spec's families so no other
  // family on the stack is touched.
  const real = liveSchoolSyncStore(db);
  const unset = await real.unsetFamilies();
  expect(unset).toContainEqual({ familyId: chosen, holidayRegion: "DE-NI" });
  expect(unset.map((f) => f.familyId)).not.toContain(unchosen);
  const scoped: SchoolSyncStore = {
    ...real,
    enabledFamilies: async () => (await real.enabledFamilies()).filter((f) => ours.has(f.familyId)),
    unsetFamilies: async () => unset.filter((f) => ours.has(f.familyId)),
  };
  let calls = 0;
  const deps: SchoolSyncDeps = {
    fetch: async () => { calls++; return jsonResponse(NI); }, store: scoped, now: () => NOW, installEnabled: true,
    userAgent: "Kinboard/test (+https://github.com/svenger87/kinboard)", log: () => {},
  };
  expect(await runSchoolSyncCron(deps)).toEqual({ due: 1, synced: 1, failed: 0, skipped: 0, adopted: 1 });
  expect(calls).toBe(1);
  expect(await real.setting(chosen)).toMatchObject({ enabled: true, region: "DE-NI", last_success_at: NOW.toISOString() });
  expect(await real.setting(unchosen)).toBeNull();
  const { count } = await db.from("school_holidays").select("id", { head: true, count: "exact" }).eq("family_id", chosen).eq("source", "openholidays");
  expect(count).toBe(8);
  // A second insert of the default does not overwrite what is there now.
  expect(await real.saveSettingIfAbsent(chosen, { ...ON, enabled: false })).toBe(false);
  expect((await real.setting(chosen))?.enabled).toBe(true);
  // And the next run finds nothing to adopt and nothing due.
  expect(await runSchoolSyncCron(deps)).toEqual({ due: 0, synced: 0, failed: 0, skipped: 0, adopted: 0 });
});
