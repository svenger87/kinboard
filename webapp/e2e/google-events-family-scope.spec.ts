import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadOwnedCalendar, loadOwnedEvent } from "../src/lib/google-events-scope";

/**
 * /api/google/events authenticates with requireSession + familyMatchesSession
 * on the family_id in the request, but event_id and calendar_id are also
 * request-supplied, and events carry no family_id of their own — they're
 * scoped through calendar_id -> calendars.family_id. The route used to look
 * both up by id alone, with no check that the calendar belonged to the
 * caller's family. A joined device of family A that knew (or guessed) an
 * event_id or calendar_id belonging to family B could make POST write B's
 * local events.google_event_id, and PATCH/DELETE would read B's
 * google_event_id/google_calendar_id and act on them — pointing A's own
 * Google credentials at B's calendar, and in any case corrupting B's local
 * row via POST's write-back, which needs no Google-side permission at all.
 *
 * Neither existing scanner catches this shape. family-scope.spec.ts's walk
 * only looks at dynamic routes (paths containing "["), and
 * /api/google/events/route.ts is static. api-route-auth.spec.ts's
 * "checks it against the session" test only requires that the route's own
 * family_id gets compared with familyMatchesSession — which this route
 * already did; the gap was a *second* id (event_id, calendar_id) read from
 * the same request and never checked against anything.
 *
 * This is a focused spec rather than an extension of either scanner: the
 * fix is a one-hop ownership check (same shape as pocket_money_goals ->
 * account_id in src/lib/family-scope.ts, and as
 * caldav/events/route.ts's loadCalendar), pulled into
 * src/lib/google-events-scope.ts so it can be tested directly instead of by
 * pattern-matching the route's source.
 */

// --- a stand-in for the supabase client, recording what it was asked ---
function fakeClient(rows: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const api = {
    calls,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      calls.push({ table, filters });
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          const match = (rows[table] ?? []).find((row) =>
            Object.entries(filters).every(([k, v]) => row[k] === v),
          );
          return { data: match ?? null };
        },
      };
      return chain;
    },
  };
  return api;
}

const OURS = "family-a";
const THEIRS = "family-b";

const DATA = {
  calendars: [
    { id: "cal-ours", family_id: OURS, google_calendar_id: "g-cal-ours" },
    { id: "cal-theirs", family_id: THEIRS, google_calendar_id: "g-cal-theirs" },
    { id: "cal-unlinked", family_id: OURS, google_calendar_id: null },
  ],
  events: [
    { id: "evt-ours", calendar_id: "cal-ours", google_event_id: "g-evt-ours" },
    { id: "evt-theirs", calendar_id: "cal-theirs", google_event_id: "g-evt-theirs" },
    { id: "evt-unlinked", calendar_id: "cal-ours", google_event_id: null },
  ],
};

test.describe("loadOwnedCalendar", () => {
  test("accepts our calendar and rejects another family's", async () => {
    const db = fakeClient(DATA);
    expect(await loadOwnedCalendar(db, OURS, "cal-ours")).toMatchObject({
      google_calendar_id: "g-cal-ours",
    });
    expect(await loadOwnedCalendar(db, OURS, "cal-theirs")).toBeNull();
  });

  test("a missing calendar is indistinguishable from a foreign one", async () => {
    const db = fakeClient(DATA);
    const missing = await loadOwnedCalendar(db, OURS, "does-not-exist");
    const foreign = await loadOwnedCalendar(db, OURS, "cal-theirs");
    expect(missing).toBeNull();
    expect(foreign).toBeNull();
  });

  test("it actually filters on family_id, not just on id", async () => {
    const db = fakeClient(DATA);
    await loadOwnedCalendar(db, OURS, "cal-ours");
    const call = db.calls.find((c) => c.table === "calendars");
    expect(call?.filters).toMatchObject({ id: "cal-ours", family_id: OURS });
  });

  test("empty ids are rejected rather than matching everything", async () => {
    const db = fakeClient(DATA);
    expect(await loadOwnedCalendar(db, OURS, "")).toBeNull();
    expect(await loadOwnedCalendar(db, "", "cal-ours")).toBeNull();
  });
});

test.describe("loadOwnedEvent", () => {
  test("accepts our event and rejects another family's, one hop through its calendar", async () => {
    const db = fakeClient(DATA);
    expect(await loadOwnedEvent(db, OURS, "evt-ours")).toMatchObject({
      google_event_id: "g-evt-ours",
      google_calendar_id: "g-cal-ours",
    });
    // evt-theirs exists — it just hangs off family B's calendar.
    expect(await loadOwnedEvent(db, OURS, "evt-theirs")).toBeNull();
  });

  test("a missing event is indistinguishable from a foreign one", async () => {
    const db = fakeClient(DATA);
    const missing = await loadOwnedEvent(db, OURS, "does-not-exist");
    const foreign = await loadOwnedEvent(db, OURS, "evt-theirs");
    expect(missing).toBeNull();
    expect(foreign).toBeNull();
  });

  test("an unlinked event resolves, so callers can still say 'not linked' rather than 'not found'", async () => {
    const db = fakeClient(DATA);
    const owned = await loadOwnedEvent(db, OURS, "evt-unlinked");
    expect(owned).toMatchObject({ google_event_id: null });
  });

  test("empty ids are rejected rather than matching everything", async () => {
    const db = fakeClient(DATA);
    expect(await loadOwnedEvent(db, OURS, "")).toBeNull();
    expect(await loadOwnedEvent(db, "", "evt-ours")).toBeNull();
  });
});

// A cheap regression guard: the route must actually call these helpers for
// every id it takes from the request, not just import them. Reverting any
// one call site to a plain `.from("events")`/`.from("calendars")` lookup
// would leave the import unused but the bug back — this at least pins the
// call sites down.
test("the route resolves every request-supplied id through the ownership helpers", () => {
  const source = readFileSync(
    join(__dirname, "..", "src", "app", "api", "google", "events", "route.ts"),
    "utf8",
  );

  expect(source).toContain('import { loadOwnedCalendar, loadOwnedEvent } from "@/lib/google-events-scope"');

  // POST creates on a calendar_id, and writes back onto an event_id.
  expect(source).toContain("loadOwnedCalendar(supabase, family_id, calendar_id)");
  expect(source).toContain("loadOwnedEvent(supabase, family_id, event_id)");

  // PATCH and DELETE both read an event_id. Both call sites must resolve
  // through the helper — count them rather than trusting one occurrence.
  const eventLookups = source.split("loadOwnedEvent(supabase, family_id, event_id)").length - 1;
  expect(eventLookups).toBeGreaterThanOrEqual(3); // POST's write-back, PATCH, DELETE

  // The only remaining raw `.eq("id", event_id)` is POST's write-back
  // *update*, which the line above proves runs behind a prior
  // loadOwnedEvent(...) ownership check in the same handler — it is not a
  // second, unguarded lookup. Pin that down directly: the write-back must
  // be inside the `if (owned)` branch that check returns.
  const writeBack = source.slice(source.indexOf("Update local event with google_event_id"));
  expect(writeBack.indexOf("loadOwnedEvent(supabase, family_id, event_id)")).toBeLessThan(
    writeBack.indexOf('.eq("id", event_id)'),
  );
  expect(writeBack.slice(0, writeBack.indexOf('.eq("id", event_id)'))).toContain("if (owned)");
});
