import { expect, test } from "@playwright/test";

const describe = test.describe;
import { readFileSync } from "fs";
import { join } from "path";
import { parseSeriesCreate, parseSeriesUpdate } from "../src/lib/event-series-input";
import { HORIZON_DAYS, MAX_OCCURRENCES, dayFromKey, dayKey } from "../src/lib/event-repeat";
import {
  REFILL_DAYS,
  endedRule,
  extendOn,
  fieldChanges,
  occurrenceRows,
  planUpdate,
  shiftRule,
  type SeriesRow,
} from "../src/lib/event-series";
import { takesRepeatingEvents } from "../src/lib/local-calendars";
import { codeOnly } from "./source-helpers";

/**
 * Repeating events, server side and wiring: what a request may say, the rows
 * a series writes, what a change for every occurrence writes, which calendars
 * take one, and how the routes, the nightly job, the migration and the
 * calendar page fit together. No stack: event-series-live.spec.ts runs the
 * writes on a real database, and calendar-repeat.spec.ts drives the page.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const CAL = "11111111-2222-3333-4444-555555555555";
const OCC = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const body = (over: Record<string, unknown> = {}) => ({
  calendar_id: CAL,
  title: "Swimming",
  start_at: "2026-10-21T15:00:00.000Z",
  end_at: "2026-10-21T16:00:00.000Z",
  all_day: false,
  rule: "FREQ=WEEKLY",
  time_zone: "Europe/Berlin",
  ...over,
});

test("a new series: every field is checked before anything is written", () => {
  const ok = parseSeriesCreate(body({ location: "  ", person_id: null }));
  expect(ok.ok).toBe(true);
  if (ok.ok) {
    expect(ok.value.rule).toEqual({ freq: "weekly", interval: 1 });
    expect(ok.value.fields).toEqual({ title: "Swimming", description: null, location: null, personId: null });
  }
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ calendar_id: "nope" }, /calendar_id/],
    [{ time_zone: "Mars/Olympus" }, /time_zone/],
    [{ title: "   " }, /title/],
    [{ end_at: "2026-10-21T14:00:00.000Z" }, /before/],
    [{ end_at: "2026-12-01T16:00:00.000Z" }, /31 days/],
    [{ rule: "FREQ=HOURLY" }, /rule/],
    [{ rule: "FREQ=DAILY;UNTIL=20261001" }, /ends before it starts/],
    [{ person_id: "someone" }, /person_id/],
    [{ all_day: "yes" }, /all_day/],
  ];
  for (const [over, error] of bad) {
    const parsed = parseSeriesCreate(body(over));
    expect(parsed.ok, JSON.stringify(over)).toBe(false);
    if (!parsed.ok) expect(parsed.error, JSON.stringify(over)).toMatch(error);
  }
  expect(parseSeriesCreate(null).ok).toBe(false);
});

test("a change for every occurrence: no rule keeps the repeat, null stops it, text replaces it", () => {
  const update = (over: Record<string, unknown>) => parseSeriesUpdate({ ...body(), occurrence_id: OCC, ...over }, "Europe/Berlin");
  const { rule: _rule, ...withoutRule } = { ...body(), occurrence_id: OCC };
  const kept = parseSeriesUpdate(withoutRule, "Europe/Berlin");
  expect(kept.ok && kept.value.rule).toBeUndefined();
  const stopped = update({ rule: null });
  expect(stopped.ok && stopped.value.rule).toBeNull();
  const replaced = update({ rule: "FREQ=MONTHLY" });
  expect(replaced.ok && replaced.value.rule).toEqual({ freq: "monthly", interval: 1 });
  expect(update({ occurrence_id: "x" }).ok).toBe(false);
  // A description that isn't sent is left as it is; one sent empty clears it.
  expect(kept.ok && "description" in kept.value.fields).toBe(false);
  const cleared = update({ description: "" });
  expect(cleared.ok && cleared.value.fields.description).toBeNull();
  expect(update({ rule: "FREQ=WEEKLY;BYDAY=QQ" }).ok).toBe(false);
});

test("moving a series moves a weekly one's weekdays with it; other repeats move with their first day", () => {
  expect(shiftRule({ freq: "weekly", interval: 1, weekdays: [1, 3] }, 1)).toEqual({ freq: "weekly", interval: 1, weekdays: [2, 4] });
  expect(shiftRule({ freq: "weekly", interval: 1, weekdays: [6] }, 2)).toEqual({ freq: "weekly", interval: 1, weekdays: [1] });
  expect(shiftRule({ freq: "weekly", interval: 1, weekdays: [1] }, -1)).toEqual({ freq: "weekly", interval: 1, weekdays: [0] });
  expect(shiftRule({ freq: "weekly", interval: 1, weekdays: [1] }, 7)).toEqual({ freq: "weekly", interval: 1, weekdays: [1] });
  expect(shiftRule({ freq: "monthly", interval: 1 }, 3)).toEqual({ freq: "monthly", interval: 1 });
});

const SERIES: SeriesRow = {
  id: "series-1",
  family_id: "family-1",
  calendar_id: CAL,
  rule: "FREQ=WEEKLY;BYDAY=MO,WE",
  time_zone: "Europe/Berlin",
  first_start_at: "2026-10-19T15:00:00.000Z",
  first_end_at: "2026-10-19T16:00:00.000Z",
  all_day: false,
  title: "Swimming",
  description: "Bring goggles",
  location: "Pool",
  person_id: null,
  generated_through: "2027-11-23",
  skipped_days: [],
  extend_on: "2026-11-19",
  revision: 3,
};
const day = (key: string) => dayFromKey(key)!;

test("a series' occurrences: the day of the series each fills, and its time in the series' zone", () => {
  const { rows, through } = occurrenceRows(SERIES, day("2026-10-19"), day("2026-10-28"), day("2026-10-19"));
  expect(rows).toEqual([
    { series_day: "2026-10-19", start_at: "2026-10-19T15:00:00.000Z", end_at: "2026-10-19T16:00:00.000Z" },
    { series_day: "2026-10-21", start_at: "2026-10-21T15:00:00.000Z", end_at: "2026-10-21T16:00:00.000Z" },
    // 17:00 in Berlin, after the clocks went back
    { series_day: "2026-10-26", start_at: "2026-10-26T16:00:00.000Z", end_at: "2026-10-26T17:00:00.000Z" },
    { series_day: "2026-10-28", start_at: "2026-10-28T16:00:00.000Z", end_at: "2026-10-28T17:00:00.000Z" },
  ]);
  expect(through).toBe(day("2026-10-28"));
});

test("the cap counts the past and the days from today separately, so a long series always reaches past today", () => {
  const daily = { ...SERIES, rule: "FREQ=DAILY", first_start_at: "2020-01-01T15:00:00.000Z", first_end_at: "2020-01-01T16:00:00.000Z" };
  const today = day("2026-10-20");
  const { rows, through } = occurrenceRows(daily, day("2020-01-01"), today + 120, today);
  const ahead = rows.filter((r) => r.series_day >= "2026-10-20");
  expect(ahead[0].series_day).toBe("2026-10-20");
  expect(ahead).toHaveLength(121);
  expect(rows.length - ahead.length).toBe(MAX_OCCURRENCES);
  expect(through).toBe(today + 120);
  // A run the cap stops ahead of today reports how far it got, so the next top-up starts there.
  const capped = occurrenceRows(daily, today, today + 2000, today);
  expect(capped.rows).toHaveLength(MAX_OCCURRENCES);
  expect(capped.through).toBe(today + MAX_OCCURRENCES - 1);
});

test("the nightly job tops a series up about once a month, and never once its repeat has ended", () => {
  const weekly = { freq: "weekly" as const, interval: 1 };
  const through = day("2027-11-24");
  expect(extendOn(weekly, through)).toBe(dayKey(through - HORIZON_DAYS.weekly + REFILL_DAYS));
  expect(extendOn({ ...weekly, until: "2027-11-24" }, through)).toBeNull();
  expect(extendOn({ ...weekly, until: "2028-01-01" }, through)).toBe(dayKey(through - HORIZON_DAYS.weekly + REFILL_DAYS));
});

test("ending a repeat: its UNTIL the day given, or the earlier one it had", () => {
  expect(endedRule(SERIES, day("2026-11-03"))).toBe("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261103");
  expect(endedRule({ rule: "FREQ=DAILY;UNTIL=20261030" }, day("2026-11-03"))).toBe("FREQ=DAILY;UNTIL=20261030");
});

test("a change for every occurrence sends only the fields that changed, and keeps an unsent description", () => {
  expect(fieldChanges(SERIES, { title: "Swim club", location: "Pool", personId: null })).toEqual({
    title: { old: "Swimming", new: "Swim club" },
  });
  expect(fieldChanges(SERIES, { title: "Swimming", description: null, location: null, personId: null })).toEqual({
    description: { old: "Bring goggles", new: null },
    location: { old: "Pool", new: null },
  });
});

describe("what a change for every occurrence writes", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const occurrence = (key: string, hour = 17) => {
    const start = new Date(`${key}T${String(hour - 2).padStart(2, "0")}:00:00.000Z`); // Berlin is UTC+2 until 25 October
    return { id: OCC, start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString(), all_day: false, series_day: key };
  };
  const same = (o: ReturnType<typeof occurrence>) => ({ start: new Date(o.start_at), end: new Date(o.end_at), allDay: false });

  test("fields only: no occurrence is made again", () => {
    const o = occurrence("2026-10-28");
    const plan = planUpdate(SERIES, o, { fields: { title: "Swim club", location: "Pool", personId: null }, timing: same(o), rule: undefined }, now);
    expect(plan).toEqual({
      revision: 3,
      template: { title: "Swim club", description: "Bring goggles", location: "Pool", person_id: null },
      fields: { title: { old: "Swimming", new: "Swim club" } },
    });
  });

  test("a new time from an occurrence still to come: made again from today, the past left alone", () => {
    const o = occurrence("2026-10-28");
    const plan = planUpdate(SERIES, o, {
      fields: { title: "Swimming", location: "Pool", personId: null },
      timing: { start: new Date("2026-10-28T17:00:00.000Z"), end: new Date("2026-10-28T18:00:00.000Z"), allDay: false },
      rule: undefined,
    }, now);
    expect(plan.cutDay).toBe("2026-10-20");
    expect(plan.shift).toBe(0);
    expect(plan.rows![0]).toEqual({ series_day: "2026-10-21", start_at: "2026-10-21T16:00:00.000Z", end_at: "2026-10-21T17:00:00.000Z" });
    expect(plan.rows!.every((r) => r.series_day >= "2026-10-20")).toBe(true);
    expect(plan.template).toMatchObject({ first_start_at: "2026-10-19T16:00:00.000Z", generated_through: dayKey(day("2026-10-20") + HORIZON_DAYS.weekly) });
    expect(plan.untilDay).toBeNull();
  });

  test("from an occurrence in the past: made again from that one on", () => {
    const o = occurrence("2026-10-19");
    const plan = planUpdate(SERIES, o, {
      fields: { title: "Swimming", location: "Pool", personId: null },
      timing: { start: new Date("2026-10-19T17:00:00.000Z"), end: new Date("2026-10-19T18:00:00.000Z"), allDay: false },
      rule: undefined,
    }, now);
    expect(plan.cutDay).toBe("2026-10-19");
    expect(plan.rows![0].series_day).toBe("2026-10-19");
  });

  test("a day later: the series, its weekdays and the cut move with it", () => {
    const o = occurrence("2026-10-28");
    const plan = planUpdate(SERIES, o, {
      fields: { title: "Swimming", location: "Pool", personId: null },
      timing: { start: new Date("2026-10-29T16:00:00.000Z"), end: new Date("2026-10-29T17:00:00.000Z"), allDay: false },
      rule: undefined,
    }, now);
    expect(plan.shift).toBe(1);
    expect(plan.template.rule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(plan.rows![0].series_day).toBe("2026-10-20");
  });

  test("a new repeat with an end: the rows stop there and the end goes to the database", () => {
    const o = occurrence("2026-10-28");
    const plan = planUpdate(SERIES, o, {
      fields: { title: "Swimming", location: "Pool", personId: null },
      timing: same(o),
      rule: { freq: "daily", interval: 1, until: "2026-10-25" },
    }, now);
    expect(plan.untilDay).toBe("2026-10-25");
    expect(plan.rows!.map((r) => r.series_day)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(plan.template.extend_on).toBeNull();
  });
});

test("only Kinboard's own calendars take repeating events", () => {
  const local = { google_calendar_id: null, ics_url: null, caldav_url: null, is_holidays: false, is_waste_collection: false };
  expect(takesRepeatingEvents(local)).toBe(true);
  for (const over of [{ google_calendar_id: "g" }, { caldav_url: "https://dav.example" }, { ics_url: "" }, { is_holidays: true }, { is_waste_collection: true }]) {
    expect(takesRepeatingEvents({ ...local, ...over }), JSON.stringify(over)).toBe(false);
  }
});

test("the routes: the family's own session, a local calendar, and the series and occurrence of that family", () => {
  const create = codeOnly(read("src/app/api/calendar/series/route.ts"));
  expect(create).toContain("const auth = await requireSession(request);");
  expect(create).toContain("if (!familyMatchesSession(auth.session, familyId)) {");
  expect(create).toMatch(/\.from\("calendars"\)[\s\S]*?\.eq\("family_id", familyId\)/);
  expect(create).toContain("if (!takesRepeatingEvents(calendar)) {");
  expect(create).toMatch(/\.from\("people"\)[\s\S]*?\.eq\("family_id", familyId\)/);
  const byId = codeOnly(read("src/app/api/calendar/series/[id]/route.ts"));
  expect(byId.match(/requireSession\(request\)/g)?.length).toBe(2);
  expect(byId.match(/familyMatchesSession\(auth\.session, familyId\)/g)?.length).toBe(2);
  expect(byId).toContain('.from("event_series").select(SERIES_COLUMNS).eq("id", id).eq("family_id", familyId).maybeSingle()');
  expect(byId).toMatch(/\.eq\("id", id\)\s*\.eq\("series_id", series\.id\)\s*\.eq\("calendar_id", series\.calendar_id\)/);
  expect(byId).toContain('if (result.status === "stale") return NextResponse.json(CHANGED_MEANWHILE, { status: 409 });');
  expect(byId).toContain('request.nextUrl.searchParams.get("from")');
  const cron = codeOnly(read("src/app/api/cron/extend-event-series/route.ts"));
  expect(cron).toContain("if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {");
  expect(cron).toContain("await extendAllSeries(createAdminClient(), new Date())");
  // Every write is one of the two functions, or a delete of the series by id and calendar.
  const lib = codeOnly(read("src/lib/event-series.ts"));
  expect(lib).not.toMatch(/\.from\("events"\)/);
  expect(lib.match(/\.from\("event_series"\)\.delete\(\)\.eq\("id", [a-z._]+\)\.eq\("calendar_id", [a-z._]+\)/g)?.length).toBe(2);
});

test("the nightly job is wired like the others, and the migration keeps writes on the server", () => {
  expect(read("docker/Dockerfile")).toContain("http://localhost:3000/api/cron/extend-event-series' >> /usr/local/bin/extend-event-series");
  const compose = read("docker/docker-compose.yml");
  expect(compose).toContain('ofelia.job-exec.extend-event-series.command: "/usr/local/bin/extend-event-series"');
  expect(compose).toContain('ofelia.job-exec.extend-event-series.no-overlap: "true"');
  expect(read("docker/ofelia.demo.ini")).toContain('[job-exec "extend-event-series"]');
  const migration = codeOnly(read("docker/migrations/082_event_series.sql"), { sql: true });
  expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.event_series (");
  expect(migration).toContain("ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;");
  expect(migration).toMatch(/REVOKE ALL ON TABLE public\.event_series FROM authenticated;\s*GRANT SELECT ON TABLE public\.event_series TO authenticated;/);
  // The key is the pair: an event points only at a series of its own calendar.
  expect(migration).toMatch(/ADD CONSTRAINT events_series_fkey FOREIGN KEY \(series_id, calendar_id\)\s*REFERENCES public\.event_series \(id, calendar_id\) ON DELETE CASCADE;/);
  expect(migration).toContain("ADD CONSTRAINT events_series_day_key UNIQUE (series_id, series_day);");
  expect(migration).toContain("ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_series_id_fkey;");
  // A series from before extend_on is due at once, not when its last occurrence comes.
  expect(migration).toMatch(/UPDATE public\.event_series SET extend_on = CURRENT_DATE\s*WHERE revision = 0 AND \(extend_on IS NULL OR extend_on > CURRENT_DATE\);/);
  expect(migration).not.toMatch(/SET extend_on = generated_through/);
  expect(migration).not.toMatch(/series_id UUID\s*REFERENCES/);
  // Inside the write functions, every write to events names the series' calendar too (or one row by id).
  const functions = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.event_series_write("));
  const writes = functions.match(/(UPDATE public\.events\b|DELETE FROM public\.events\b)[\s\S]*?;/g) ?? [];
  expect(writes.length).toBeGreaterThan(8);
  for (const w of writes) expect(w, w.slice(0, 80)).toMatch(/calendar_id = s\.calendar_id|WHERE id = (moved\.id|occ)\b/);
  // The functions are the service role's only; the triggers can't be called.
  for (const fn of ["event_series_write(UUID, UUID, INTEGER, JSONB, JSONB, DATE, INTEGER, DATE, JSONB)", "event_series_end(UUID, UUID, DATE, TEXT, JSONB)"]) {
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    expect(migration).toContain(`'public.${fn}'`);
  }
  expect(migration).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);");
  // Writes made by another trigger (a person, a calendar, a family deleted) are not a screen's.
  expect(migration.match(/current_setting\('kinboard\.series_write', true\) = 'on' OR pg_trigger_depth\(\) > 1/g)?.length).toBe(2);
  // A series is one event created for integrations, not one per occurrence.
  const domain = codeOnly(read("docker/migrations/053_domain_events.sql"), { sql: true });
  expect(domain).toMatch(/BEGIN\s*IF current_setting\('kinboard\.series_write', true\) = 'on' THEN\s*RETURN NEW;\s*END IF;\s*IF NEW\.caldav_href IS NOT NULL/);
  expect(migration).toMatch(/IF creating THEN[\s\S]*?emit_domain_event\([\s\S]*?'kinboard_family_event_created'/);
  expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
});

test("the calendar page: a repeat in both dialogs, a series for a repeating event, and the question on change and delete", () => {
  const page = codeOnly(read("src/app/calendar/page.tsx"));
  expect(page.match(/<RepeatFields/g)?.length).toBe(2);
  expect(page).toContain("disabled={!repeatableCalendar(newEvent.calendar_id)}");
  expect(page).toMatch(/if \(rule\) \{\s*await createSeries\.mutateAsync\(\{/);
  expect(page).toContain("time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,");
  // A new repeat, or none, goes to every occurrence, after asking; otherwise the question.
  expect(page).toMatch(/!sameRepeat\(editForm\.repeat, repeatValueFromRule\(event\.recurrence_rule\)\)\) \{[\s\S]{0,120}setScopeAsk\(\{\s*kind: rule \? "repeat" : "stop",/);
  // Add and Save wait while a series is written.
  expect(page).toContain("const seriesBusy = createSeries.isPending || updateSeries.isPending || deleteSeries.isPending;");
  expect(page).toContain("disabled={!newEvent.title.trim() || !newEvent.calendar_id || createEvent.isPending || seriesBusy}");
  expect(page).toContain("disabled={!editForm.title.trim() || updateEvent.isPending || seriesBusy}");
  expect(page).toMatch(/kind: "edit",\s*run: async \(scope\) => \{\s*if \(scope === "this"\) await updateEvent\.mutateAsync/);
  expect(page).toMatch(/kind: "delete",\s*run: async \(scope\) => \{\s*if \(scope === "this"\) return deleteOneEvent\(event\);/);
  expect(page).toContain('await deleteSeries.mutateAsync({ series_id: seriesId, from: scope === "following" ? event.id : undefined });');
  expect(page).toContain("{repeatSummary(selectedEvent.recurrence_rule)}");
  // A single event given a repeat becomes the first of a series.
  expect(page).toMatch(/await createSeries\.mutateAsync\(\{\s*calendar_id: event\.calendar_id,[\s\S]*?await deleteEvent\.mutateAsync\(event\.id\);/);
  // ...keeping its description, which the dialog has no field for.
  expect(page).toMatch(/calendar_id: event\.calendar_id,\s*\.\.\.change,[\s\S]{0,120}description: event\.description \?\? null,/);
});

test("every repeat string is there in every language, with the same placeholders", () => {
  const [en, de, fr] = ["en", "de", "fr"].map((l) => JSON.parse(read(`messages/${l}.json`)).calendar);
  const flat = (o: Record<string, unknown>, prefix = ""): Array<[string, string]> =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]]));
  const keys = ["fieldRepeat", "repeat", "repeatLocalOnly", "repeatEnds", "repeatEndsNever", "repeatClearEnd", "repeatPickDay", "repeatSummary", "repeatSummaryUntil", "editSeriesTitle", "editSeriesBody", "deleteSeriesTitle", "deleteSeriesBody", "scopeThis", "scopeFollowing", "scopeAll", "seriesDeleted", "repeatChangeTitle", "repeatChangeBody", "repeatChangeConfirm", "repeatStopTitle", "repeatStopBody", "repeatStopConfirm"];
  const english = flat(Object.fromEntries(keys.map((k) => [k, en[k]])));
  expect(english.length).toBeGreaterThan(25);
  for (const [lang, messages] of [["de", de], ["fr", fr]] as const) {
    const other = new Map(flat(Object.fromEntries(keys.map((k) => [k, messages[k]]))));
    for (const [key, text] of english) {
      expect(other.get(key)?.trim(), `${lang} ${key}`).toBeTruthy();
      expect((other.get(key)!.match(/\{\w+\}/g) ?? []).sort(), `${lang} ${key}`).toEqual((text.match(/\{\w+\}/g) ?? []).sort());
    }
  }
});
