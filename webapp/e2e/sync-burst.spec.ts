import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { eventRowChanged, syncedColumns } from "../src/lib/event-sync-write";
import { invalidationBatch } from "../src/lib/realtime/invalidation-batch";
import { withReadTimeout } from "../src/lib/supabase/client";

/**
 * Production, 3 Nov 2026: the kitchen display sat on "loading". Every 15
 * minutes the Google sync rewrote all 362 events, each rewrite became a change
 * event on every open screen, and each event refetched the calendar lists —
 * cancelling the refetch already under way. One sync, one Home screen: 1,494
 * requests in twenty seconds, 1,460 of them for the calendar.
 */

test.describe("a sync writes only what changed", () => {
  const row = {
    calendar_id: "c1",
    google_event_id: "g1",
    title: "Swimming",
    description: null,
    location: undefined,
    start_at: "2026-11-03T08:00:00.000Z",
    end_at: "2026-11-03T09:00:00.000Z",
    all_day: false,
    person_id: "p1",
    updated_at: "2026-11-03T10:15:00.000Z",
  };
  // What PostgREST hands back for the same event.
  const stored = {
    id: "e1",
    calendar_id: "c1",
    google_event_id: "g1",
    title: "Swimming",
    description: null,
    location: null,
    start_at: "2026-11-03T08:00:00+00:00",
    end_at: "2026-11-03T09:00:00+00:00",
    all_day: false,
    person_id: "p1",
    updated_at: "2026-11-03T10:00:00+00:00",
  };

  test("the same event, as Postgres stores it, is not a change; updated_at never is", () => {
    expect(eventRowChanged(stored, row)).toBe(false);
  });

  test("any field the event carries is", () => {
    expect(eventRowChanged(stored, { ...row, title: "Swimming!" })).toBe(true);
    expect(eventRowChanged(stored, { ...row, start_at: "2026-11-03T08:30:00.000Z" })).toBe(true);
    expect(eventRowChanged(stored, { ...row, location: "Pool" })).toBe(true);
    expect(eventRowChanged(stored, { ...row, person_id: null })).toBe(true);
    expect(eventRowChanged(stored, { ...row, all_day: true })).toBe(true);
  });

  test("the comparison reads back every column the sync writes, and no more", () => {
    expect(syncedColumns(row)).toBe("id, calendar_id, google_event_id, title, description, location, start_at, end_at, all_day, person_id");
  });

  test("all four syncs compare before they write", () => {
    for (const f of [
      "src/app/api/cron/google-sync/route.ts",
      "src/app/api/google/sync/route.ts",
      "src/lib/ics-sync.ts",
      "src/lib/caldav-sync.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain(".select(syncedColumns(eventData))");
      expect(src, f).toMatch(/if \(existing && !eventRowChanged\(existing, eventData\)\)/);
    }
  });
});

test.describe("a burst of change events is one refetch per list", () => {
  function fakeClient() {
    const calls: { key: string; cancelRefetch: unknown }[] = [];
    const client = {
      invalidateQueries: (filters: { queryKey?: unknown[]; predicate?: unknown }, options?: { cancelRefetch?: boolean }) => {
        calls.push({ key: filters.predicate ? "predicate" : JSON.stringify(filters.queryKey), cancelRefetch: options?.cancelRefetch });
        return Promise.resolve();
      },
    };
    return { client: client as never, calls };
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("362 events for the calendar become one invalidation per key, none cancelling a refetch", async () => {
    const { client, calls } = fakeClient();
    const batch = invalidationBatch(client, { delayMs: 50, maxWaitMs: 500 });
    for (let i = 0; i < 362; i++) {
      batch.invalidateQueries({ queryKey: ["events", "fam"] });
      batch.invalidateQueries({ queryKey: ["calendars", "fam"] });
    }
    expect(calls).toEqual([]);
    await wait(120);
    expect(calls.map((c) => c.key).sort()).toEqual(['["calendars","fam"]', '["events","fam"]']);
    expect(calls.every((c) => c.cancelRefetch === false)).toBe(true);
  });

  test("a steady stream still goes out after maxWaitMs", async () => {
    const { client, calls } = fakeClient();
    const batch = invalidationBatch(client, { delayMs: 60, maxWaitMs: 200 });
    const start = Date.now();
    while (Date.now() - start < 350) {
      batch.invalidateQueries({ queryKey: ["todos", "fam"] });
      await wait(20);
    }
    expect(calls.length).toBeGreaterThanOrEqual(1);
    batch.dispose();
  });

  test("a resync (predicate) goes out at once, after what was waiting", () => {
    const { client, calls } = fakeClient();
    const batch = invalidationBatch(client, { delayMs: 1000 });
    batch.invalidateQueries({ queryKey: ["notes", "fam"] });
    batch.invalidateQueries({ predicate: () => true });
    expect(calls.map((c) => c.key)).toEqual(['["notes","fam"]', "predicate"]);
  });

  test("the hook invalidates through the batch only", () => {
    const src = readFileSync("src/hooks/use-realtime.ts", "utf8");
    expect(src).not.toContain("queryClient.invalidateQueries(");
    expect(src).toContain("invalidationBatch(queryClient)");
    expect(src).toContain("invalidatePocketMoney(batch)");
  });
});

test.describe("a read cannot hang a widget", () => {
  test("GET and HEAD get a timeout, combined with the caller's own signal", () => {
    expect(withReadTimeout(undefined)?.signal).toBeInstanceOf(AbortSignal);
    const own = new AbortController();
    const merged = withReadTimeout({ signal: own.signal })!.signal!;
    expect(merged).not.toBe(own.signal);
    own.abort();
    expect(merged.aborted).toBe(true);
  });

  test("writes are left alone: an abandoned write may still have landed", () => {
    for (const method of ["POST", "PATCH", "DELETE", "put"]) {
      const init = { method };
      expect(withReadTimeout(init)).toBe(init);
    }
  });
});
