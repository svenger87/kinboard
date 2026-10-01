import { test, expect } from "@playwright/test";
import { createAdminClient } from "../src/lib/supabase/server";
import { searchEvents, type SearchDb } from "../src/lib/integration-event-search";

/**
 * The calendar search's escaping, proven against PostgreSQL through
 * PostgREST rather than against JavaScript's RegExp. The unit spec
 * (integration-event-search.spec.ts) evaluates the pattern with `new
 * RegExp`, whose identity escapes happen to agree with PostgreSQL's ARE for
 * this escape set; this spec is the evidence that they really do.
 *
 * Needs a stack: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL) for its PostgREST, e.g. Kong on :8130 here.
 * Skipped without them, unless FAMILY_CODE says a stack is there; CI's smoke
 * job (e2e.yml) runs it. It creates one calendar, `claude-search-live`, in
 * the first family, puts its probe events there and searches only that
 * calendar; the calendar and, by cascade, its events are deleted
 * afterwards, including any left over from an interrupted run.
 */

const HAS_STACK = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
// FAMILY_CODE promises a stack (e2e.yml sets it), so there a missing key fails
// in beforeAll rather than skipping the whole file green.
test.skip(!HAS_STACK && !process.env.FAMILY_CODE, "needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL for a running stack");
test.describe.configure({ mode: "serial" });

const CALENDAR_NAME = "claude-search-live";

/** Each title is found by exactly the query next to it, and by nothing else in the hostile list. */
const PROBES: Array<[title: string, query: string]> = [
  ["probe 50% off", "50%"],
  ["probe a*b", "a*b"],
  ["probe a_b", "a_b"],
  ["probe a\\b", "a\\b"],
  ["probe (x),y", "(x),y"],
  ["probe a b", "a b"],
  ["Termin Zahnärztin Müller", "Zahnärztin Müller"],
];
/** Look-alikes that an unescaped pattern would match. */
const DECOYS = ["probe 50x off", "probe axxb", "probe aab", "probe ab", "probe a+b", "Termin ZAHNARZTIN Muller"];
/** Queries that must find nothing: filter syntax and regex that would widen the match. */
const HOSTILE = [
  "x),id.not.is.null",
  "x),title.not.is.null,title.imatch.(",
  "nomatch*,title.not.is.null,title.ilike.*nomatch",
  ".*", "^", "$", "a|b", "[a-z]", "b+c", "***=a", "(?i)a",
];

let db: SearchDb;
let calendarId = "";

async function removeCalendars() {
  const { error } = await (db as any).from("calendars").delete().eq("name", CALENDAR_NAME);
  if (error) throw error;
}

test.beforeAll(async () => {
  db = createAdminClient();
  await removeCalendars();
  const { data: family, error: familyError } = await (db as any).from("families").select("id").limit(1).single();
  if (familyError) throw familyError;
  const { data: calendar, error } = await (db as any)
    .from("calendars").insert({ family_id: family.id, name: CALENDAR_NAME }).select("id").single();
  if (error) throw error;
  calendarId = calendar.id;
  const rows = [...PROBES.map(([title]) => title), ...DECOYS].map((title) => ({
    calendar_id: calendarId, title, start_at: "2026-11-02T09:00:00Z", end_at: "2026-11-02T10:00:00Z",
  }));
  const { error: insertError } = await (db as any).from("events").insert(rows);
  if (insertError) throw insertError;
});

test.afterAll(async () => {
  if (db) await removeCalendars();
});

const START = new Date("2026-11-01T00:00:00Z");
const END = new Date("2026-11-03T00:00:00Z");
const titles = async (query: string) =>
  (await searchEvents(db, [calendarId], query, START, END)).map((e) => e.title as string).sort();

test("each literal query finds exactly its own event, not the look-alikes", async () => {
  for (const [title, query] of PROBES) {
    expect(await titles(query), query).toEqual([title]);
  }
});

test("case is ignored, for non-ASCII letters too", async () => {
  expect(await titles("zahnÄRZTIN müller")).toEqual(["Termin Zahnärztin Müller"]);
});

test("filter syntax and regex find nothing", async () => {
  for (const query of HOSTILE) {
    expect(await titles(query), query).toEqual([]);
  }
});

test("the probes and decoys are really there", async () => {
  expect(await titles("probe")).toHaveLength(PROBES.length - 1 + DECOYS.length - 1);
});
