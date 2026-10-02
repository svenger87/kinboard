import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "../src/lib/supabase/server";
import { VISIBLE_CALENDARS, reconcileGoogleCalendars } from "../src/lib/google-calendar-reconcile";
import { fetchSchoolBreaks } from "../src/lib/school-days";

/**
 * google-calendar-reconcile.spec.ts against a real PostgREST: the reconcile
 * writes, and -- the part a fake cannot prove -- that the `or` filter every
 * read path now carries is valid PostgREST, and drops the parent row when it
 * is applied to an `!inner` embedding.
 *
 * Needs a stack: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL), e.g. Kong on :8130 here. It makes two throwaway
 * families named `claude-google-reconcile-*`, with Google-style calendar rows
 * (nothing talks to Google), and deletes them afterwards -- calendars and
 * events go with them by cascade -- including any left by an interrupted run.
 */

const HAS_STACK = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
test.skip(!HAS_STACK, "needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL for a running stack");
test.describe.configure({ mode: "serial" });

const PREFIX = "claude-google-reconcile";
const FEIERTAGE = "de.german#holiday@group.v.calendar.google.com";
const FAMILIE = "claude-familie@group.calendar.google.com";

let db: any;
let ours = "";
let theirs = "";
const cal: Record<string, string> = {};

async function removeFamilies() {
  const { error } = await db.from("families").delete().like("name", `${PREFIX}%`);
  if (error) throw error;
}

async function family(name: string): Promise<string> {
  const { data, error } = await db
    .from("families")
    .insert({ name: `${PREFIX}-${name}`, join_code: `CL${randomBytes(4).toString("hex").toUpperCase()}` })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function calendar(key: string, row: Record<string, unknown>) {
  const { data, error } = await db.from("calendars").insert({ color: "#0b8043", ...row }).select("id").single();
  if (error) throw error;
  cal[key] = data.id;
}

/** `local-only:<calendar>` puts an event with no google_event_id into a Google calendar. */
async function event(key: string, title: string, day: string) {
  const localOnly = key.startsWith("local-only:");
  const calendarKey = localOnly ? key.slice("local-only:".length) : key;
  const { error } = await db.from("events").insert({
    calendar_id: cal[calendarKey], title, all_day: true,
    google_event_id: !localOnly && key.startsWith("g-") ? `${key}-${title}` : null,
    start_at: `${day}T12:00:00Z`, end_at: `${day}T12:00:00Z`,
  });
  if (error) throw error;
}

async function eventTitles(calendarKey: string): Promise<string[]> {
  const { data, error } = await db.from("events").select("title").eq("calendar_id", cal[calendarKey]);
  if (error) throw error;
  return (data as { title: string }[]).map((e) => e.title).sort();
}

async function row(key: string) {
  const { data, error } = await db
    .from("calendars")
    .select("sync_enabled, is_holidays, is_waste_collection, color")
    .eq("id", cal[key])
    .single();
  if (error) throw error;
  return data;
}

test.beforeAll(async () => {
  db = createAdminClient();
  await removeFamilies();
  ours = await family("ours");
  theirs = await family("theirs");
  await calendar("g-feiertage", { family_id: ours, name: "Feiertage in Deutschland", google_calendar_id: FEIERTAGE, is_holidays: true });
  await calendar("g-familie", { family_id: ours, name: "Familie", google_calendar_id: FAMILIE });
  await calendar("ics", { family_id: ours, name: "Ferien", ics_url: "https://example.test/ferien.ics", is_holidays: true });
  await calendar("local", { family_id: ours, name: "Local", sync_enabled: false });
  await calendar("g-theirs", { family_id: theirs, name: "Feiertage", google_calendar_id: FEIERTAGE, is_holidays: true });
  await event("g-feiertage", "Reformationstag", "2026-10-31");
  await event("g-feiertage", "Tag der Deutschen Einheit", "2026-10-03");
  await event("local-only:g-feiertage", "Made in Kinboard", "2026-10-20");
  await event("g-familie", "Oma", "2026-10-05");
  await event("ics", "Herbstferien", "2026-10-12");
  await event("local", "Elternabend", "2026-10-07");
  await event("g-theirs", "Reformationstag", "2026-10-31");
});

test.afterAll(async () => {
  if (db) await removeFamilies();
});

test("unticking deletes the events, switches the row off and keeps its flags", async () => {
  const result = await reconcileGoogleCalendars(db, ours, [FAMILIE]);
  expect(result).toEqual({ disabled: 1, enabled: 0, deletedEvents: 2 });
  // Google's copies are gone; the one made in Kinboard is not.
  expect(await eventTitles("g-feiertage")).toEqual(["Made in Kinboard"]);
  expect(await row("g-feiertage")).toMatchObject({ sync_enabled: false, is_holidays: true, color: "#0b8043" });

  // Nothing else moved: the ticked Google calendar, the ICS feed, the local
  // calendar (whose sync_enabled was already false), and the other family.
  expect(await eventTitles("g-familie")).toEqual(["Oma"]);
  expect(await eventTitles("ics")).toEqual(["Herbstferien"]);
  expect(await eventTitles("local")).toEqual(["Elternabend"]);
  expect(await eventTitles("g-theirs")).toEqual(["Reformationstag"]);
  expect((await row("g-theirs")).sync_enabled).toBe(true);
  expect((await row("local")).sync_enabled).toBe(false);
});

test("the read filter is real PostgREST and drops a switched-off calendar's events", async () => {
  // A stray event in the switched-off calendar: what a sync mid-flight at the
  // moment of unticking could leave. The read paths must not show it.
  await event("g-feiertage", "Weihnachten", "2026-12-25");

  // useEvents' query shape: embedded under the alias `calendar`, `!inner`.
  const { data: events, error } = await db
    .from("events")
    .select("title, calendar:calendars!inner(family_id)")
    .eq("calendar.family_id", ours)
    .or(VISIBLE_CALENDARS, { referencedTable: "calendar" });
  expect(error).toBeNull();
  expect((events as { title: string }[]).map((e) => e.title).sort()).toEqual(["Elternabend", "Herbstferien", "Oma"]);

  // useCalendars' and the Integration API's shape: the local calendar with
  // sync_enabled = false stays listed; only the Google one goes.
  const { data: calendars, error: calError } = await db
    .from("calendars").select("name").eq("family_id", ours).or(VISIBLE_CALENDARS);
  expect(calError).toBeNull();
  expect((calendars as { name: string }[]).map((c) => c.name).sort()).toEqual(["Familie", "Ferien", "Local"]);

  // school-days' shape, through the real function.
  const breaks = await fetchSchoolBreaks(ours, "2026-10-01", "2026-12-31", "Europe/Berlin", db);
  const names = breaks.map((b) => b.name);
  expect(names).toContain("Herbstferien");
  expect(names).not.toContain("Weihnachten");
  expect(names).not.toContain("Reformationstag");

  expect(names).not.toContain("Made in Kinboard");

  // And the next reconcile clears the stray.
  expect((await reconcileGoogleCalendars(db, ours, [FAMILIE])).deletedEvents).toBe(1);
  expect(await eventTitles("g-feiertage")).toEqual(["Made in Kinboard"]);
});

test("ticking it again switches it back on as it was", async () => {
  const result = await reconcileGoogleCalendars(db, ours, [FAMILIE, FEIERTAGE]);
  expect(result).toEqual({ disabled: 0, enabled: 1, deletedEvents: 0 });
  expect(await row("g-feiertage")).toMatchObject({ sync_enabled: true, is_holidays: true, color: "#0b8043" });

  // The Kinboard-only event is visible again with its calendar.
  const { data: events, error } = await db
    .from("events")
    .select("title, calendar:calendars!inner(family_id)")
    .eq("calendar.family_id", ours)
    .or(VISIBLE_CALENDARS, { referencedTable: "calendar" });
  expect(error).toBeNull();
  expect((events as { title: string }[]).map((e) => e.title)).toContain("Made in Kinboard");
});

test("nothing ticked switches off every Google calendar and nothing else", async () => {
  const result = await reconcileGoogleCalendars(db, ours, []);
  expect(result).toMatchObject({ disabled: 2, enabled: 0 });
  expect(await eventTitles("g-familie")).toEqual([]);
  expect(await eventTitles("ics")).toEqual(["Herbstferien"]);
  expect(await eventTitles("g-theirs")).toEqual(["Reformationstag"]);
  expect((await row("g-theirs")).sync_enabled).toBe(true);
});
