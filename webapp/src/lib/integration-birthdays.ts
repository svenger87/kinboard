/**
 * The family's birthdays through the Integration API (RFC-012 task 7):
 * listing them in the order they come round, and adding, editing and
 * deleting one the way the birthdays page does.
 *
 * Shared by GET/POST /birthdays and PATCH/DELETE /birthdays/{id}. Every
 * database function makes its own admin client unless handed one — the
 * routes never touch the client, so all family scoping lives here — and the
 * spec hands it a fake that applies the filters it is given, so a missing
 * family or deleted_at filter really does reach a foreign or binned row.
 *
 * How the app stores a birthday, which this follows rather than reinvents:
 *
 * - `birthdays.date` is a DATE and NOT NULL. There is no "unknown year"
 *   column. Leaving the year blank in the birthday form stores the date with
 *   the *current* year (birthdays/page.tsx handleSave), and lib/birthday.ts
 *   `hasBirthYear` reads a stored year that is not before the current one as
 *   "no year". So `--MM-DD` here is stored as this year's date — this year in
 *   the family's time zone — and read back as `--MM-DD` with
 *   `year_known: false` and no age. A full date in the current year would be
 *   stored identically and lose its year on the way back, so it is refused
 *   with a pointer to `--MM-DD`; a later year is a birth in the future.
 * - 29 February without a year cannot be stored in a year that is not a leap
 *   year, and the form refuses it then too ("invalid date"); so does this.
 * - 29 February falls on 1 March in a non-leap year — the day the birthdays
 *   page, the family summary and the reminder cron all use.
 * - `notify_days_before` is a real column (integer, default 7) that the
 *   reminder cron reads; the form offers 1, 3, 7 and 14, this takes 0..60.
 * - The family's "today" is the family time zone's (lib/family-time.ts), so
 *   "in 0 days" turns over at the family's midnight, not the server's.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { familyPersonId, invalidRequest, isUuid, type TaskDb } from "@/lib/integration-tasks";

export type BirthdayDb = TaskDb;

export const MAX_BIRTHDAY_NAME = 100;
export const MAX_NOTIFY_DAYS = 60;
export const DEFAULT_NOTIFY_DAYS = 7;
/** The form's own lower bound for a birth year. */
export const MIN_BIRTH_YEAR = 1900;
export { isUuid };

const COLUMNS = "id, name, date, person_id, notify_days_before";

type Row = { id: string; name: string; date: string; person_id: string | null; notify_days_before: number | null };

export interface Birthday {
  id: string;
  name: string;
  /** `YYYY-MM-DD` when the birth year is known, `--MM-DD` when it is not. */
  date: string;
  year_known: boolean;
  /** The day it next falls on, `YYYY-MM-DD`, in the family's calendar. Today counts. */
  next_date: string;
  days_until: number;
  /** Age today; null without a birth year. */
  age: number | null;
  /** Age on `next_date`; null without a birth year. */
  turns: number | null;
  person_id: string | null;
  notify_days_before: number;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const pad = (n: number) => String(n).padStart(2, "0");
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A month/day in `year`, 29 February moving to 1 March when `year` has none. */
function occurrence(year: number, month: number, day: number): { y: number; m: number; d: number } {
  if (month === 2 && day === 29 && !isLeap(year)) return { y: year, m: 3, d: 1 };
  return { y: year, m: month, d: day };
}

const key = (o: { y: number; m: number; d: number }) => `${o.y}-${pad(o.m)}-${pad(o.d)}`;
const dayNumber = (o: { y: number; m: number; d: number }) => Date.UTC(o.y, o.m - 1, o.d) / 86_400_000;

function splitDay(day: string): { y: number; m: number; d: number } {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

/**
 * A stored row as the API reports it, relative to the family's `today`
 * (`YYYY-MM-DD`). Calendar-day arithmetic in UTC on plain dates, so neither
 * the server's zone nor DST can move a birthday by a day.
 */
export function describeBirthday(row: Row, today: string): Birthday {
  const born = splitDay(row.date);
  const now = splitDay(today);
  const yearKnown = born.y < now.y; // lib/birthday.ts hasBirthYear

  let next = occurrence(now.y, born.m, born.d);
  if (dayNumber(next) < dayNumber(now)) next = occurrence(now.y + 1, born.m, born.d);
  const daysUntil = dayNumber(next) - dayNumber(now);

  // Age counts the occurrences already reached, under the same 29 February
  // rule as next_date, so on the day itself `age` and `turns` agree.
  const turns = next.y - born.y;
  const age = daysUntil === 0 ? turns : turns - 1;

  return {
    id: String(row.id),
    name: row.name,
    date: yearKnown ? row.date.slice(0, 10) : `--${pad(born.m)}-${pad(born.d)}`,
    year_known: yearKnown,
    next_date: key(next),
    days_until: daysUntil,
    age: yearKnown ? age : null,
    turns: yearKnown ? turns : null,
    person_id: row.person_id ?? null,
    notify_days_before: row.notify_days_before ?? DEFAULT_NOTIFY_DAYS,
  };
}

/**
 * `YYYY-MM-DD`, or `--MM-DD` for a birthday whose year nobody knows, as the
 * date to store. The year must be from 1900 (the form's lower bound) to
 * last year: the form's upper bound is this year, but a birth year of this
 * year is stored exactly like an unknown one and read back without it, so
 * accepting it would silently drop what the caller said. The day must exist
 * in that month. `--MM-DD` is stored
 * with the current year, as the form stores a blank year — so 29 February
 * without a year is refused unless this year is a leap year, as the form
 * refuses it.
 */
export function parseBirthdayDate(value: unknown, today: string): Outcome<string> {
  const bad = (error: string) => ({ ok: false as const, error });
  const shape = "`date` must be YYYY-MM-DD, or --MM-DD when the year is unknown";
  if (typeof value !== "string") return bad(shape);
  const thisYear = Number(today.slice(0, 4));

  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const yearless = /^--(\d{2})-(\d{2})$/.exec(value);
  if (!full && !yearless) return bad(shape);

  const year = full ? Number(full[1]) : thisYear;
  const month = Number(full ? full[2] : yearless![1]);
  const day = Number(full ? full[3] : yearless![2]);

  if (full && year > thisYear) return bad(`\`date\` is in the future: ${value}`);
  if (full && year === thisYear) {
    return bad(`a birth year of ${thisYear} cannot be told apart from an unknown year in Kinboard; send --${full[2]}-${full[3]}, which is stored the same way and shows no age`);
  }
  if (full && year < MIN_BIRTH_YEAR) {
    return bad(`the birth year must be from ${MIN_BIRTH_YEAR} to ${thisYear - 1}; use --MM-DD when it is unknown`);
  }
  if (month < 1 || month > 12 || day < 1) return bad(`\`date\` is not a real date: ${value}`);
  if (day > daysInMonth(year, month)) {
    if (!full && month === 2 && day === 29) {
      return bad(`29 February needs a birth year: without one Kinboard stores the date in ${thisYear}, which has no 29 February`);
    }
    return bad(`\`date\` is not a real date: ${value}`);
  }
  return { ok: true, value: `${year}-${pad(month)}-${pad(day)}` };
}

/**
 * The plain fields of a create or a patch: name, date, notify_days_before.
 * Only keys present in the body appear in the result. person_id needs the
 * database and is checked separately (familyPersonId).
 */
export function parseBirthdayFields(
  body: Record<string, unknown>,
  today: string,
): Outcome<{ name?: string; date?: string; notify_days_before?: number }> {
  const out: { name?: string; date?: string; notify_days_before?: number } = {};
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_BIRTHDAY_NAME) {
      return { ok: false, error: `\`name\` is required, at most ${MAX_BIRTHDAY_NAME} characters` };
    }
    out.name = name;
  }
  if ("date" in body) {
    const date = parseBirthdayDate(body.date, today);
    if (!date.ok) return date;
    out.date = date.value;
  }
  if ("notify_days_before" in body) {
    const n = body.notify_days_before;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_NOTIFY_DAYS) {
      return { ok: false, error: `\`notify_days_before\` must be a whole number from 0 to ${MAX_NOTIFY_DAYS}` };
    }
    out.notify_days_before = n;
  }
  return { ok: true, value: out };
}

type Result = { status: number; response: Record<string, unknown> };

/** Every birthday of the family not in the recycle bin, the next one first. Throws on a database error. */
export async function listBirthdays(familyId: string, today: string, db: BirthdayDb = createAdminClient()): Promise<Birthday[]> {
  // No cap: a household's birthdays are household-sized, and a capped read
  // without an order would drop an arbitrary one without saying so.
  const { data, error } = await (db as any)
    .from("birthdays")
    .select(COLUMNS)
    .eq("family_id", familyId)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as Row[])
    .map((row) => describeBirthday(row, today))
    .sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name));
}

/**
 * POST /birthdays once the key and idempotency are dealt with. Nothing is
 * written when any field is refused. Throws on a database error.
 */
export async function createBirthday(
  familyId: string, body: Record<string, unknown>, today: string, db: BirthdayDb = createAdminClient(),
): Promise<Result> {
  if (!("name" in body)) return invalidRequest("`name` is required");
  if (!("date" in body)) return invalidRequest("`date` is required: YYYY-MM-DD, or --MM-DD when the year is unknown");
  const fields = parseBirthdayFields(body, today);
  if (!fields.ok) return invalidRequest(fields.error);

  const row: Record<string, unknown> = {
    family_id: familyId,
    name: fields.value.name,
    date: fields.value.date,
    notify_days_before: fields.value.notify_days_before ?? DEFAULT_NOTIFY_DAYS,
    person_id: null,
  };
  if (body.person_id !== undefined) {
    const person = await familyPersonId(db, familyId, body.person_id);
    if (!person.ok) return invalidRequest(person.error);
    row.person_id = person.value;
  }

  const { data, error } = await (db as any).from("birthdays").insert(row).select(COLUMNS).single();
  if (error) throw error;
  return { status: 201, response: { birthday: describeBirthday(data as Row, today) } };
}

/**
 * PATCH /birthdays/{id}: only the fields sent change. A birthday that is
 * missing, binned or another family's is 404. Throws on a database error.
 */
export async function updateBirthday(
  familyId: string, id: string, body: Record<string, unknown>, today: string, db: BirthdayDb = createAdminClient(),
): Promise<Result> {
  const notFound = { status: 404, response: { error: "no such birthday", code: "not_found" } };
  if (!isUuid(id)) return notFound;

  const fields = parseBirthdayFields(body, today);
  if (!fields.ok) return invalidRequest(fields.error);
  const patch: Record<string, unknown> = { ...fields.value };
  if ("person_id" in body) {
    const person = await familyPersonId(db, familyId, body.person_id);
    if (!person.ok) return invalidRequest(person.error);
    patch.person_id = person.value;
  }
  if (Object.keys(patch).length === 0) {
    return invalidRequest("nothing to change — send name, date, person_id or notify_days_before");
  }

  const { data, error } = await (db as any)
    .from("birthdays")
    .update(patch)
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound;
  return { status: 200, response: { birthday: describeBirthday(data as Row, today) } };
}

/**
 * DELETE /birthdays/{id}: into the recycle bin, through the soft-delete
 * trigger, exactly as the birthdays page deletes one. Returns false for a
 * birthday that is missing, binned or another family's.
 *
 * The SELECT decides that, not the DELETE: the BEFORE DELETE trigger stamps
 * deleted_at and returns NULL, which also empties the DELETE's RETURNING, so
 * a successful soft delete and a delete that matched nothing look the same
 * from here. `.is("deleted_at", null)` stays on the DELETE as well — the
 * trigger lets a DELETE of an already-binned row through as a real purge.
 * Throws on a database error.
 */
export async function deleteBirthday(familyId: string, id: string, db: BirthdayDb = createAdminClient()): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data: existing, error: selectErr } = await (db as any)
    .from("birthdays")
    .select("id")
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!existing) return false;

  const { error } = await (db as any)
    .from("birthdays")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null);
  if (error) throw error;
  return true;
}
