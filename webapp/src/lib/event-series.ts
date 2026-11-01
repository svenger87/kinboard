/**
 * Writing a repeating event: the series row and its occurrences, which are
 * ordinary rows in `events` (lib/event-repeat.ts decides when they fall).
 * Server only, on the service role: the routes under /api/calendar/series and
 * the daily cron that keeps every series' occurrences far enough ahead.
 *
 * This file works out what to write; the database writes it, in one
 * transaction under the series' row lock (event_series_write() and
 * event_series_end() in docker/migrations/082_event_series.sql), so
 * a failure part-way leaves nothing behind and a day of a series is never
 * written twice.
 */
import {
  HORIZON_DAYS,
  MAX_OCCURRENCES,
  dayFromKey,
  dayKey,
  formatRepeatRule,
  horizonDay,
  occurrences,
  parseRepeatRule,
  wallParts,
  type RepeatRule,
  type WallDay,
} from "@/lib/event-repeat";
import { zonedWallTimeToUtc } from "@/lib/integration-event-input";
import type { SeriesFields, SeriesTiming } from "@/lib/event-series-input";

/* The admin client is deliberately untyped in this codebase (see family-scope.ts). */
type Admin = any;

export interface SeriesRow {
  id: string;
  family_id: string;
  calendar_id: string;
  rule: string;
  time_zone: string;
  first_start_at: string;
  first_end_at: string;
  all_day: boolean;
  title: string;
  description: string | null;
  location: string | null;
  person_id: string | null;
  generated_through: string;
  skipped_days: string[];
  extend_on: string | null;
  revision: number;
}

export const SERIES_COLUMNS =
  "id, family_id, calendar_id, rule, time_zone, first_start_at, first_end_at, all_day, title, description, location, person_id, generated_through, skipped_days, extend_on, revision";

/** An occurrence as event_series_write() takes it; the rest comes from the series. */
export interface OccurrenceRow {
  series_day: string;
  start_at: string;
  end_at: string;
}

/** The occurrence a change is made on. */
export interface OccurrenceRef {
  id: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  series_day: string | null;
}

type Template = Pick<SeriesRow, "rule" | "time_zone" | "first_start_at" | "first_end_at" | "all_day">;

/**
 * The nightly job tops a series up when its occurrences reach this many days
 * short of its horizon, and then fills the horizon again: a series is
 * written about once a month, not every night.
 */
export const REFILL_DAYS = 30;

/** The series' own today. */
export function todayIn(series: Pick<SeriesRow, "time_zone">, now: Date): WallDay {
  return wallParts(now, series.time_zone).day;
}

/** The day of the series an occurrence fills (its start's day, for a row from before series_day). */
export function occurrenceDay(series: Pick<SeriesRow, "time_zone">, occurrence: Pick<OccurrenceRef, "series_day" | "start_at">): WallDay {
  const day = occurrence.series_day ? dayFromKey(occurrence.series_day) : null;
  return day ?? wallParts(new Date(occurrence.start_at), series.time_zone).day;
}

/**
 * The occurrences on the wall days `fromDay`..`toDay`, and the last day they
 * cover: `toDay`, or the last one made when the cap stopped them sooner. The
 * days before `today` and the days from `today` on are capped separately, so
 * however long a series has been going, it always reaches past today.
 */
export function occurrenceRows(series: Template, fromDay: WallDay, toDay: WallDay, today: WallDay) {
  const rule = parseRepeatRule(series.rule);
  if (!rule || toDay < fromDay) return { rows: [] as OccurrenceRow[], through: toDay };
  const make = (from: WallDay, to: WallDay) =>
    from > to
      ? []
      : occurrences({
          first: { start: new Date(series.first_start_at), end: new Date(series.first_end_at) },
          allDay: series.all_day,
          rule,
          timeZone: series.time_zone,
          fromDay: from,
          toDay: to,
        });
  const past = make(fromDay, Math.min(toDay, today - 1));
  const ahead = make(Math.max(fromDay, today), toDay);
  const dayOf = (start: Date) => wallParts(start, series.time_zone).day;
  let through = toDay;
  if (ahead.length >= MAX_OCCURRENCES) through = dayOf(ahead[ahead.length - 1].start);
  else if (ahead.length === 0 && toDay < today && past.length >= MAX_OCCURRENCES) through = dayOf(past[past.length - 1].start);
  const rows = [...past, ...ahead].map((o) => ({
    series_day: dayKey(dayOf(o.start)),
    start_at: o.start.toISOString(),
    end_at: o.end.toISOString(),
  }));
  return { rows, through };
}

/** The last day a series should have occurrences for, today. */
export function targetDay(series: Template, rule: RepeatRule, now: Date): WallDay {
  const firstDay = wallParts(new Date(series.first_start_at), series.time_zone).day;
  return horizonDay(rule, Math.max(todayIn(series, now), firstDay));
}

/** When the nightly job should next top the series up: null once its repeat has ended. */
export function extendOn(rule: RepeatRule, through: WallDay): string | null {
  const until = rule.until ? dayFromKey(rule.until) : null;
  if (until !== null && through >= until) return null;
  return dayKey(through - HORIZON_DAYS[rule.freq] + REFILL_DAYS);
}

/** "All events" field changes, as event_series_write() takes them: only what changed. */
export function fieldChanges(series: SeriesRow, fields: SeriesFields) {
  const next: Record<string, string | null> = {
    title: fields.title,
    location: fields.location,
    person_id: fields.personId,
  };
  if (fields.description !== undefined) next.description = fields.description;
  const changes: Record<string, { old: string | null; new: string | null }> = {};
  for (const [column, value] of Object.entries(next)) {
    const old = series[column as "title" | "location" | "person_id" | "description"];
    if (value !== old) changes[column] = { old, new: value };
  }
  return changes;
}

function fieldTemplate(series: SeriesRow, fields: SeriesFields) {
  return {
    title: fields.title,
    description: fields.description === undefined ? series.description : fields.description,
    location: fields.location,
    person_id: fields.personId,
  };
}

/** The series ends on `lastDay`: its rule with that UNTIL, or the earlier one it had. */
export function endedRule(series: Pick<SeriesRow, "rule">, lastDay: WallDay): string {
  const rule = parseRepeatRule(series.rule);
  if (!rule) return series.rule;
  const oldUntil = rule.until ? dayFromKey(rule.until) : null;
  const untilDay = oldUntil === null ? lastDay : Math.min(oldUntil, lastDay);
  return formatRepeatRule({ ...rule, until: dayKey(untilDay) });
}

export type WriteStatus = "ok" | "stale" | "gone";

export interface SeriesWrite {
  revision: number | null;
  template: Record<string, unknown>;
  fields?: Record<string, unknown>;
  cutDay?: string | null;
  shift?: number;
  untilDay?: string | null;
  rows?: OccurrenceRow[];
}

async function write(admin: Admin, series: Pick<SeriesRow, "id" | "calendar_id">, w: SeriesWrite) {
  const { data, error } = await admin.rpc("event_series_write", {
    p_series_id: series.id,
    p_calendar_id: series.calendar_id,
    p_revision: w.revision,
    p_template: w.template,
    p_fields: w.fields ?? {},
    p_cut_day: w.cutDay ?? null,
    p_shift: w.shift ?? 0,
    p_until_day: w.untilDay ?? null,
    p_rows: w.rows ?? [],
  });
  if (error) throw error;
  return data as { status: WriteStatus; inserted?: number; revision?: number };
}

async function end(
  admin: Admin,
  series: Pick<SeriesRow, "id" | "calendar_id">,
  lastDay: WallDay,
  rule: string,
  occurrence: Record<string, unknown> | null,
) {
  const { data, error } = await admin.rpc("event_series_end", {
    p_series_id: series.id,
    p_calendar_id: series.calendar_id,
    p_last_day: dayKey(lastDay),
    p_rule: rule,
    p_occurrence: occurrence,
  });
  if (error) throw error;
  return data as { status: "ok" | "gone"; series?: "ended" | "deleted" | "single" };
}

/** A new series and its first occurrences. */
export async function createSeries(
  admin: Admin,
  input: { familyId: string; calendarId: string; fields: SeriesFields; timing: SeriesTiming; rule: RepeatRule; timeZone: string; now: Date },
): Promise<{ id: string; occurrences: number }> {
  const firstDay = wallParts(input.timing.start, input.timeZone).day;
  const { data: series, error } = await admin
    .from("event_series")
    .insert({
      family_id: input.familyId,
      calendar_id: input.calendarId,
      rule: formatRepeatRule(input.rule),
      time_zone: input.timeZone,
      first_start_at: input.timing.start.toISOString(),
      first_end_at: input.timing.end.toISOString(),
      all_day: input.timing.allDay,
      title: input.fields.title,
      description: input.fields.description ?? null,
      location: input.fields.location,
      person_id: input.fields.personId,
      generated_through: dayKey(firstDay - 1),
    })
    .select(SERIES_COLUMNS)
    .single();
  if (error) throw error;
  const row = series as SeriesRow;
  try {
    const { rows, through } = occurrenceRows(row, firstDay, targetDay(row, input.rule, input.now), todayIn(row, input.now));
    const result = await write(admin, row, {
      revision: row.revision,
      template: { generated_through: dayKey(through), extend_on: extendOn(input.rule, through) },
      rows,
    });
    if (result.status !== "ok") throw new Error(`event series: the new series was ${result.status}`);
    return { id: row.id, occurrences: result.inserted ?? 0 };
  } catch (err) {
    await admin.from("event_series").delete().eq("id", row.id).eq("calendar_id", row.calendar_id);
    throw err;
  }
}

/**
 * The daily top-up: every series due (its `extend_on` reached) gets the
 * occurrences up to its horizon, from the day after `generated_through` (so
 * an occurrence deleted on its own is not made again). A series that was
 * written since it was read here is left for the next night, and one that
 * fails is logged without stopping the rest.
 */
export async function extendAllSeries(
  admin: Admin,
  now: Date,
): Promise<{ series: number; added: number; stale: number; failed: number }> {
  // Every zone's today is at most a day past UTC's.
  const due = dayKey(Math.floor(now.getTime() / 86_400_000) + 1);
  const { data, error } = await admin
    .from("event_series")
    .select(SERIES_COLUMNS)
    .not("extend_on", "is", null)
    .lte("extend_on", due);
  if (error) throw error;
  const result = { series: 0, added: 0, stale: 0, failed: 0 };
  for (const row of (data ?? []) as SeriesRow[]) {
    try {
      const rule = parseRepeatRule(row.rule);
      const from = dayFromKey(row.generated_through);
      if (!rule || from === null) continue;
      const { rows, through } = occurrenceRows(row, from + 1, targetDay(row, rule, now), todayIn(row, now));
      const reached = Math.max(from, through);
      const written = await write(admin, row, {
        revision: row.revision,
        template: { generated_through: dayKey(reached), extend_on: extendOn(rule, reached) },
        rows,
      });
      if (written.status !== "ok") {
        result.stale += 1;
        continue;
      }
      result.series += 1;
      result.added += written.inserted ?? 0;
    } catch (err) {
      result.failed += 1;
      console.error(`event series: top-up failed for series ${row.id}`, err);
    }
  }
  return result;
}

/** What an "All events" change writes, worked out from the series and the occurrence it was made on. */
export function planUpdate(
  series: SeriesRow,
  occurrence: OccurrenceRef,
  change: { fields: SeriesFields; timing: SeriesTiming; rule: RepeatRule | undefined },
  now: Date,
): SeriesWrite {
  const zone = series.time_zone;
  const oldStart = wallParts(new Date(occurrence.start_at), zone);
  const oldEnd = wallParts(new Date(occurrence.end_at), zone);
  const newStart = wallParts(change.timing.start, zone);
  const newEnd = wallParts(change.timing.end, zone);
  const shift = newStart.day - oldStart.day;
  const timingChanged =
    shift !== 0 ||
    change.timing.allDay !== occurrence.all_day ||
    (!change.timing.allDay && newStart.msIntoDay !== oldStart.msIntoDay) ||
    newEnd.day - newStart.day !== oldEnd.day - oldStart.day ||
    newEnd.msIntoDay !== oldEnd.msIntoDay;

  const oldRule = parseRepeatRule(series.rule);
  const rule: RepeatRule | null = change.rule ?? (oldRule && shiftRule(oldRule, shift));
  if (!rule) throw new Error("the series' rule cannot be read");
  const ruleText = formatRepeatRule(rule);
  const fields = fieldChanges(series, change.fields);
  const template = fieldTemplate(series, change.fields);

  if (!timingChanged && ruleText === series.rule) {
    return { revision: series.revision, template, fields };
  }

  // Made again from the edited occurrence, or from today if that is earlier:
  // what happened before stays as it was.
  const today = todayIn(series, now);
  const cutDay = Math.min(occurrenceDay(series, occurrence), today);
  const firstDay = wallParts(new Date(series.first_start_at), zone).day + shift;
  const span = newEnd.day - newStart.day;
  const next: SeriesRow = {
    ...series,
    rule: ruleText,
    all_day: change.timing.allDay,
    first_start_at: zonedWallTimeToUtc(firstDay, change.timing.allDay ? 0 : newStart.msIntoDay, zone).toISOString(),
    first_end_at: zonedWallTimeToUtc(firstDay + span, newEnd.msIntoDay, zone).toISOString(),
  };
  const { rows, through } = occurrenceRows(next, cutDay + Math.min(shift, 0), targetDay(next, rule, now), today);
  return {
    revision: series.revision,
    template: {
      ...template,
      rule: next.rule,
      all_day: next.all_day,
      first_start_at: next.first_start_at,
      first_end_at: next.first_end_at,
      generated_through: dayKey(through),
      extend_on: extendOn(rule, through),
    },
    fields,
    cutDay: dayKey(cutDay),
    shift,
    untilDay: rule.until ?? null,
    rows,
  };
}

/**
 * "All events", from an edit made on one occurrence. A new title, place,
 * description or person goes to every occurrence, except one changed on its
 * own in that field. A new time, day, length or repeat makes the series again
 * from that occurrence (or today, if earlier) on: moving the occurrence by
 * some days moves the series by as many (and a weekly series' weekdays with
 * it), unless a new repeat was chosen too. Earlier occurrences, occurrences
 * changed on their own and days deleted on their own are kept.
 *
 * `rule` null stops the repeat at that occurrence: it takes the change, the
 * ones after it go, and earlier ones stay (it becomes a plain event if it was
 * the only one left).
 */
export async function updateSeries(
  admin: Admin,
  series: SeriesRow,
  occurrence: OccurrenceRef,
  change: { fields: SeriesFields; timing: SeriesTiming; rule: RepeatRule | null | undefined },
  now: Date,
): Promise<{ status: WriteStatus; occurrences?: number; series?: string }> {
  if (change.rule === null) {
    const day = occurrenceDay(series, occurrence);
    const values: Record<string, unknown> = {
      id: occurrence.id,
      title: change.fields.title,
      location: change.fields.location,
      person_id: change.fields.personId,
      start_at: change.timing.start.toISOString(),
      end_at: change.timing.end.toISOString(),
      all_day: change.timing.allDay,
    };
    if (change.fields.description !== undefined) values.description = change.fields.description;
    const ended = await end(admin, series, day, endedRule(series, day), values);
    return { status: ended.status === "ok" ? "ok" : "gone", series: ended.series };
  }
  const written = await write(admin, series, planUpdate(series, occurrence, { ...change, rule: change.rule }, now));
  return { status: written.status, occurrences: written.inserted };
}

/** A weekly series' weekdays moved by `shift` days with the series; other rules move with their first day. */
export function shiftRule(rule: RepeatRule, shift: number): RepeatRule {
  if (rule.freq !== "weekly" || !rule.weekdays || shift % 7 === 0) return rule;
  const weekdays = [...new Set(rule.weekdays.map((d) => (((d + shift) % 7) + 7) % 7))].sort((a, b) => a - b);
  return { ...rule, weekdays };
}

/**
 * Delete a series: all of it, or from one occurrence on ("this and
 * following"), which ends the repeat the day before so the top-up stops there.
 */
export async function deleteSeries(
  admin: Admin,
  series: SeriesRow,
  from?: OccurrenceRef,
): Promise<{ deleted: "series" | "following" }> {
  if (!from) {
    const { error } = await admin.from("event_series").delete().eq("id", series.id).eq("calendar_id", series.calendar_id);
    if (error) throw error;
    return { deleted: "series" };
  }
  const day = occurrenceDay(series, from);
  const ended = await end(admin, series, day - 1, endedRule(series, day - 1), null);
  return { deleted: ended.series === "ended" ? "following" : "series" };
}
