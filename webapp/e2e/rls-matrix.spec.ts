import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The row-level-security matrix (RFC-024 §6.5, §10 step 6): two families,
 * and each one's token tried against the other's rows on EVERY table with
 * row-level security, through /rest/v1 as a browser sends it.
 *
 * Kinboard's isolation between families is plain PostgreSQL: a policy per
 * table, keyed on the family in the request's token, plus the role
 * attributes and grants the database image provides. On supabase/postgres
 * those come from the image; on stock PostgreSQL from the role bootstrap
 * (webapp/docker/stock-postgres-bootstrap.sql). A mistake there is silent,
 * so this runs against a live install and checks the outcome, not the SQL:
 *
 *   - family A's token reads none of family B's rows, on every table, and
 *     still reads its own rows wherever the browser may read at all (so a
 *     token that reads nothing can't pass);
 *   - A can't insert a copy of B's row, and its update and delete reach
 *     none of B's rows (the database's own count of the rows touched is 0,
 *     and every one of them is still there);
 *   - the bare anon role, no Authorization header, reads nothing from any
 *     table;
 *   - the service role, straight to PostgREST, counts exactly what a
 *     superuser's count(*) counts: it still sees every family;
 *   - an UPDATE and a DELETE without a filter are refused by the database
 *     (safeupdate), for a family token through /rest/v1 and for the service
 *     role straight to PostgREST, and no row changes.
 *
 * Off unless asked for: it creates two families and writes a row into every
 * table of each. scripts/rigs/test-stock-postgres.sh sets it up:
 *
 *   RLS_MATRIX_BASE_URL       the webapp (/api/session/create, /rest/v1)
 *   RLS_MATRIX_POSTGREST_URL  PostgREST itself, for the service role
 *   RLS_MATRIX_JWT_SECRET     to sign the service-role token
 *   KINBOARD_DB_CONTAINER     the database container, read as its superuser
 */

const BASE = process.env.RLS_MATRIX_BASE_URL?.replace(/\/+$/, "") ?? "";
const POSTGREST = process.env.RLS_MATRIX_POSTGREST_URL?.replace(/\/+$/, "") ?? "";
const JWT_SECRET = process.env.RLS_MATRIX_JWT_SECRET ?? "";
const DB = process.env.KINBOARD_DB_CONTAINER ?? "";
const DB_SUPERUSER = process.env.RLS_MATRIX_DB_SUPERUSER ?? "supabase_admin";
const ENABLED = Boolean(BASE && POSTGREST && JWT_SECRET && DB);

const SEED = join(__dirname, "fixtures", "rls-matrix-seed.sql");

/**
 * Tables whose rows belong to a family through a parent, not a family_id
 * column of their own. A new table with row-level security and neither is a
 * failure below, so it is decided here rather than skipped.
 */
const OWNED_THROUGH: Record<string, string> = {
  families: "t.id = $FAM",
  events: "t.calendar_id IN (SELECT id FROM public.calendars WHERE family_id = $FAM)",
  meal_plan_entries: "t.meal_plan_id IN (SELECT id FROM public.meal_plans WHERE family_id = $FAM)",
  pocket_money_goals: "t.account_id IN (SELECT id FROM public.pocket_money_accounts WHERE family_id = $FAM)",
  pocket_money_transactions: "t.account_id IN (SELECT id FROM public.pocket_money_accounts WHERE family_id = $FAM)",
  pocket_money_withdrawal_requests:
    "t.account_id IN (SELECT id FROM public.pocket_money_accounts WHERE family_id = $FAM)",
  recipe_ingredients: "t.recipe_id IN (SELECT id FROM public.recipes WHERE family_id = $FAM)",
  recipe_tag_assignments: "t.recipe_id IN (SELECT id FROM public.recipes WHERE family_id = $FAM)",
};
/** Instance-wide tables: no family owns a row; only the server reads them. */
const INSTANCE_WIDE = new Set(["instance_settings"]);
/**
 * Tables the browser must not read at all, its own family's rows included:
 * no grant to anon or authenticated (the REVOKEs in 005, 012, 020, 065 and
 * 093), so only the server's service role reaches them. Every other table with row-level
 * security must let a family read its own rows. Pinned here, not read from
 * the database under test, so a grant lost or gained there fails this spec
 * instead of redefining what it expects.
 */
const SERVER_ONLY = new Set(["bring_removals", "device_sessions", "instance_settings", "integration_secrets", "kept_images"]);

/** The table the filterless-write checks empty if the database lets them. */
const FILTERLESS_TABLE = "todos";

type Table = {
  name: string;
  pk: string[];
  hasFamilyId: boolean;
  /** columns PostgREST must not be sent on insert: generated, or a defaulted uuid key */
  skipOnInsert: string[];
  /** columns no UPDATE may set: generated, or identity */
  fixed: string[];
};

type Owned = { pk: unknown[]; row: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function psql(sql: string, vars: Record<string, string> = {}): string {
  const args = ["exec", "-i", DB, "psql", "-X", "-q", "-U", DB_SUPERUSER, "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("docker", args, { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function ownedBy(table: Table, family: string): string {
  if (!UUID.test(family)) throw new Error(`not a uuid: ${family}`);
  const fam = `'${family}'::uuid`;
  if (OWNED_THROUGH[table.name]) return OWNED_THROUGH[table.name].replaceAll("$FAM", fam);
  if (table.hasFamilyId) return `t.family_id = ${fam}`;
  throw new Error(`${table.name}: row-level security, but no family_id and no entry in OWNED_THROUGH`);
}

function ownedRows(table: Table, family: string): Owned[] {
  const pk = table.pk.map((c) => `t.${JSON.stringify(c)}`).join(", ");
  const out = psql(
    `SELECT coalesce(json_agg(json_build_object('pk', json_build_array(${pk}), 'row', to_jsonb(t))), '[]')
       FROM public.${JSON.stringify(table.name)} t WHERE ${ownedBy(table, family)};`,
  );
  return JSON.parse(out) as Owned[];
}

function superuserCount(table: string): number {
  return Number(psql(`SELECT count(*) FROM public.${JSON.stringify(table)};`));
}

function sign(payload: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${input}.${createHmac("sha256", JWT_SECRET).update(input).digest("base64url")}`;
}

function serviceToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return sign({ role: "service_role", iss: "kinboard", iat: now, exp: now + 3600 });
}

/** `col=eq.value` for each key column of one row. */
function pkFilter(table: Table, pk: unknown[]): string {
  return table.pk.map((c, i) => `${encodeURIComponent(c)}=eq.${encodeURIComponent(String(pk[i]))}`).join("&");
}

type Reply = { status: number; body: unknown; headers: Headers };

async function call(url: string, init: { method?: string; token?: string | null; body?: unknown; prefer?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; kept as text for the message.
  }
  return { status: res.status, body, headers: res.headers };
}

const rest = (path: string) => `${BASE}/rest/v1/${path}`;

test.describe("row-level security matrix over /rest/v1", () => {
  test.skip(!ENABLED, "set RLS_MATRIX_BASE_URL, RLS_MATRIX_POSTGREST_URL, RLS_MATRIX_JWT_SECRET and KINBOARD_DB_CONTAINER");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  const fam: Record<"A" | "B", { id: string; token: string }> = {} as never;
  let tables: Table[] = [];
  const before: Record<string, Owned[]> = {};

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const run = randomUUID().slice(0, 8);
    for (const key of ["A", "B"] as const) {
      const create = () => call(`${BASE}/api/session/create`, {
        method: "POST",
        body: { familyName: `RLS matrix ${key} ${run}`, hardwareId: `rls-matrix-${key}-${run}`, deviceName: `rls-matrix-${key}` },
      });
      let created = await create();
      // Five families a minute from one address is the production limit; an
      // install under test keeps it, so wait as a client would.
      for (let i = 0; created.status === 429 && i < 2; i++) {
        await new Promise((r) => setTimeout(r, (Number(created.headers.get("retry-after")) || 60) * 1000 + 500));
        created = await create();
      }
      const body = created.body as { family?: { id?: string }; token?: string };
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect(body.family?.id).toMatch(UUID);
      expect(body.token, "the create route minted no family token").toBeTruthy();
      fam[key] = { id: body.family!.id!, token: body.token! };
      psql(readFileSync(SEED, "utf8"), { fam: fam[key].id });
    }

    const meta = psql(`
      SELECT coalesce(json_agg(json_build_object(
        'name', c.relname,
        'pk', (SELECT json_agg(a.attname ORDER BY array_position(i.indkey::int2[], a.attnum))
                 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                WHERE i.indrelid = c.oid AND i.indisprimary),
        'hasFamilyId', EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'family_id' AND NOT a.attisdropped),
        'skipOnInsert', (SELECT coalesce(json_agg(a.attname), '[]') FROM pg_attribute a
                          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                            AND (a.attgenerated <> '' OR a.attidentity <> ''
                                 OR (a.atthasdef AND a.atttypid = 'uuid'::regtype
                                     AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey))))),
        'fixed', (SELECT coalesce(json_agg(a.attname), '[]') FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                     AND (a.attgenerated <> '' OR a.attidentity <> ''))
      ) ORDER BY c.relname), '[]')
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity;`);
    tables = JSON.parse(meta) as Table[];
    for (const t of tables) {
      if (INSTANCE_WIDE.has(t.name)) continue;
      before[t.name] = ownedRows(t, fam.B.id);
    }
  });

  test.afterAll(() => {
    if (!ENABLED) return;
    for (const key of ["A", "B"] as const) {
      if (!fam[key]?.id) continue;
      // delete_family() is how the server deletes a family: it sets the flag
      // without which the recycle bin's triggers keep the rows (#344).
      psql(`SELECT public.delete_family(:'fam');`, { fam: fam[key].id });
    }
  });

  test("every table with row-level security is covered: a row for each family, or instance-wide", () => {
    // Guard the guard: the catalogue query must have found the schema.
    expect(tables.length, "no table with row-level security found").toBeGreaterThan(40);
    const missing: string[] = [];
    for (const t of tables) {
      if (INSTANCE_WIDE.has(t.name)) continue;
      expect(t.pk, `${t.name} has no primary key`).toBeTruthy();
      if (before[t.name].length === 0) missing.push(`${t.name} (B)`);
      if (ownedRows(t, fam.A.id).length === 0) missing.push(`${t.name} (A)`);
    }
    expect(missing, `no seeded row; add one to e2e/fixtures/rls-matrix-seed.sql`).toEqual([]);
  });

  test("family A reads none of family B's rows, and its own except where only the server may read", async () => {
    const leaks: string[] = [];
    const blind: string[] = [];
    const open: string[] = [];
    for (const t of tables) {
      const res = await call(rest(`${t.name}?select=${t.pk.map(encodeURIComponent).join(",")}`), { token: fam.A.token });
      const rows = res.status === 200 && Array.isArray(res.body) ? (res.body as Record<string, unknown>[]) : [];
      if (INSTANCE_WIDE.has(t.name)) {
        if (rows.length > 0) leaks.push(`${t.name}: ${rows.length} instance-wide row(s)`);
        continue;
      }
      const theirs = new Set(before[t.name].map((r) => JSON.stringify(r.pk)));
      const seen = rows.filter((r) => theirs.has(JSON.stringify(t.pk.map((c) => r[c]))));
      if (seen.length > 0) leaks.push(`${t.name}: ${seen.length} of B's rows`);
      const mine = new Set(ownedRows(t, fam.A.id).map((r) => JSON.stringify(r.pk)));
      const own = rows.filter((r) => mine.has(JSON.stringify(t.pk.map((c) => r[c]))));
      if (SERVER_ONLY.has(t.name)) {
        if (own.length > 0) open.push(`${t.name}: ${own.length} row(s)`);
      } else if (own.length === 0) {
        blind.push(`${t.name}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
      }
    }
    expect(leaks, "family A read rows that are not its own").toEqual([]);
    // A token that reads nothing would pass the check above for every table.
    expect(blind, "family A could not read its own rows (a grant or policy missing?)").toEqual([]);
    expect(open, "the browser read a server-only table").toEqual([]);
  });

  test("the bare anon role, no Authorization header, reads nothing from any table", async () => {
    const leaks: string[] = [];
    for (const t of tables) {
      const res = await call(rest(`${t.name}?select=*`));
      if (res.status === 200 && Array.isArray(res.body) && res.body.length > 0) leaks.push(`${t.name}: ${res.body.length}`);
      else if (res.status !== 200 && res.status !== 401 && res.status !== 403) leaks.push(`${t.name}: HTTP ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  test("family A can't insert a copy of any of B's rows", async () => {
    const accepted: string[] = [];
    for (const t of tables) {
      if (INSTANCE_WIDE.has(t.name)) continue;
      for (const r of before[t.name]) {
        const copy = Object.fromEntries(Object.entries(r.row).filter(([k]) => !t.skipOnInsert.includes(k)));
        const res = await call(rest(t.name), { method: "POST", token: fam.A.token, body: copy, prefer: "return=minimal" });
        if (res.status < 400) accepted.push(`${t.name}: HTTP ${res.status}`);
        else {
          // PostgREST answers a refused row as 42501 (row-level security or
          // no grant). Anything else, a unique or check violation, means the
          // row got past the policy and was stopped by luck.
          const code = (res.body as { code?: string } | null)?.code;
          if (code !== "42501") accepted.push(`${t.name}: refused with ${code ?? res.status}, not by row-level security: ${JSON.stringify(res.body).slice(0, 200)}`);
        }
      }
    }
    expect(accepted).toEqual([]);
  });

  test("family A's update and delete reach none of B's rows", async () => {
    // How many rows a statement touched, as the database counted them
    // (Prefer: count=exact on a PATCH or DELETE). Counting beats comparing
    // rows afterwards: the app's own scheduler writes to some of these
    // tables meanwhile, and that is not family A.
    const touched = (res: Reply): number | string => {
      if (res.status >= 400) {
        // Refused outright, by a missing grant or a policy (42501). Any other
        // error (a trigger, a key column that can't be set) means the
        // statement failed before row-level security had its say, which
        // proves nothing about it.
        const code = (res.body as { code?: string } | null)?.code;
        return code === "42501" ? 0 : `refused with ${code ?? res.status}, not by row-level security: ${JSON.stringify(res.body).slice(0, 160)}`;
      }
      const range = res.headers.get("content-range") ?? "";
      const n = Number(range.split("/")[1]);
      return Number.isFinite(n) && range.includes("/") ? n : `HTTP ${res.status} without a count`;
    };

    // The control: the same request on A's own todo counts 1, so a count
    // of 0 below means "not reached", not "never counted".
    const todos = tables.find((t) => t.name === "todos")!;
    const mine = ownedRows(todos, fam.A.id)[0];
    const control = await call(rest(`todos?${pkFilter(todos, mine.pk)}`), {
      method: "PATCH", token: fam.A.token, body: { id: mine.pk[0] }, prefer: "return=minimal,count=exact",
    });
    expect(touched(control), `control PATCH on A's own todo: ${JSON.stringify(control.body)}`).toBe(1);

    const reached: string[] = [];
    for (const t of tables) {
      if (INSTANCE_WIDE.has(t.name)) continue;
      for (const r of before[t.name]) {
        const filter = pkFilter(t, r.pk);
        // Any column a statement may set, to the value it has: a key column
        // when one can be set, otherwise the first that can.
        const col = [...t.pk, ...Object.keys(r.row)].find((c) => !t.fixed.includes(c))!;
        const patch = await call(rest(`${t.name}?${filter}`), {
          method: "PATCH", token: fam.A.token, body: { [col]: r.row[col] }, prefer: "return=minimal,count=exact",
        });
        if (touched(patch) !== 0) reached.push(`${t.name} PATCH: ${touched(patch)}`);
        const del = await call(rest(`${t.name}?${filter}`), { method: "DELETE", token: fam.A.token, prefer: "return=minimal,count=exact" });
        if (touched(del) !== 0) reached.push(`${t.name} DELETE: ${touched(del)}`);
      }
      // And B's rows are all still there.
      const still = new Set(ownedRows(t, fam.B.id).map((r) => JSON.stringify(r.pk)));
      const gone = before[t.name].filter((r) => !still.has(JSON.stringify(r.pk)));
      if (gone.length > 0) reached.push(`${t.name}: ${gone.length} of B's rows gone`);
    }
    expect(reached).toEqual([]);
  });

  test("the service role, straight to PostgREST, counts what the superuser counts", async () => {
    const token = serviceToken();
    const differ: string[] = [];
    for (const t of tables) {
      let line = "";
      // The app writes in the background (device heartbeats, the scheduler);
      // a count that moved between the two reads is read again.
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await call(`${POSTGREST}/${t.name}?select=${encodeURIComponent(t.pk[0])}&limit=1`, { token, prefer: "count=exact" });
        const range = res.headers.get("content-range") ?? "";
        const viaApi = Number(range.split("/")[1]);
        const truth = superuserCount(t.name);
        if (res.status >= 200 && res.status < 300 && viaApi === truth) { line = ""; break; }
        line = `${t.name}: service role ${range || `HTTP ${res.status}`}, superuser ${truth}`;
      }
      if (line) differ.push(line);
    }
    expect(differ).toEqual([]);
  });

  test("an UPDATE or DELETE without a filter is refused by the database, and no row changes", async () => {
    const t = tables.find((x) => x.name === FILTERLESS_TABLE);
    expect(t, `${FILTERLESS_TABLE} has row-level security`).toBeTruthy();
    // What the two statements would leave behind: titles rewritten, and rows
    // moved to the recycle bin (todos are soft-deleted) or gone.
    const snapshot = () => psql(`SELECT count(*) FILTER (WHERE deleted_at IS NULL) || ' live, ' || count(*) FILTER (WHERE title = 'filterless') || ' rewritten' FROM public.${FILTERLESS_TABLE};`);
    const start = snapshot();
    expect(Number(start.split(" ")[0]), "nothing to protect").toBeGreaterThan(1);

    const attempts: Array<[string, string, string | null]> = [
      ["family token through /rest/v1", rest(FILTERLESS_TABLE), fam.A.token],
      ["service role straight to PostgREST", `${POSTGREST}/${FILTERLESS_TABLE}`, serviceToken()],
    ];
    const let_through: string[] = [];
    for (const [who, url, token] of attempts) {
      for (const method of ["PATCH", "DELETE"]) {
        const res = await call(url, { method, token, body: method === "PATCH" ? { title: "filterless" } : undefined, prefer: "return=minimal" });
        const message = (res.body as { message?: string } | null)?.message ?? "";
        const verb = method === "PATCH" ? "UPDATE" : "DELETE";
        if (!(res.status >= 400 && message === `${verb} requires a WHERE clause`)) {
          let_through.push(`${who}, ${method}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        }
      }
    }
    expect(let_through, "safeupdate did not refuse").toEqual([]);
    expect(snapshot(), "rows changed").toBe(start);
  });
});
