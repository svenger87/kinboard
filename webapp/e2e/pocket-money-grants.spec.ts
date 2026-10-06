import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { browserWriteGrants, codeOnly } from "./source-helpers";
import { SKIP_WITHOUT_DATABASE, dbContainer } from "./whole-database";

/**
 * Only the server writes pocket-money data.
 *
 * The browser roles held INSERT, UPDATE and DELETE on every pocket_money_*
 * table, under FOR ALL policies scoped to the caller's family. A family token
 * — any screen in the house, a child's wall panel included — could run
 * `UPDATE pocket_money_accounts SET balance_cents = 999999` through PostgREST
 * and get `UPDATE 1`, and write best_tier or reward_mode past the settings PIN
 * the routes enforce (#353, #359).
 *
 * migration_zzzzzzzz_pocket_money_server_only.sql takes the write privileges
 * away. Reads stay: the pages and realtime need them, so they are asserted too.
 */

const DOCKER = join(__dirname, "..", "docker");
const SRC = join(__dirname, "..", "src");
const SELF = "migration_zzzzzzzz_pocket_money_server_only.sql";
const TABLES = [
  "pocket_money_accounts",
  "pocket_money_goals",
  "pocket_money_transactions",
  "pocket_money_withdrawal_requests",
];

const migrations = readdirSync(DOCKER).filter((f) => /^migration.*\.sql$/.test(f)).sort();
const sqlOf = (f: string) => codeOnly(readFileSync(join(DOCKER, f), "utf8"), { sql: true });

test.describe("migrations", () => {
  test("the revoke takes every write privilege on every pocket_money_* table from both browser roles", () => {
    const sql = sqlOf(SELF);
    expect(sql).toMatch(/c\.relname\s+LIKE\s+'pocket\\_money\\_%'/);
    expect(sql).toMatch(/ARRAY\['anon',\s*'authenticated'\]/);
    const revoke = /REVOKE\s+([A-Z,\s]+?)\s+ON\s+TABLE\s+public\.%I\s+FROM\s+%I/i.exec(sql);
    expect(revoke, "no REVOKE … ON TABLE public.%I FROM %I").not.toBeNull();
    const privileges = revoke![1].toUpperCase().split(",").map((p) => p.trim()).sort();
    expect(privileges).toEqual(["DELETE", "INSERT", "TRUNCATE", "UPDATE"]);
    // SELECT is what the pages and realtime run on; it must not be taken.
    expect(sql).not.toMatch(/REVOKE\s+(?:ALL|[A-Z,\s]*\bSELECT\b)/i);
  });

  test("the revoke sorts after every migration that names a pocket_money_* table", () => {
    const touching = migrations.filter((f) => f !== SELF && /\bpocket_money_[a-z_]+/i.test(sqlOf(f)));
    // Guard the guard: the tables are created in migration_pocket_money.sql.
    expect(touching).toContain("migration_pocket_money.sql");
    expect(touching).toContain("migration_zzzzzzz_point_rewards.sql");
    for (const f of touching) expect(f < SELF, `${f} sorts after ${SELF}`).toBe(true);
  });

  test("no migration grants a browser role a write on a pocket_money_* table after the revoke", () => {
    for (const f of migrations.filter((m) => m >= SELF)) {
      const sql = sqlOf(f);
      for (const table of TABLES) expect(browserWriteGrants(sql, table), `${f} on ${table}`).toEqual([]);
      // A GRANT built with format() is out of browserWriteGrants' reach.
      expect(sql, `${f} builds a GRANT at run time`).not.toMatch(/'GRANT\s/i);
    }
  });
});

/*
  Browser code: everything a page can load. The roots are every file outside
  src/app/api that is a page, a component, a hook or a store, or says
  "use client"; from there every non-type import is followed, so a lib module
  a hook pulls in counts as browser code too.
*/
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function browserFiles(): Set<string> {
  const api = join(SRC, "app", "api") + "/";
  const all = walk(SRC);
  const roots = all.filter((f) => {
    if (f.startsWith(api)) return false;
    if (/^\s*["']use client["']/m.test(readFileSync(f, "utf8"))) return true;
    return ["app", "components", "hooks", "stores"].some((d) => f.startsWith(join(SRC, d) + "/"));
  });
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = codeOnly(readFileSync(file, "utf8"));
    for (const m of code.matchAll(/\b(?:import|export)\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveImport(file, m[1] ?? m[2]);
      if (target && !target.startsWith(api)) queue.push(target);
    }
  }
  return seen;
}

/** `.from("pocket_money_…")` followed, in the same statement, by a write. */
const POCKET_MONEY_WRITE =
  /\.from\(\s*["'`](pocket_money_[a-z_]+)["'`]\s*\)[^;]*?\.(insert|update|upsert|delete)\s*\(/g;

test("no browser code writes a pocket_money_* table", () => {
  const files = browserFiles();
  // Guard the guard: the walk reaches the page and its hooks.
  expect(files).toContain(join(SRC, "app", "pocket-money", "page.tsx"));
  expect(files).toContain(join(SRC, "hooks", "use-pocket-money-accounts.ts"));
  // and the regex sees a write when there is one.
  expect([...`x.from("pocket_money_accounts")\n  .update({ balance_cents: 1 })`.matchAll(POCKET_MONEY_WRITE)]).toHaveLength(1);

  const offenders: string[] = [];
  for (const file of files) {
    for (const m of codeOnly(readFileSync(file, "utf8")).matchAll(POCKET_MONEY_WRITE)) {
      offenders.push(`${file.slice(SRC.length + 1)}: ${m[2]} ${m[1]}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the pocket-money page records the avatar stage through the account route", () => {
  // The one write a page makes on load: last_seen_tier / best_tier. It must go
  // through PATCH /api/pocket-money/accounts/[id], which allows those two
  // fields without the PIN, not through the database API.
  const hook = codeOnly(readFileSync(join(SRC, "hooks", "use-pocket-money-accounts.ts"), "utf8"));
  expect(hook).toMatch(/fetch\(`\/api\/pocket-money\/accounts\/\$\{id\}`/);
  expect(hook).not.toMatch(/\.from\(/);
});

/*
  Against the running database, after every migration has run: the grants as
  they are, and the reviewer's probe replayed as a family token. Everything
  happens inside BEGIN … ROLLBACK, so it leaves nothing behind.
*/
test.describe("live database", () => {
  test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");

  function psql(sql: string): string {
    return execFileSync(
      "docker",
      ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  }

  test("anon and authenticated hold SELECT on every pocket_money_* table, and no write", () => {
    const rows = psql(`
      SELECT c.relname || ':' || r || ':' || string_agg(p, ',' ORDER BY p)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           unnest(ARRAY['anon','authenticated']) r,
           unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'pocket\\_money\\_%'
        AND has_table_privilege(r, c.oid, p)
      GROUP BY c.relname, r ORDER BY 1;`).split("\n");
    expect(rows).toEqual(TABLES.flatMap((t) => [`${t}:anon:SELECT`, `${t}:authenticated:SELECT`]));
  });

  test("a family token reads its pocket money but cannot write any of it; the service role still can", () => {
    const fam = "0f0f0f0f-0000-4000-8000-00000000d1a0";
    const child = "0f0f0f0f-0000-4000-8000-00000000d1a1";
    const acct = "0f0f0f0f-0000-4000-8000-00000000d1a2";
    const goal = "0f0f0f0f-0000-4000-8000-00000000d1a3";
    const tx = "0f0f0f0f-0000-4000-8000-00000000d1a4";
    const wr = "0f0f0f0f-0000-4000-8000-00000000d1a5";

    // Each attempt runs in a DO block that reports how it ended, then rolls
    // back to a savepoint, so one denial does not abort the rest.
    const attempt = (label: string, stmt: string) => `
      SAVEPOINT s;
      DO $$
      BEGIN
        ${stmt};
        PERFORM set_config('pm.result', coalesce(current_setting('pm.result', true), '') || '${label}:allowed;', false);
      EXCEPTION
        WHEN insufficient_privilege THEN
          PERFORM set_config('pm.result', coalesce(current_setting('pm.result', true), '') || '${label}:denied;', false);
        -- Got past the privilege check and failed on something else.
        WHEN OTHERS THEN
          PERFORM set_config('pm.result', coalesce(current_setting('pm.result', true), '') || '${label}:allowed-' || SQLSTATE || ';', false);
      END $$;
      RELEASE SAVEPOINT s;`;

    const out = psql(`
      BEGIN;
      INSERT INTO families (id, name, join_code) VALUES
        ('${fam}', 'claude-pm-grants', 'CLPM' || upper(substr(md5(random()::text), 1, 6)));
      INSERT INTO people (id, family_id, name, is_child) VALUES ('${child}', '${fam}', 'claude-pm-child', true);
      INSERT INTO pocket_money_accounts (id, family_id, person_id, balance_cents) VALUES ('${acct}', '${fam}', '${child}', 500);
      INSERT INTO pocket_money_goals (id, account_id, name, target_amount_cents) VALUES ('${goal}', '${acct}', 'claude-goal', 1000);
      INSERT INTO pocket_money_transactions (id, account_id, amount_cents, type) VALUES ('${tx}', '${acct}', 500, 'manual_deposit');
      INSERT INTO pocket_money_withdrawal_requests (id, account_id, amount_cents) VALUES ('${wr}', '${acct}', 100);

      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"role":"authenticated","family_id":"${fam}"}', true) IS NOT NULL;
      SELECT 'read:' || (SELECT count(*) FROM pocket_money_accounts WHERE id = '${acct}')
                     || (SELECT count(*) FROM pocket_money_goals WHERE id = '${goal}')
                     || (SELECT count(*) FROM pocket_money_transactions WHERE id = '${tx}')
                     || (SELECT count(*) FROM pocket_money_withdrawal_requests WHERE id = '${wr}');
      ${attempt("acct-balance", `UPDATE pocket_money_accounts SET balance_cents = 999999 WHERE id = '${acct}'`)}
      ${attempt("acct-best-tier", `UPDATE pocket_money_accounts SET best_tier = 8 WHERE id = '${acct}'`)}
      ${attempt("acct-reward-mode", `UPDATE pocket_money_accounts SET reward_mode = 'points' WHERE id = '${acct}'`)}
      ${attempt("acct-insert", `INSERT INTO pocket_money_accounts (family_id, person_id) VALUES ('${fam}', '${child}')`)}
      ${attempt("acct-delete", `DELETE FROM pocket_money_accounts WHERE id = '${acct}'`)}
      ${attempt("goal-update", `UPDATE pocket_money_goals SET target_amount_cents = 1 WHERE id = '${goal}'`)}
      ${attempt("goal-insert", `INSERT INTO pocket_money_goals (account_id, name, target_amount_cents) VALUES ('${acct}', 'x', 1)`)}
      ${attempt("goal-delete", `DELETE FROM pocket_money_goals WHERE id = '${goal}'`)}
      ${attempt("tx-update", `UPDATE pocket_money_transactions SET amount_cents = 999999 WHERE id = '${tx}'`)}
      ${attempt("tx-insert", `INSERT INTO pocket_money_transactions (account_id, amount_cents, type) VALUES ('${acct}', 999999, 'manual_deposit')`)}
      ${attempt("tx-delete", `DELETE FROM pocket_money_transactions WHERE id = '${tx}'`)}
      ${attempt("wr-update", `UPDATE pocket_money_withdrawal_requests SET status = 'approved' WHERE id = '${wr}'`)}
      ${attempt("wr-insert", `INSERT INTO pocket_money_withdrawal_requests (account_id, amount_cents) VALUES ('${acct}', 1)`)}
      ${attempt("wr-delete", `DELETE FROM pocket_money_withdrawal_requests WHERE id = '${wr}'`)}
      ${attempt("acct-truncate", `TRUNCATE pocket_money_transactions`)}
      SELECT 'results:' || current_setting('pm.result', true);

      RESET ROLE;
      SET LOCAL ROLE service_role;
      UPDATE pocket_money_accounts SET balance_cents = 600 WHERE id = '${acct}';
      SELECT 'service:' || balance_cents FROM pocket_money_accounts WHERE id = '${acct}';
      RESET ROLE;
      SELECT 'balance:' || balance_cents FROM pocket_money_accounts WHERE id = '${acct}';
      ROLLBACK;`);

    expect(out).toContain("read:1111");
    const results = /results:(.*)/.exec(out)?.[1] ?? "";
    const outcomes = results.split(";").filter(Boolean);
    // Guard the guard: every attempt reported back.
    expect(outcomes).toHaveLength(15);
    expect(outcomes.filter((o) => !o.endsWith(":denied"))).toEqual([]);
    expect(out).toContain("service:600");
    expect(out).toContain("balance:600");
  });
});
