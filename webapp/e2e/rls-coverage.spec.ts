import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";

/**
 * Every family-scoped table must be in `direct_tables`.
 *
 * That array is the whole of row-level security here, it is maintained by
 * hand, and a table missing from it is not an error — it simply has no policy,
 * and the anon key reads every family's rows through Kong. It has happened.
 *
 * Reads the migrations rather than the database, because the thing that is
 * wrong in that failure is the SQL, and because a guard that needs a running
 * stack is one that gets skipped.
 */

const DOCKER = join(__dirname, "..", "docker");

/** Tables created with a `family_id` column, across every migration. */
function familyScopedTables(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(DOCKER).filter((f) => f.endsWith(".sql"))) {
    const sql = codeOnly(readFileSync(join(DOCKER, file), "utf8"), { sql: true });
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\s*\);/gi,
    )) {
      if (/\bfamily_id\b/.test(m[2])) found.add(m[1]);
    }
  }
  return found;
}

function directTables(): Set<string> {
  const sql = codeOnly(
    readFileSync(join(DOCKER, "migration_zz_row_level_security.sql"), "utf8"),
    { sql: true },
  );
  const arr = /direct_tables\s+TEXT\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/.exec(sql);
  if (!arr) throw new Error("could not find direct_tables");
  return new Set([...arr[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

test("every family-scoped table is under row-level security", () => {
  const scoped = familyScopedTables();
  // Guard the guard: a regex that stopped matching would make this vacuous.
  expect(scoped.size).toBeGreaterThan(15);

  const direct = directTables();
  expect(direct.size).toBeGreaterThan(15);

  // Tables reached through a parent row get their policy written out longhand
  // further down that file rather than via the array.
  const viaParent = new Set([
    "events", "todos", "meal_plan_entries", "recipe_ingredients",
    "pocket_money_transactions", "pocket_money_goals",
  ]);

  // Tables covered outside migration_zz_row_level_security.sql entirely,
  // by files that sort after it (`zzy`) and so were never candidates for the
  // array. Each is verified, not assumed:
  //
  // - context_rules / attention_items: their own RLS + a `_family_scope`
  //   policy, in migration_zzy_attention.sql — "ALTER TABLE public.context_rules
  //   ENABLE ROW LEVEL SECURITY;" / "CREATE POLICY context_rules_family_scope
  //   ON public.context_rules ... USING (family_id = public.current_family_id())"
  //   and the same pair for attention_items. The DROP-old-policies loop in
  //   migration_zz_row_level_security.sql excludes anything named
  //   `%_family_scope`, so it can't undo this even though this migration
  //   sorts after that one.
  // - integration_tokens / integration_clients: no RLS at all, but stronger —
  //   "REVOKE ALL ON TABLE public.integration_tokens FROM anon;" (and
  //   `authenticated`) in migration_integration_tokens.sql, GRANT only to
  //   service_role. PostgREST has no privilege to touch the table, so there
  //   is no row to leak regardless of policy.
  // - integration_idempotency / domain_events: the same REVOKE-from-anon /
  //   REVOKE-from-authenticated / GRANT-to-service_role-only shape, in
  //   migration_zzy_integration_idempotency.sql and
  //   migration_zzy_domain_events.sql respectively.
  const coveredElsewhere = new Set([
    "context_rules", "attention_items",
    "integration_tokens", "integration_clients",
    "integration_idempotency", "domain_events",
  ]);

  const uncovered = [...scoped].filter(
    (t) => !direct.has(t) && !viaParent.has(t) && !coveredElsewhere.has(t),
  );
  expect(uncovered).toEqual([]);
});
