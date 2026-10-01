/**
 * Countdowns ("12 days until the holidays"), shared between the countdown
 * widget and the Integration API (`/api/integration/v1/countdowns`, an
 * assistant calling list_countdowns / add_countdown / delete_countdown).
 * RFC-012 task 11.
 *
 * There is no countdowns table. The widget keeps the whole list in one
 * settings row, `settings.key = 'countdowns'`, as a JSON array of
 * `{ id, title, date, icon }` — `id` a `crypto.randomUUID()`, `date` a
 * plain `YYYY-MM-DD`, `icon` one of COUNTDOWN_ICONS. This module writes
 * exactly that shape, so the widget reads an assistant's countdown like its
 * own, and it keeps any field it does not know on entries it did not touch.
 *
 * Because the list is one row, adding or removing an entry is a
 * read-modify-write of the whole array. Two writers doing that at once —
 * an assistant and someone at the panel, or two assistants — would lose
 * one write. So the write here is optimistic: read the row with its
 * `updated_at` (set by the table's BEFORE UPDATE trigger on every change),
 * write the new array `WHERE updated_at = <what was read>`, and if that
 * matched no row somebody else wrote in between: read again and redo the
 * change on their version, up to MAX_COUNTDOWN_RETRIES more times, then
 * give up with 409. The widget's own save (PUT /api/settings) is a plain
 * upsert and takes no part in this; a widget holding a stale list can still
 * overwrite an assistant's change, as it can overwrite another screen's.
 *
 * Every database function makes its own admin client unless handed one, and
 * scopes every statement by `family_id` itself (the client bypasses RLS);
 * e2e/integration-countdowns.spec.ts hands it a fake that applies the
 * filters, so a missing family filter does reach the other family's row.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { invalidRequest, isUuid, type TaskDb } from "@/lib/integration-tasks";
import { COUNTDOWN_ICONS, DEFAULT_COUNTDOWN_ICON } from "@/lib/countdown-icons";

export type CountdownDb = TaskDb;
export { isUuid, COUNTDOWN_ICONS, DEFAULT_COUNTDOWN_ICON };

export const MAX_COUNTDOWN_TITLE = 60;
/** Further attempts after a write lost to a concurrent one, before 409. */
export const MAX_COUNTDOWN_RETRIES = 3;

/** One stored entry, as the widget writes it. */
export interface Countdown {
  id: string;
  title: string;
  date: string;
  icon: string;
}

export interface CountdownView extends Countdown {
  /** Whole days from the family's today to `date`; 0 on the day itself. */
  days_until: number;
}

type Result = { status: number; response: Record<string, unknown> };
type Entry = Record<string, unknown>;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day as `YYYY-MM-DD`, or null. */
function realDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return value;
}

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

/** The stored value as a list of entries; anything that is not an array of objects reads as empty. */
function entriesOf(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((e): e is Entry => !!e && typeof e === "object" && !Array.isArray(e));
}

/** An entry the widget would show, relative to the family's `today`; null for one it could not. */
export function describeCountdown(entry: Entry, today: string): CountdownView | null {
  const date = realDay(entry.date);
  if (typeof entry.id !== "string" || typeof entry.title !== "string" || !date) return null;
  return {
    id: entry.id,
    title: entry.title,
    date,
    icon: typeof entry.icon === "string" ? entry.icon : DEFAULT_COUNTDOWN_ICON,
    days_until: dayNumber(date) - dayNumber(today),
  };
}

/**
 * The countdowns the widget shows: today's and later ones (the widget hides
 * a passed date and drops it at its next save), the soonest first.
 */
export function visibleCountdowns(value: unknown, today: string): CountdownView[] {
  return entriesOf(value)
    .map((e) => describeCountdown(e, today))
    .filter((c): c is CountdownView => c !== null && c.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** A new entry from a request body, or why not. Pure. */
export function parseCountdown(
  body: Record<string, unknown>,
  today: string,
  newId: () => string = () => crypto.randomUUID(),
): { ok: true; value: Countdown } | { ok: false; error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > MAX_COUNTDOWN_TITLE) {
    return { ok: false, error: `\`title\` is required, at most ${MAX_COUNTDOWN_TITLE} characters` };
  }
  const date = realDay(body.date);
  if (!date) return { ok: false, error: "`date` must be a real day as YYYY-MM-DD" };
  if (date < today) return { ok: false, error: `\`date\` has passed: today is ${today} in the family's time zone` };
  let icon: string = DEFAULT_COUNTDOWN_ICON;
  if (body.icon !== undefined && body.icon !== null) {
    if (typeof body.icon !== "string" || !(COUNTDOWN_ICONS as readonly string[]).includes(body.icon)) {
      return { ok: false, error: `\`icon\` must be one of ${COUNTDOWN_ICONS.join(" ")}` };
    }
    icon = body.icon;
  }
  return { ok: true, value: { id: newId(), title, date, icon } };
}

async function readRow(db: CountdownDb, familyId: string): Promise<{ value: unknown; updated_at: string | null } | null> {
  const { data, error } = await (db as any)
    .from("settings")
    .select("value, updated_at")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.countdowns)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Read the family's countdowns, apply `change`, and write them back only if
 * nobody wrote in between — see the module comment. `change` gets the
 * current entries and returns the new list, or a Result to answer with
 * instead of writing (a 404, say). Throws on a database error.
 */
export async function changeCountdowns(
  familyId: string,
  change: (entries: Entry[]) => Entry[] | Result,
  db: CountdownDb = createAdminClient(),
): Promise<{ written: Entry[] } | Result> {
  for (let attempt = 0; attempt <= MAX_COUNTDOWN_RETRIES; attempt++) {
    const row = await readRow(db, familyId);
    const next = change(entriesOf(row?.value));
    if (!Array.isArray(next)) return next;

    if (!row) {
      // No row yet. The unique (family_id, key) constraint makes a second
      // first-writer fail with 23505, which is the same "somebody wrote in
      // between" as an update matching nothing.
      const { error } = await (db as any)
        .from("settings")
        .insert({ family_id: familyId, key: SETTINGS_KEYS.countdowns, value: next });
      if (!error) return { written: next };
      if (error.code === "23505") continue;
      throw error;
    }

    const update = (db as any)
      .from("settings")
      .update({ value: next })
      .eq("family_id", familyId)
      .eq("key", SETTINGS_KEYS.countdowns);
    // The column is nullable (no row written by this app leaves it so, but
    // `= NULL` would never match and turn every write into a 409).
    const { data, error } = await (row.updated_at === null
      ? update.is("updated_at", null)
      : update.eq("updated_at", row.updated_at)
    ).select("id");
    if (error) throw error;
    if ((data ?? []).length > 0) return { written: next };
  }
  return {
    status: 409,
    response: { error: "the countdowns were changed by someone else at the same moment; try again", code: "conflict" },
  };
}

/** GET /countdowns. Throws on a database error. */
export async function listCountdowns(familyId: string, today: string, db: CountdownDb = createAdminClient()): Promise<CountdownView[]> {
  const row = await readRow(db, familyId);
  return visibleCountdowns(row?.value, today);
}

/** POST /countdowns once the key and idempotency are dealt with. Throws on a database error. */
export async function addCountdown(
  familyId: string, body: Record<string, unknown>, today: string, db: CountdownDb = createAdminClient(),
): Promise<Result> {
  const parsed = parseCountdown(body, today);
  if (!parsed.ok) return invalidRequest(parsed.error);
  const entry = parsed.value;
  const outcome = await changeCountdowns(familyId, (entries) => [...entries, entry as unknown as Entry], db);
  if ("status" in outcome) return outcome;
  return { status: 201, response: { countdown: describeCountdown(entry as unknown as Entry, today) } };
}

/**
 * DELETE /countdowns/{id}: takes the entry out of the list, as the widget's
 * bin button does. There is no recycle bin for countdowns. A missing id —
 * or one only in another family's list — is 404. Throws on a database error.
 */
export async function deleteCountdown(familyId: string, id: string, db: CountdownDb = createAdminClient()): Promise<Result> {
  const notFound: Result = { status: 404, response: { error: "no such countdown", code: "not_found" } };
  if (!isUuid(id)) return notFound;
  const outcome = await changeCountdowns(familyId, (entries) => {
    const kept = entries.filter((e) => e.id !== id);
    return kept.length === entries.length ? notFound : kept;
  }, db);
  if ("status" in outcome) return outcome;
  return { status: 200, response: { ok: true, id } };
}
