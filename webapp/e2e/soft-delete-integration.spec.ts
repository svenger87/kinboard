import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dbContainer } from "./whole-database";

/**
 * The double-DELETE guard, against a real database.
 *
 * Tasks, notes and meal entries soft-delete: a BEFORE DELETE trigger stamps
 * `deleted_at` and cancels the delete (`migration_zzz_soft_delete.sql`). But
 * the trigger lets a DELETE through once `deleted_at` is already set — that
 * is how the recycle bin purges — so an Integration API DELETE that forgot
 * `.is("deleted_at", null)` would purge a binned row on the second call.
 * Pure specs check the route source; only a database proves the row stays.
 *
 * For each kind: create it through the Integration API with a token made for
 * this test, delete it (ok, `deleted_at` set), delete it again (404, the row
 * still there). Needs a stack and FAMILY_CODE (CI: DEMO01). Everything is
 * removed in afterAll. Never prints the join code.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const FAMILY_CODE = process.env.FAMILY_CODE;
test.skip(!FAMILY_CODE, "needs FAMILY_CODE and a running stack");

const psql = (sql: string) =>
  execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], { encoding: "utf8" }).trim();

const TOKEN_NAME = `claude-softdelete-${Date.now()}`;
let tokenId: string | null = null;
let familyId: string | null = null;
let mealPlansBefore: string[] = [];
const created = { todos: [] as string[], notes: [] as string[], meal_plan_entries: [] as string[] };
const keys: string[] = [];
let api: APIRequestContext;

test.beforeAll(async () => {
  familyId = psql(`SELECT id FROM families WHERE join_code = '${FAMILY_CODE!.replace(/'/g, "''")}'`);
  expect(familyId, "the FAMILY_CODE family exists").toMatch(/^[0-9a-f-]{36}$/);
  mealPlansBefore = psql(`SELECT id FROM meal_plans WHERE family_id = '${familyId}'`).split("\n").filter(Boolean);

  // A plain integration token (not an assistant connection), as Settings would mint one.
  const token = `kbi_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(token).digest("hex");
  tokenId = psql(
    `INSERT INTO integration_tokens (family_id, name, token_hash, scopes) VALUES ('${familyId}', '${TOKEN_NAME}', '${hash}', ` +
      `ARRAY['family:read','tasks:write','notes:write','meals:write']) RETURNING id`,
  ).split("\n")[0];
  api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
});

test.afterAll(async () => {
  await api?.dispose();
  // A row already binned is purged by a plain DELETE (that is the trigger's
  // rule); one that is not gets binned by the first and purged by the second.
  for (const [table, ids] of Object.entries(created)) {
    if (ids.length === 0) continue;
    const list = ids.map((id) => `'${id}'`).join(",");
    psql(`DELETE FROM ${table} WHERE id IN (${list})`);
    psql(`DELETE FROM ${table} WHERE id IN (${list})`);
  }
  if (familyId) {
    const keep = mealPlansBefore.map((id) => `'${id}'`).join(",");
    psql(
      `DELETE FROM meal_plans WHERE family_id = '${familyId}'` +
        (keep ? ` AND id NOT IN (${keep})` : "") +
        ` AND NOT EXISTS (SELECT 1 FROM meal_plan_entries e WHERE e.meal_plan_id = meal_plans.id)`,
    );
  }
  if (tokenId) {
    if (keys.length) {
      psql(`DELETE FROM integration_idempotency WHERE family_id = '${familyId}' AND idempotency_key IN (${keys.map((k) => `'${k}'`).join(",")})`);
    }
    psql(`DELETE FROM integration_tokens WHERE id = '${tokenId}'`);
  }
});

function post(path: string, data: unknown) {
  const key = randomUUID();
  keys.push(key);
  return api.post(`/api/integration/v1${path}`, { data, headers: { "idempotency-key": key } });
}

async function deleteTwice(path: string, table: "todos" | "notes" | "meal_plan_entries", id: string) {
  const first = await api.delete(`/api/integration/v1${path}`);
  expect(first.status(), `${table} first delete: ${await first.text()}`).toBe(200);
  expect(await first.json()).toMatchObject({ ok: true });
  expect(psql(`SELECT deleted_at IS NOT NULL FROM ${table} WHERE id = '${id}'`), `${table} binned`).toBe("t");

  const second = await api.delete(`/api/integration/v1${path}`);
  expect(second.status(), `${table} second delete`).toBe(404);
  // Still there, still binned — restorable from the recycle bin.
  expect(psql(`SELECT count(*) FROM ${table} WHERE id = '${id}' AND deleted_at IS NOT NULL`), `${table} row survives`).toBe("1");
}

test("a task deleted twice is binned once and never purged", async () => {
  const res = await post("/lists/tasks", { summary: "claude soft-delete task" });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).id as string;
  created.todos.push(id);
  await deleteTwice(`/lists/tasks/${id}`, "todos", id);
});

test("a note deleted twice is binned once and never purged", async () => {
  const res = await post("/services/create_note", { text: "claude soft-delete note" });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).id as string;
  created.notes.push(id);
  await deleteTwice(`/notes/${id}`, "notes", id);
});

test("a meal entry deleted twice is binned once and never purged", async () => {
  const res = await post("/meals", { date: "2030-01-07", meal_type: "dinner", note: "claude soft-delete meal" });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).entry.id as string;
  created.meal_plan_entries.push(id);
  await deleteTwice(`/meals/${id}`, "meal_plan_entries", id);
});
