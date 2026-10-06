import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { browserWriteGrants, codeOnly } from "./source-helpers";

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
  // - todo_point_awards: its own RLS + todo_point_awards_family_read policy
  //   in migration_zzz_todo_points.sql, which runs after the central RLS
  //   migration and scopes reads to public.current_family_id().
  // - oauth_authorization_requests: no RLS, REVOKE-from-anon/authenticated and
  //   GRANT-to-service_role-only in migration_oauth_mcp.sql, like
  //   integration_tokens above.
  // - assistant_action_requests: its own RLS + a family-scoped SELECT-only
  //   policy, REVOKE ALL from anon/authenticated and only SELECT given back to
  //   authenticated (realtime needs it), in
  //   migration_zzzz_assistant_actions.sql — verified below. A screen's token
  //   must never be able to UPDATE a request into "approved" past the PIN.
  const coveredElsewhere = new Set([
    "context_rules", "attention_items",
    "integration_tokens", "integration_clients",
    "integration_idempotency", "domain_events",
    "todo_point_awards",
    "oauth_authorization_requests",
    "assistant_action_requests",
    "todo_occurrences", "todo_events",
    "point_rewards", "point_redemptions",
  ]);

  // - todo_occurrences / todo_events (#341): their own RLS + a family-scoped
  //   SELECT-only policy, REVOKE ALL from anon/authenticated and only SELECT
  //   given back, in migration_zzzzzy_todo_turns.sql. Every write is a
  //   trigger's, run as its owner: a screen must not write itself a history.
  const turnsSql = codeOnly(
    readFileSync(join(DOCKER, "migration_zzzzzy_todo_turns.sql"), "utf8"),
    { sql: true },
  );
  for (const table of ["todo_occurrences", "todo_events"]) {
    expect(turnsSql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`, "i"));
    expect(turnsSql).toMatch(new RegExp(`CREATE POLICY ${table}_family_read ON public\\.${table}\\s+FOR SELECT USING \\(family_id = public\\.current_family_id\\(\\)\\);`, "i"));
    expect(turnsSql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM authenticated;`, "i"));
    expect(browserWriteGrants(turnsSql, table), table).toEqual([]);
  }
  expect("migration_zzzzzy_todo_turns.sql" > "migration_zz_row_level_security.sql").toBe(true);

  // - point_rewards / point_redemptions (#349): their own RLS + a
  //   family-scoped SELECT-only policy, REVOKE ALL from anon/authenticated and
  //   only SELECT given back, in migration_zzzzzzz_point_rewards.sql. Every
  //   write goes through a server route on the service role: a child's screen
  //   must not be able to approve its own reward.
  const rewardsSql = codeOnly(
    readFileSync(join(DOCKER, "migration_zzzzzzz_point_rewards.sql"), "utf8"),
    { sql: true },
  );
  for (const table of ["point_rewards", "point_redemptions"]) {
    expect(rewardsSql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`, "i"));
    expect(rewardsSql).toMatch(new RegExp(`CREATE POLICY ${table}_family_read ON public\\.${table}\\s+FOR SELECT USING \\(family_id = public\\.current_family_id\\(\\)\\);`, "i"));
    expect(rewardsSql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM authenticated;`, "i"));
    expect(browserWriteGrants(rewardsSql, table), table).toEqual([]);
  }
  expect("migration_zzzzzzz_point_rewards.sql" > "migration_zz_row_level_security.sql").toBe(true);

  // - pocket_money_* keep their FOR ALL `_family_scope` policies (above), but
  //   migration_zzzzzzzz_pocket_money_server_only.sql REVOKEs INSERT, UPDATE,
  //   DELETE and TRUNCATE from anon/authenticated on every one of them. Every
  //   write is a server route on the service role: a screen must not be able to
  //   give itself money or a stage past the PIN. No migration that runs after
  //   the revoke may hand a browser role a write on them again.
  const pmOnly = "migration_zzzzzzzz_pocket_money_server_only.sql";
  const pmSql = codeOnly(readFileSync(join(DOCKER, pmOnly), "utf8"), { sql: true });
  expect(pmSql).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.%I FROM %I/);
  expect(pmSql).toMatch(/LIKE 'pocket\\_money\\_%'/);
  expect(pmOnly > "migration_zzzzzzz_point_rewards.sql").toBe(true);
  for (const file of readdirSync(DOCKER).filter((f) => f.startsWith("migration") && f.endsWith(".sql") && f >= pmOnly)) {
    const sql = codeOnly(readFileSync(join(DOCKER, file), "utf8"), { sql: true });
    for (const table of ["pocket_money_accounts", "pocket_money_goals", "pocket_money_transactions", "pocket_money_withdrawal_requests"]) {
      expect(browserWriteGrants(sql, table), `${file}: ${table}`).toEqual([]);
    }
  }

  const actionsSql = codeOnly(
    readFileSync(join(DOCKER, "migration_zzzz_assistant_actions.sql"), "utf8"),
    { sql: true },
  );
  expect(actionsSql).toMatch(/ALTER TABLE public\.assistant_action_requests ENABLE ROW LEVEL SECURITY;/i);
  expect(actionsSql).toMatch(/CREATE POLICY assistant_action_requests_family_scope ON public\.assistant_action_requests\s+FOR SELECT USING \(family_id = public\.current_family_id\(\)\);/i);
  expect(actionsSql).toMatch(/REVOKE ALL ON TABLE public\.assistant_action_requests FROM anon;/i);
  expect(actionsSql).toMatch(/REVOKE ALL ON TABLE public\.assistant_action_requests FROM authenticated;/i);
  expect(actionsSql).toMatch(/GRANT SELECT ON TABLE public\.assistant_action_requests TO authenticated;/i);
  expect(browserWriteGrants(actionsSql, "assistant_action_requests")).toEqual([]);
  // Sorts after the RLS migration, whose clean-up loop drops non-`_family_scope` policies.
  expect("migration_zzzz_assistant_actions.sql" > "migration_zz_row_level_security.sql").toBe(true);

  const awardsSql = codeOnly(
    readFileSync(join(DOCKER, "migration_zzz_todo_points.sql"), "utf8"),
    { sql: true },
  );
  expect(awardsSql).toMatch(/ALTER TABLE public\.todo_point_awards ENABLE ROW LEVEL SECURITY;/i);
  expect(awardsSql).toMatch(/CREATE POLICY todo_point_awards_family_read ON public\.todo_point_awards\s+FOR SELECT USING \(family_id = public\.current_family_id\(\)\);/i);

  const uncovered = [...scoped].filter(
    (t) => !direct.has(t) && !viaParent.has(t) && !coveredElsewhere.has(t),
  );
  expect(uncovered).toEqual([]);
});
