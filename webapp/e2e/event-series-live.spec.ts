import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../src/lib/supabase/server";
import { mintFamilyToken } from "../src/lib/family-jwt";
import { dayKey, wallParts } from "../src/lib/event-repeat";
import { zonedWallTimeToUtc } from "../src/lib/integration-event-input";
import { parseSeriesCreate, parseSeriesUpdate } from "../src/lib/event-series-input";
import {
  SERIES_COLUMNS,
  createSeries,
  deleteSeries,
  extendAllSeries,
  updateSeries,
  type OccurrenceRef,
  type SeriesRow,
} from "../src/lib/event-series";

/**
 * Repeating events against PostgreSQL through PostgREST: what only a real
 * database can show. The series key (an event points only at a series of its
 * own calendar, whoever writes it), one row per day of a series, the triggers
 * that keep a browser's own changes and deletes, the two write functions
 * (docker/migrations/082_event_series.sql), the nightly top-up, and
 * the domain events. The writes go through lib/event-series.ts as the routes
 * call it; a browser is the anon key with a family token, as on a screen.
 *
 * Needs a stack: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL), NEXT_PUBLIC_SUPABASE_ANON_KEY and JWT_SECRET.
 * Skipped without them, unless FAMILY_CODE says a stack is there. It works
 * only in two families of its own, which it creates and deletes again,
 * including whatever an interrupted run left behind.
 */

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HAS_STACK = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!URL && !!ANON && !!(process.env.JWT_SECRET || process.env.PGRST_JWT_SECRET);
test.skip(!HAS_STACK && !process.env.FAMILY_CODE, "needs SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and JWT_SECRET");
test.describe.configure({ mode: "serial" });

const FAMILY = "5e7e5000-0015-4000-8000-00000000f001";
const OTHER = "5e7e5000-0015-4000-8000-00000000f002";
const CAL = "5e7e5000-0015-4000-8000-0000000000c1";
const OTHER_CAL = "5e7e5000-0015-4000-8000-0000000000c2";
const SYNCED_CAL = "5e7e5000-0015-4000-8000-0000000000c3";
const PERSON = "5e7e5000-0015-4000-8000-0000000000a1";
const ZONE = "Europe/Berlin";
const DAY = 86_400_000;

let db: any;
const browser = (familyId: string) =>
  createClient(URL!, ANON!, {
    global: { headers: { Authorization: `Bearer ${mintFamilyToken(familyId).token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;

const today = () => wallParts(new Date(), ZONE).day;
/** `day` (a wall day in ZONE) at hh:00 there. */
const at = (day: number, hour: number) => zonedWallTimeToUtc(day, hour * 3_600_000, ZONE);

async function purge() {
  await db.from("families").delete().in("id", [FAMILY, OTHER]);
  // The cascade stops at the soft-delete trigger on people: delete twice to purge.
  for (let i = 0; i < 2; i++) await db.from("people").delete().eq("id", PERSON);
}

/** A series made the way POST /api/calendar/series makes one. */
async function series(
  over: Record<string, unknown> & { first?: number; hour?: number } = {},
  familyId = FAMILY,
  calendarId = CAL,
): Promise<SeriesRow> {
  const first = over.first ?? today();
  const hour = over.hour ?? 15;
  const { first: _f, hour: _h, ...rest } = over;
  const input = parseSeriesCreate({
    calendar_id: calendarId,
    title: "Swimming",
    start_at: at(first, hour).toISOString(),
    end_at: at(first, hour + 1).toISOString(),
    all_day: false,
    rule: "FREQ=WEEKLY",
    time_zone: ZONE,
    ...rest,
  });
  if (!input.ok) throw new Error(input.error);
  const { id } = await createSeries(db, { ...input.value, familyId, now: new Date() });
  return load(id);
}

async function load(id: string): Promise<SeriesRow> {
  const { data, error } = await db.from("event_series").select(SERIES_COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data;
}

async function rows(seriesId: string) {
  const { data, error } = await db
    .from("events")
    .select("id, calendar_id, title, description, location, person_id, start_at, end_at, all_day, series_day, series_exception, recurrence_rule")
    .eq("series_id", seriesId)
    .order("series_day");
  if (error) throw error;
  return data as Array<OccurrenceRef & { series_day: string; title: string; description: string | null; person_id: string | null; series_exception: boolean; recurrence_rule: string | null; calendar_id: string }>;
}

/** An "All events" change, the way PATCH /api/calendar/series/[id] makes it. */
async function changeAll(s: SeriesRow, occurrence: OccurrenceRef, body: Record<string, unknown>) {
  const input = parseSeriesUpdate(
    {
      occurrence_id: occurrence.id,
      title: "Swimming",
      start_at: occurrence.start_at,
      end_at: occurrence.end_at,
      all_day: occurrence.all_day,
      ...body,
    },
    s.time_zone,
  );
  if (!input.ok) throw new Error(input.error);
  return updateSeries(db, await load(s.id), occurrence, input.value, new Date());
}

const hourIn = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", hour12: false }).format(new Date(iso));

test.beforeAll(async () => {
  db = createAdminClient();
  await purge();
  for (const [table, row] of [
    ["families", { id: FAMILY, name: "kb-series-live", join_code: "KBSERLV1" }],
    ["families", { id: OTHER, name: "kb-series-live-other", join_code: "KBSERLV2" }],
    ["calendars", { id: CAL, family_id: FAMILY, name: "kb-series-live" }],
    ["calendars", { id: OTHER_CAL, family_id: OTHER, name: "kb-series-live-other" }],
    ["calendars", { id: SYNCED_CAL, family_id: FAMILY, name: "kb-series-live-synced", google_calendar_id: "kb-series-live@group.calendar.example" }],
    ["people", { id: PERSON, family_id: FAMILY, name: "kb-series-person" }],
  ] as const) {
    const { error } = await db.from(table).insert(row);
    if (error) throw error;
  }
});

test.afterAll(async () => {
  await purge();
});

test("an event can point only at a series of its own calendar, whoever writes it", async () => {
  const theirs = await series({ title: "Their swimming" }, OTHER, OTHER_CAL);
  const mine = await series();
  // A day neither weekly series has, so only the series key can refuse it.
  const day = dayKey(today() + 1);
  const planted = (calendarId: string, seriesId: string) => ({
    calendar_id: calendarId, title: "planted", start_at: at(today(), 9).toISOString(), end_at: at(today(), 10).toISOString(),
    series_id: seriesId, series_day: day,
  });
  // A browser, in its own calendar, at another family's series: the key refuses it (RLS is not asked).
  const fromBrowser = await browser(FAMILY).from("events").insert(planted(CAL, theirs.id));
  expect(fromBrowser.error?.code).toBe("23503");
  // A synced event at the family's own local series.
  const synced = await browser(FAMILY).from("events").insert(planted(SYNCED_CAL, mine.id));
  expect(synced.error?.code).toBe("23503");
  // Not even the service role can.
  expect((await db.from("events").insert(planted(CAL, theirs.id))).error?.code).toBe("23503");
  // Nothing of theirs reaches us when they change every occurrence.
  const first = (await rows(theirs.id))[0];
  expect((await changeAll(theirs, first, { title: "Their new title", location: "Their pool" })).status).toBe("ok");
  const ours = await browser(FAMILY).from("events").select("id").or("title.eq.Their new title,location.eq.Their pool");
  expect(ours.error).toBeNull();
  expect(ours.data).toEqual([]);
  // A browser can't move an occurrence into another series either: its series stays.
  const occ = (await rows(mine.id))[1];
  await browser(FAMILY).from("events").update({ series_id: theirs.id }).eq("id", occ.id);
  expect((await db.from("events").select("series_id").eq("id", occ.id).single()).data.series_id).toBe(mine.id);
});

test("one row per day of a series: writing a day twice, even at once, leaves one", async () => {
  const s = await series({ rule: "FREQ=DAILY" });
  const before = (await rows(s.id)).length;
  const first = (await rows(s.id))[0];
  const again = await db.from("events").insert({
    calendar_id: CAL, title: "again", start_at: first.start_at, end_at: first.end_at, series_id: s.id, series_day: first.series_day,
  });
  expect(again.error?.code).toBe("23505");
  // The nightly job twice at once, over days already made and new ones.
  await db.from("event_series").update({ generated_through: dayKey(today() + 60), extend_on: dayKey(today()) }).eq("id", s.id);
  const [a, b] = await Promise.all([extendAllSeries(db, new Date()), extendAllSeries(db, new Date())]);
  expect(a.failed + b.failed).toBe(0);
  const after = await rows(s.id);
  expect(new Set(after.map((r) => r.series_day)).size).toBe(after.length);
  expect(after.length).toBe(before);
  // A write made on a series someone else wrote since is refused, not applied.
  const stale = await db.rpc("event_series_write", {
    p_series_id: s.id, p_calendar_id: CAL, p_revision: 0, p_template: { title: "stale" }, p_fields: {},
    p_cut_day: null, p_shift: 0, p_until_day: null, p_rows: [],
  });
  expect(stale.data).toEqual({ status: "stale" });
  expect((await load(s.id)).title).toBe("Swimming");
});

test("a change of time for every event keeps the past, the ones changed alone and the days deleted alone", async () => {
  // Weekly, from three weeks ago at 15:00.
  const s = await series({ first: today() - 21 });
  const all = await rows(s.id);
  const past = all.filter((r) => r.series_day < dayKey(today()));
  expect(past).toHaveLength(3);
  const upcoming = all.filter((r) => r.series_day >= dayKey(today()));
  const [nextWeek, inTwo, inThree] = upcoming.slice(1, 4);

  // On a screen: one occurrence changed alone, another deleted alone.
  const changed = await browser(FAMILY).from("events").update({ title: "Swimming with friends", start_at: at(today() + 14, 18).toISOString(), end_at: at(today() + 14, 19).toISOString() }).eq("id", inTwo.id);
  expect(changed.error).toBeNull();
  expect((await browser(FAMILY).from("events").delete().eq("id", inThree.id)).error).toBeNull();
  expect((await load(s.id)).skipped_days).toEqual([inThree.series_day]);

  // Every event from next week on at 16:00.
  const moved = await changeAll(s, nextWeek, { start_at: at(today() + 7, 16).toISOString(), end_at: at(today() + 7, 17).toISOString() });
  expect(moved.status).toBe("ok");
  const after = await rows(s.id);
  // The past as it was.
  for (const r of past) expect(after.find((a) => a.id === r.id)?.start_at).toBe(r.start_at);
  // From today on at 16:00, except the one changed alone, and the deleted day not back.
  const fromToday = after.filter((r) => r.series_day >= dayKey(today()));
  const alone = fromToday.find((r) => r.id === inTwo.id)!;
  expect(alone).toMatchObject({ title: "Swimming with friends", series_exception: true });
  expect(hourIn(alone.start_at)).toBe("18");
  for (const r of fromToday.filter((r) => r.id !== inTwo.id)) expect(hourIn(r.start_at)).toBe("16");
  expect(after.some((r) => r.series_day === inThree.series_day)).toBe(false);
  expect(fromToday.length).toBeGreaterThan(40);

  // A new title for every event: not the one whose title was changed alone.
  expect((await changeAll(s, nextWeek, { title: "Swim club", start_at: at(today() + 7, 16).toISOString(), end_at: at(today() + 7, 17).toISOString() })).status).toBe("ok");
  const titles = await rows(s.id);
  expect(titles.find((r) => r.id === inTwo.id)?.title).toBe("Swimming with friends");
  expect(titles.filter((r) => r.id !== inTwo.id).every((r) => r.title === "Swim club")).toBe(true);

  // Put back (the calendar's undo, which inserts the row it deleted): the day is no longer skipped.
  const { calendar_id, ...snapshot } = inThree as typeof inThree & { calendar_id: string };
  expect((await browser(FAMILY).from("events").insert({ ...snapshot, calendar_id, series_id: s.id })).error).toBeNull();
  expect((await load(s.id)).skipped_days).toEqual([]);
});

test("moving every event a day later moves the ones changed alone and the skipped days with them", async () => {
  const s = await series({ first: today() + 1 });
  const [, second, third] = await rows(s.id);
  await browser(FAMILY).from("events").update({ location: "Lake" }).eq("id", second.id);
  await browser(FAMILY).from("events").delete().eq("id", third.id);
  const first = (await rows(s.id))[0];
  const shifted = await changeAll(s, first, {
    start_at: new Date(new Date(first.start_at).getTime() + DAY).toISOString(),
    end_at: new Date(new Date(first.end_at).getTime() + DAY).toISOString(),
  });
  expect(shifted.status).toBe("ok");
  const after = await rows(s.id);
  const plusOne = (key: string) => dayKey(Number(new Date(`${key}T00:00:00Z`)) / DAY + 1);
  expect(after.find((r) => r.id === second.id)?.series_day).toBe(plusOne(second.series_day!));
  expect((await load(s.id)).skipped_days).toEqual([plusOne(third.series_day!)]);
  expect(after.some((r) => r.series_day === plusOne(third.series_day!))).toBe(false);
});

test("Never ends the series at that event: it and the earlier ones stay, the later ones go", async () => {
  const s = await series({ first: today() - 14 });
  const nextWeek = (await rows(s.id)).find((r) => r.series_day === dayKey(today() + 7))!;
  const stopped = await changeAll(s, nextWeek, { rule: null, title: "Last swim" });
  expect(stopped).toMatchObject({ status: "ok", series: "ended" });
  const after = await rows(s.id);
  expect(after.map((r) => r.series_day)).toEqual([today() - 14, today() - 7, today(), today() + 7].map(dayKey));
  expect(after[3].title).toBe("Last swim");
  const ended = await load(s.id);
  expect(ended.rule).toBe(`FREQ=WEEKLY;UNTIL=${dayKey(today() + 7).replaceAll("-", "")}`);
  expect(ended.extend_on).toBeNull();
  expect(after.every((r) => r.recurrence_rule === ended.rule)).toBe(true);
  // On the first and only one left: a plain event.
  const single = await series({ first: today() + 3 });
  const only = (await rows(single.id))[0];
  expect((await changeAll(single, only, { rule: null })).series).toBe("single");
  expect((await db.from("events").select("series_id, series_day, recurrence_rule").eq("id", only.id).single()).data).toEqual({ series_id: null, series_day: null, recurrence_rule: null });
  expect((await db.from("event_series").select("id").eq("id", single.id)).data).toEqual([]);
});

test("this and following: the rest goes and the repeat ends the day before; from the first, all of it", async () => {
  const s = await series();
  const list = await rows(s.id);
  expect((await deleteSeries(db, await load(s.id), list[2])).deleted).toBe("following");
  expect((await rows(s.id)).map((r) => r.id)).toEqual([list[0].id, list[1].id]);
  expect((await load(s.id)).rule).toBe(`FREQ=WEEKLY;UNTIL=${dayKey(today() + 13).replaceAll("-", "")}`);
  expect((await deleteSeries(db, await load(s.id), list[0])).deleted).toBe("series");
  expect((await db.from("event_series").select("id").eq("id", s.id)).data).toEqual([]);
});

test("a daily series that began long ago still reaches ahead of today after a change", async () => {
  const s = await series({ first: today() - 700, rule: "FREQ=DAILY" });
  const todays = (await rows(s.id)).find((r) => r.series_day === dayKey(today()))!;
  expect(todays).toBeTruthy();
  expect((await changeAll(s, todays, { start_at: at(today(), 7).toISOString(), end_at: at(today(), 8).toISOString() })).status).toBe("ok");
  const after = await rows(s.id);
  const ahead = after.filter((r) => r.series_day >= dayKey(today()));
  expect(ahead[0].series_day).toBe(dayKey(today()));
  expect(ahead.length).toBeGreaterThanOrEqual(120);
  expect(ahead.every((r) => hourIn(r.start_at) === "07")).toBe(true);
});

test("a change for every event that doesn't send a description keeps it", async () => {
  const s = await series({ description: "Bring goggles" });
  const first = (await rows(s.id))[0];
  expect((await changeAll(s, first, { title: "Swim" })).status).toBe("ok");
  expect((await load(s.id)).description).toBe("Bring goggles");
  expect((await rows(s.id)).every((r) => r.description === "Bring goggles")).toBe(true);
});

test("the nightly job: only series due, one failing doesn't stop the rest, and nothing is written twice", async () => {
  const good = await series({ rule: "FREQ=DAILY" });
  const broken = await series({ rule: "FREQ=DAILY" });
  // Both due again; one with a zone no clock knows, which throws when it is read.
  await db.from("event_series").update({ extend_on: dayKey(today() - 1), generated_through: dayKey(today() + 30) }).in("id", [good.id, broken.id]);
  await db.from("event_series").update({ time_zone: "Nowhere/Nothing" }).eq("id", broken.id);
  await db.from("events").delete().eq("series_id", good.id).gt("series_day", dayKey(today() + 30));
  const result = await extendAllSeries(db, new Date());
  expect(result.failed).toBeGreaterThanOrEqual(1);
  expect(result.series).toBeGreaterThanOrEqual(1);
  const after = await load(good.id);
  expect(after.generated_through >= dayKey(today() + 119)).toBe(true);
  expect(after.extend_on! > dayKey(today())).toBe(true);
  // Not due: not read, not written.
  const revision = after.revision;
  await extendAllSeries(db, new Date());
  expect((await load(good.id)).revision).toBe(revision);
  await db.from("event_series").delete().eq("id", broken.id);
});

test("a new series is one event created for integrations, and the top-up is none", async () => {
  const count = async () =>
    (await db.from("domain_events").select("id", { count: "exact", head: true }).eq("family_id", FAMILY).eq("event_type", "kinboard_family_event_created")).count;
  const before = await count();
  const s = await series({ rule: "FREQ=DAILY", title: "Reading" });
  expect(await count()).toBe(before + 1);
  await db.from("event_series").update({ extend_on: dayKey(today() - 1) }).eq("id", s.id);
  await extendAllSeries(db, new Date());
  expect(await count()).toBe(before + 1);
  // One added on a screen is a person's event, as before.
  await browser(FAMILY).from("events").insert({ calendar_id: CAL, title: "Dentist", start_at: at(today(), 9).toISOString(), end_at: at(today(), 10).toISOString() });
  expect(await count()).toBe(before + 2);
});

test("deleting a person, a calendar's events or a family is not a change made on a screen", async () => {
  const s = await series({ person_id: PERSON });
  for (let i = 0; i < 2; i++) await db.from("people").delete().eq("id", PERSON);
  const after = await rows(s.id);
  expect(after.every((r) => r.person_id === null && r.series_exception === false)).toBe(true);
  expect((await load(s.id)).skipped_days).toEqual([]);
  // The family goes, with its calendars, series and occurrences.
  expect((await db.from("families").delete().eq("id", OTHER)).error).toBeNull();
  expect((await db.from("event_series").select("id").eq("family_id", OTHER)).data).toEqual([]);
});
