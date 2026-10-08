import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { createListTask, createListTasks, MAX_BATCH_TASKS, type TaskDb } from "../src/lib/integration-tasks";
import { evaluateToken, hashIntegrationToken, requireIntegrationAuth } from "../src/lib/integration-auth";
import { POST as batchRoute } from "../src/app/api/integration/v1/tasks/batch/route";
import { codeOnly } from "./source-helpers";

/**
 * POST /api/integration/v1/tasks/batch (`create_tasks`, a routine): several
 * tasks, all or none. The fake database behaves as PostgreSQL does for one
 * INSERT statement: a list of rows is kept whole or not at all, and a row
 * can be poisoned to fail there, as a trigger or constraint would. Inserting
 * the tasks one by one would keep the rows before the poisoned one, which is
 * exactly what these tests catch.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const MIRA = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const JONAS = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002";
const BINNED = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003";
const KIM = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001";

type Row = Record<string, unknown>;

function fakeDb(opts: { poison?: (row: Row) => boolean } = {}) {
  const tables: Record<string, Row[]> = {
    people: [
      { id: MIRA, family_id: OURS, deleted_at: null },
      { id: JONAS, family_id: OURS, deleted_at: null },
      { id: BINNED, family_id: OURS, deleted_at: "2026-09-30T10:00:00Z" },
      { id: KIM, family_id: THEIRS, deleted_at: null },
    ],
    todos: [],
  };
  let inserts = 0;
  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: [string, unknown][] = [];
      const chain = {
        select() { return chain; },
        eq(c: string, v: unknown) { filters.push([c, v]); return chain; },
        is(c: string, v: unknown) { filters.push([c, v]); return chain; },
        async maybeSingle() {
          return { data: rows.find((r) => filters.every(([c, v]) => (r[c] ?? null) === v)) ?? null, error: null };
        },
        insert(input: Row | Row[], options?: { defaultToNull?: boolean }) {
          inserts++;
          // PostgREST, given several rows, sends the union of their keys and
          // writes NULL where a row has none -- not the column default --
          // unless told defaultToNull: false.
          const keys = Array.isArray(input) ? [...new Set(input.flatMap((r) => Object.keys(r)))] : [];
          const list = (Array.isArray(input) ? input : [input]).map((r) =>
            Array.isArray(input) && options?.defaultToNull !== false
              ? Object.fromEntries(keys.map((k) => [k, k in r ? r[k] : null]))
              : r);
          const failed = list.find((r) => opts.poison?.(r));
          const stored = failed ? [] : list.map((r, i) => ({ id: `todo-${rows.length + i + 1}`, ...r }));
          // One statement: all rows or none.
          if (!failed) rows.push(...stored);
          const answer = failed
            ? { data: null, error: { message: "new row violates check constraint", code: "23514" } }
            : { data: stored.map((r) => ({ id: r.id })), error: null };
          return {
            select: () => ({
              single: async () => ({ ...answer, data: answer.data?.[0] ?? null }),
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(answer).then(resolve),
            }),
          };
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as TaskDb, tables, inserts: () => inserts };
}

const routine = [
  { summary: "Get dressed", person_id: MIRA, recurrence: "daily", icon: "👕", points: 2 },
  { summary: "Brush teeth", person_id: MIRA, recurrence: "daily", icon: "🪥", points: 1, priority: "high" },
  { summary: "Pack school bag", person_id: MIRA, recurrence: "days:MO,TU,WE,TH,FR", points: 3 },
  { summary: "Feed the cat", rotation_person_ids: [MIRA, JONAS], recurrence: "daily", track_completion: true },
];

test.describe("all or nothing", () => {
  test("creates every task in one insert, ids in the order sent, rows as one create would write them", async () => {
    const { db, tables, inserts } = fakeDb();
    const result = await createListTasks(db, OURS, { tasks: routine });
    expect(result.status).toBe(201);
    const created = result.response.created as { id: string; summary: string; status: string; due: string | null }[];
    expect(created.map((t) => t.summary)).toEqual(routine.map((t) => t.summary));
    expect(created.map((t) => t.id)).toEqual(tables.todos.map((r) => r.id));
    expect(created.every((t) => t.status === "needs_action" && t.due === null)).toBe(true);
    expect(inserts()).toBe(1);

    // Each row is exactly what POST /lists/tasks would have written: no
    // column a task did not send is written as NULL over its default.
    for (const [i, body] of routine.entries()) {
      const single = fakeDb();
      await createListTask(single.db, OURS, body);
      const { id: _a, ...one } = single.tables.todos[0];
      const { id: _b, ...batch } = tables.todos[i];
      expect(batch, body.summary).toEqual(one);
    }
  });

  test("a failure partway in the database keeps none of the tasks, and says so by throwing", async () => {
    // The third row fails where only the database can refuse it.
    const { db, tables, inserts } = fakeDb({ poison: (row) => row.title === "Pack school bag" });
    await expect(createListTasks(db, OURS, { tasks: routine })).rejects.toBeTruthy();
    expect(tables.todos).toEqual([]);
    expect(inserts()).toBe(1);
  });

  test("a task refused by the checks names its position and title, and nothing is written", async () => {
    const { db, tables, inserts } = fakeDb();
    const bad = [...routine.slice(0, 2), { ...routine[2], points: 20_000 }, routine[3]];
    const result = await createListTasks(db, OURS, { tasks: bad });
    expect(result.status).toBe(400);
    expect(result.response).toMatchObject({ code: "invalid_request", index: 2 });
    expect(result.response.error).toBe('task 3 ("Pack school bag"): `points` must be a whole number from 0 to 10000. Nothing was created.');
    expect(tables.todos).toEqual([]);
    expect(inserts()).toBe(0);
  });

  test("every per-task check is the single create's, each naming the task", async () => {
    const cases: [Row, RegExp][] = [
      [{ summary: "  " }, /^task 2: `summary` is required/],
      [{ summary: "Wash", recurrence: "sometimes" }, /^task 2 \("Wash"\): `recurrence` must be/],
      [{ summary: "Wash", priority: "urgent" }, /^task 2 \("Wash"\): `priority` must be high, medium or low/],
      [{ summary: "Wash", icon: "🇩🇪" }, /^task 2 \("Wash"\): `icon` must be a single emoji/],
      [{ summary: "Wash", due: "tomorrow" }, /^task 2 \("Wash"\): `due` must start with YYYY-MM-DD/],
      [{ summary: "Wash", rotation_person_ids: [MIRA] }, /^task 2 \("Wash"\): taking turns .* need a repeating task/],
      [{ summary: "Wash", recurrence: "daily", rotation_person_ids: [MIRA], person_id: JONAS }, /^task 2 \("Wash"\): send `person_id` or `rotation_person_ids`, not both/],
      [{ summary: "Wash", person_id: "Mira" }, /^task 2 \("Wash"\): `person_id` must be a uuid or null/],
      ["just a string" as unknown as Row, /^task 2: must be an object/],
    ];
    for (const [task, message] of cases) {
      const { db, tables } = fakeDb();
      const result = await createListTasks(db, OURS, { tasks: [routine[0], task] });
      expect(result.status, String(message)).toBe(400);
      expect(result.response.error, String(message)).toMatch(message);
      expect(result.response.error).toMatch(/Nothing was created\.$/);
      expect(tables.todos).toEqual([]);
    }
  });

  test("between 1 and 15 tasks", async () => {
    const { db } = fakeDb();
    for (const tasks of [undefined, [], "x", Array.from({ length: MAX_BATCH_TASKS + 1 }, (_, i) => ({ summary: `T${i}` }))]) {
      const result = await createListTasks(db, OURS, { tasks });
      expect(result.status).toBe(400);
    }
    const fifteen = await createListTasks(fakeDb().db, OURS, { tasks: Array.from({ length: MAX_BATCH_TASKS }, (_, i) => ({ summary: `T${i}` })) });
    expect(fifteen.status).toBe(201);
    expect(MAX_BATCH_TASKS).toBe(15);
  });
});

test.describe("family scoping", () => {
  test("a person of another family, or one in the recycle bin, refuses the whole batch", async () => {
    for (const [field, value] of [["person_id", KIM], ["person_id", BINNED], ["rotation_person_ids", [MIRA, KIM]]] as const) {
      const { db, tables } = fakeDb();
      const task = { summary: "Tidy up", recurrence: "daily", [field]: value };
      const result = await createListTasks(db, OURS, { tasks: [routine[0], task] });
      expect(result.status, `${field}=${String(value)}`).toBe(400);
      expect(result.response.error).toContain("no such person in this family");
      expect(tables.todos).toEqual([]);
    }
  });

  test("every row is written for the token's family, whatever the body says", async () => {
    const { db, tables } = fakeDb();
    await createListTasks(db, OURS, { tasks: [{ summary: "Sneaky", family_id: THEIRS }, routine[0]], family_id: THEIRS });
    expect(tables.todos.map((r) => r.family_id)).toEqual([OURS, OURS]);
  });
});

test.describe("the route", () => {
  const src = () => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "tasks", "batch", "route.ts"), "utf8"));

  test("no token is a 401 before anything is read", async () => {
    const res = await batchRoute(new NextRequest("https://kb.example.com/api/integration/v1/tasks/batch", {
      method: "POST", body: JSON.stringify({ tasks: routine }), headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(401);
  });

  test("tasks:write is required, as for one task; family:read alone is refused", async () => {
    const request = new NextRequest("https://kb.example.com/api/integration/v1/tasks/batch", {
      method: "POST", headers: { authorization: "Bearer kbi_example" },
    });
    const row = (scopes: string[]) => async () => ({
      id: "tok-1", family_id: "fam-1", name: "ChatGPT", scopes,
      token_hash: hashIntegrationToken("kbi_example"), expires_at: null, revoked_at: null,
      last_used_at: null, oauth_client_id: "client-1",
    }) as Parameters<typeof evaluateToken>[0];
    for (const scopes of [[], ["family:read"], ["calendar:write", "shopping:write"]]) {
      expect((await requireIntegrationAuth(request, "tasks:write", row(scopes))).ok, scopes.join(",")).toBe(false);
    }
    expect((await requireIntegrationAuth(request, "tasks:write", row(["tasks:write"]))).ok).toBe(true);
    expect(src()).toContain('withIntegrationAuth(request, "tasks:write"');
    expect(src().match(/withIntegrationAuth\(/g)).toHaveLength(1);
  });

  test("the key is reserved before anything runs (withIdempotency); only a 201 is remembered", () => {
    const s = src();
    expect(s).toContain('validateIdempotencyKey(request.headers.get("idempotency-key"))');
    expect(s).toContain("withIdempotency(");
    expect(s).toContain("remember: (r) => r.status === 201");
    expect(s).toContain("markExecuting");
    expect(s).not.toMatch(/findStoredResult|storeResult/);
    expect(s).toContain("context.familyId");
    expect(s).not.toMatch(/body\.family_id/);
  });

  test("the insert is the only thing after the point of no return: a refusal never reaches it", async () => {
    const marks: string[] = [];
    const ok = fakeDb();
    await createListTasks(ok.db, OURS, { tasks: routine }, () => marks.push(`before insert ${ok.inserts()}`));
    expect(marks).toEqual(["before insert 0"]);
    const refused = fakeDb();
    marks.length = 0;
    await createListTasks(refused.db, OURS, { tasks: [routine[0], { summary: "X", person_id: KIM }] }, () => marks.push("before insert"));
    expect(marks).toEqual([]);
  });
});
