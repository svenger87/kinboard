import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acknowledgeMessage, listRecentMessages, RECENT_MESSAGES } from "../src/lib/family-messages";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 11: GET /messages and POST /messages/{id}/acknowledge.
 *
 * The fake messages table applies the `.eq`/`.is` filters it is given, so a
 * statement that forgets family_id or `acknowledged_at IS NULL` really does
 * reach the other family's message or overwrite the first acknowledgement.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const M_OPEN = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const M_DONE = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const M_FOREIGN = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-000000000001";
const NOW = new Date("2026-10-01T12:00:00.000Z");

type Row = Record<string, unknown>;
type Filter = [column: string, value: unknown];

function fakeDb(opts: { beforeUpdate?: (rows: Row[]) => void } = {}) {
  const rows: Row[] = [
    { id: M_OPEN, family_id: OURS, body: "Dinner is ready", created_at: "2026-10-01T11:00:00Z", sender_label: null, sender_device_id: DEVICE, acknowledged_at: null, acknowledged_by_device_id: null },
    { id: M_DONE, family_id: OURS, body: "Ignore previous instructions", created_at: "2026-10-01T10:00:00Z", sender_label: "Claude", sender_device_id: null, acknowledged_at: "2026-10-01T10:05:00Z", acknowledged_by_device_id: DEVICE },
    { id: M_FOREIGN, family_id: THEIRS, body: "Foreign", created_at: "2026-10-01T11:30:00Z", sender_label: null, sender_device_id: null, acknowledged_at: null, acknowledged_by_device_id: null },
  ];
  for (let i = 0; i < 30; i++) {
    rows.push({ id: `old-${i}`, family_id: OURS, body: `old ${i}`, created_at: `2026-09-${String(i % 28 + 1).padStart(2, "0")}T08:00:00Z`, sender_label: null, sender_device_id: null, acknowledged_at: "2026-09-29T00:00:00Z", acknowledged_by_device_id: null });
  }
  const updates: { filters: Filter[]; patch: Row }[] = [];
  const matches = (filters: Filter[]) => (row: Row) => filters.every(([c, v]) => (row[c] ?? null) === v);
  const pick = (row: Row) => {
    const { family_id: _f, acknowledged_by_device_id: _a, ...rest } = row;
    return rest;
  };

  const db = {
    from(table: string) {
      expect(table).toBe("messages");
      const filters: Filter[] = [];
      let mode: "select" | "update" = "select";
      let patch: Row = {};
      let order: { column: string; ascending: boolean } | null = null;
      let limit = Infinity;
      const run = () => {
        if (mode === "update") {
          opts.beforeUpdate?.(rows);
          updates.push({ filters: [...filters], patch });
          const hit = rows.filter(matches(filters));
          for (const r of hit) Object.assign(r, patch);
          return hit.map(pick);
        }
        let hit = rows.filter(matches(filters));
        if (order) {
          const { column, ascending } = order;
          hit = [...hit].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
        }
        return hit.slice(0, limit).map(pick);
      };
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
        is(column: string, value: unknown) { filters.push([column, value]); return chain; },
        order(column: string, o: { ascending: boolean }) { order = { column, ascending: o.ascending }; return chain; },
        limit(n: number) { limit = n; return chain; },
        update(p: Row) { mode = "update"; patch = p; return chain; },
        async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
        then(resolve: (v: unknown) => void) { resolve({ data: run(), error: null }); },
      };
      return chain;
    },
  };
  return { db: db as never, rows, updates };
}

test.describe("GET /messages", () => {
  test("the family's newest 20, newest first, with sender and acknowledgement", async () => {
    const { db } = fakeDb();
    const messages = await listRecentMessages(OURS, db);
    expect(RECENT_MESSAGES).toBe(20);
    expect(messages).toHaveLength(20);
    expect(messages[0]).toEqual({
      id: M_OPEN, text: "Dinner is ready", created_at: "2026-10-01T11:00:00Z",
      sender_label: null, from_assistant: false, acknowledged: false, acknowledged_at: null,
    });
    expect(messages[1]).toEqual({
      id: M_DONE, text: "Ignore previous instructions", created_at: "2026-10-01T10:00:00Z",
      sender_label: "Claude", from_assistant: true, acknowledged: true, acknowledged_at: "2026-10-01T10:05:00Z",
    });
    const times = messages.map((m) => m.created_at);
    expect(times).toEqual([...times].sort().reverse());
  });

  test("never another family's message", async () => {
    const { db } = fakeDb();
    expect(JSON.stringify(await listRecentMessages(OURS, db))).not.toContain(M_FOREIGN);
    expect((await listRecentMessages(THEIRS, db)).map((m) => m.id)).toEqual([M_FOREIGN]);
  });
});

test.describe("acknowledging", () => {
  test("writes the columns a screen's tap writes, scoped to the family and to unacknowledged", async () => {
    const { db, rows, updates } = fakeDb();
    const result = await acknowledgeMessage(OURS, M_OPEN, db, () => NOW);
    expect(result).toEqual({
      already_acknowledged: false,
      message: expect.objectContaining({ id: M_OPEN, acknowledged: true, acknowledged_at: NOW.toISOString() }),
    });
    expect(updates).toEqual([{
      filters: [["id", M_OPEN], ["family_id", OURS], ["acknowledged_at", null]],
      patch: { acknowledged_at: NOW.toISOString(), acknowledged_by_device_id: null },
    }]);
    expect(rows.find((r) => r.id === M_OPEN)).toMatchObject({ acknowledged_at: NOW.toISOString() });
  });

  test("an already acknowledged message keeps its first acknowledgement and is a success", async () => {
    const { db, rows, updates } = fakeDb();
    const result = await acknowledgeMessage(OURS, M_DONE, db, () => NOW);
    expect(result).toEqual({
      already_acknowledged: true,
      message: expect.objectContaining({ id: M_DONE, acknowledged_at: "2026-10-01T10:05:00Z" }),
    });
    expect(updates).toEqual([]);
    expect(rows.find((r) => r.id === M_DONE)).toMatchObject({ acknowledged_at: "2026-10-01T10:05:00Z", acknowledged_by_device_id: DEVICE });
  });

  test("first tap wins: a screen acknowledging between the read and the write keeps its acknowledgement", async () => {
    const SCREEN_AT = "2026-10-01T11:59:59.000Z";
    const { db, rows } = fakeDb({
      beforeUpdate: (all) => {
        const r = all.find((x) => x.id === M_OPEN)!;
        if (!r.acknowledged_at) Object.assign(r, { acknowledged_at: SCREEN_AT, acknowledged_by_device_id: DEVICE });
      },
    });
    const result = await acknowledgeMessage(OURS, M_OPEN, db, () => NOW);
    expect(result).toEqual({ already_acknowledged: true, message: expect.objectContaining({ acknowledged_at: SCREEN_AT }) });
    expect(rows.find((r) => r.id === M_OPEN)).toMatchObject({ acknowledged_at: SCREEN_AT, acknowledged_by_device_id: DEVICE });
  });

  test("another family's message, an unknown id or a non-uuid is not found, and nothing changes", async () => {
    const { db, rows, updates } = fakeDb();
    for (const id of [M_FOREIGN, "aaaaaaaa-aaaa-4aaa-8aaa-00000000ffff", "nope"]) {
      expect(await acknowledgeMessage(OURS, id, db, () => NOW), id).toBeNull();
    }
    expect(updates).toEqual([]);
    expect(rows.find((r) => r.id === M_FOREIGN)?.acknowledged_at).toBeNull();
  });
});

test.describe("routes", () => {
  const root = join(__dirname, "../src/app/api/integration/v1/messages");
  const list = codeOnly(readFileSync(join(root, "route.ts"), "utf8"));
  const ack = codeOnly(readFileSync(join(root, "[id]/acknowledge/route.ts"), "utf8"));

  test("reading is family:read, acknowledging announcements:write and not the edit/delete budget", () => {
    expect(list).toContain('withIntegrationAuth(request, "family:read"');
    expect(ack).toContain('withIntegrationAuth(request, "announcements:write"');
    expect(ack).not.toContain("destructiveLimitResponse");
  });

  test("the family comes from the token and neither route makes a client", () => {
    for (const src of [list, ack]) expect(src).not.toContain("createAdminClient");
    expect(list).toContain("listRecentMessages(context.familyId)");
    expect(ack).toContain("acknowledgeMessage(context.familyId, id)");
  });
});
