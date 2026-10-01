import { familyDateKey } from "@/lib/family-time";
import { zonedWallTimeToUtc } from "@/lib/integration-event-input";
import type { createAdminClient } from "@/lib/supabase/server";

/**
 * The real admin client, not a narrowed interface: a method the client
 * does not have (an earlier draft called `.imatch()`, which supabase-js
 * names `regexIMatch`) is then a type error here. Tests cast their fake to
 * this at the test boundary.
 */
export type SearchDb = ReturnType<typeof createAdminClient>;

/**
 * Finding an appointment by what it is called: `GET
 * /api/integration/v1/calendar/events?query=` (RFC-012 §2, the
 * `search_calendar_events` tool).
 *
 * `query` is the caller's text, so it must never become filter syntax. Two
 * layers keep it literal:
 *
 * 1. **No `.or()` string.** Each column is its own request with its own
 *    `.regexIMatch(column, pattern)` (PostgREST's `imatch`); supabase-js
 *    puts the pattern in that one query parameter's value, where `,` `(`
 *    `)` `.` are plain characters.
 *    A comma-joined `.or()` filter is exactly where they would start a new
 *    clause, so it is not used. The three answers are merged here.
 * 2. **Every special character escaped.** The match is a case-insensitive
 *    regular expression (`~*`) built from the query with every ASCII
 *    punctuation character backslash-escaped, so `%`, `_`, `*`, `\`, `.`
 *    and the rest match themselves and nothing else. `ilike` was the first
 *    choice and cannot do this: PostgREST rewrites every `*` in a like
 *    pattern to `%`, escaped or not, so a literal `*` cannot be searched
 *    for at all. In PostgreSQL's regex syntax a backslash before a
 *    non-alphanumeric character always means that character literally, and
 *    non-ASCII characters are never special, so the escaped pattern is a
 *    plain substring test — the same question `ilike '%…%'` asks.
 */

/** Columns the text is looked for in. */
export const SEARCH_COLUMNS = ["title", "location", "description"] as const;
/** The most events one search returns, earliest first. */
export const SEARCH_LIMIT = 100;
/** Window searched when the caller gives none: today and the next 365 days. */
export const SEARCH_DEFAULT_DAYS = 365;
export const MAX_QUERY_LENGTH = 200;

/** What the list endpoint has always returned for an event. */
export const LISTED_EVENT_COLUMNS = "id, title, description, location, start_at, end_at, all_day, person_id";

/** The query as the caller meant it, or why it cannot be used. */
export function parseSearchQuery(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  // Control characters (a newline, a NUL) are not something anyone types
  // into a calendar search; refusing them keeps the pattern one plain line.
  // Code points, as OpenAPI's and the tool schema's maxLength count them,
  // not UTF-16 units: an emoji is one character.
  if (!value || [...value].length > MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, error: `\`query\` must be 1 to ${MAX_QUERY_LENGTH} characters of plain text` };
  }
  return { ok: true, value };
}

/**
 * `text` as a regular expression that matches exactly that text: every
 * ASCII character that is not a letter, digit or space gets a backslash.
 */
export function literalPattern(text: string): string {
  return text.replace(/[!-/:-@[-`{-~]/g, (c) => `\\${c}`);
}

/**
 * The default window, in the family's zone: from the start of today to the
 * start of the day 365 days on — an appointment later today is found, one
 * that ended yesterday is not.
 */
export function defaultSearchWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = familyDateKey(now, timeZone).split("-").map(Number);
  const today = Date.UTC(y, m - 1, d) / 86_400_000;
  return {
    start: zonedWallTimeToUtc(today, 0, timeZone),
    end: zonedWallTimeToUtc(today + SEARCH_DEFAULT_DAYS, 0, timeZone),
  };
}

type ListedEvent = { id: string; start_at: string } & Record<string, unknown>;

/**
 * Events in `calendarIds` overlapping `[start, end)` whose title, location
 * or description contains `query`, ignoring case — at most SEARCH_LIMIT,
 * earliest first. The caller has already limited `calendarIds` to the
 * family's own calendars. Throws on a database error.
 *
 * Each column's request is itself limited to SEARCH_LIMIT, ordered by
 * (start_at, id) — the merge's own order, so ties at the cut are decided
 * the same way in both places — and so the merged first SEARCH_LIMIT are the true first SEARCH_LIMIT: any
 * event among them is among the first SEARCH_LIMIT of the column it matched.
 */
export async function searchEvents(
  db: SearchDb,
  calendarIds: string[],
  query: string,
  start: Date,
  end: Date,
): Promise<ListedEvent[]> {
  if (calendarIds.length === 0) return [];
  const pattern = literalPattern(query);
  const answers = await Promise.all(
    SEARCH_COLUMNS.map((column) =>
      db
        .from("events")
        .select(LISTED_EVENT_COLUMNS)
        .in("calendar_id", calendarIds)
        .lt("start_at", end.toISOString())
        .gt("end_at", start.toISOString())
        .regexIMatch(column, pattern)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(SEARCH_LIMIT),
    ),
  );
  const byId = new Map<string, ListedEvent>();
  for (const { data, error } of answers) {
    if (error) throw error;
    for (const event of (data ?? []) as ListedEvent[]) byId.set(event.id, event);
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.id.localeCompare(b.id))
    .slice(0, SEARCH_LIMIT);
}
