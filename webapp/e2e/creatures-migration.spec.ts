import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_zzzzzzzz_pocket_money_creatures_out.sql (RFC-017 step 1): the
 * creatures move off the pocket-money account into `creatures`, and a child's
 * reward requests from the account to the child.
 *
 * The backfill rule (RFC-017 §3.3): every account gets a creature with its
 * species, style, look and stages, switched on, the shop on, growing with
 * points where reward_mode was 'points' and with money otherwise -- the
 * classic dragon nobody ever touched included, since the child has one today.
 * A child with no account gets none. It runs once, with the table: a second
 * boot creates nothing, and a creature already there is never touched.
 *
 * The live part runs in one psql session inside BEGIN ... ROLLBACK: drop the
 * table and the new column, seed a family, apply the migration twice, probe,
 * roll everything back.
 */

const FILE = "migration_zzzzzzzz_pocket_money_creatures_out.sql";
const DIR = join(process.cwd(), "docker");
const MIGRATION = readFileSync(join(DIR, FILE), "utf8");
const SQL = codeOnly(MIGRATION, { sql: true });

test.describe("the file", () => {
  test("sorts after what it copies and before the pocket-money revoke", () => {
    const files = readdirSync(DIR).filter((f) => /^migration.*\.sql$/.test(f)).sort();
    const at = files.indexOf(FILE);
    expect(at).toBeGreaterThan(-1);
    for (const before of [
      "migration_zzzzzzz_point_rewards.sql",
      "migration_zzzzzzzz_pocket_money_avatar_style.sql",
      "migration_zzzzzzzz_pocket_money_avatar_style_look.sql",
      "migration_zzz_todo_points.sql",
      "migration_zz_row_level_security.sql",
    ]) expect(files.indexOf(before), before).toBeLessThan(at);
    expect(files.indexOf("migration_zzzzzzzz_pocket_money_server_only.sql")).toBeGreaterThan(at);
  });

  test("the backfill runs only in the statement that creates the table", () => {
    const block = SQL.slice(SQL.indexOf("IF to_regclass('public.creatures') IS NULL THEN\n    CREATE TABLE"));
    const end = block.indexOf("END IF;");
    expect(block.slice(0, end)).toContain("PERFORM public.creatures_from_accounts(NULL);");
    // and nowhere else
    expect(SQL.match(/creatures_from_accounts\(NULL\)/g)).toHaveLength(1);
  });

  test("the backfill's rule: every account, points mode grows with points, the rest with money", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.creatures_from_accounts("), SQL.indexOf("DO $$"));
    expect(fn).toContain("CASE WHEN a.reward_mode = 'points' THEN 'points' ELSE 'money' END");
    expect(fn).toContain("FROM public.pocket_money_accounts a");
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.creatures c WHERE c\.person_id = a\.person_id\)/);
    expect(fn).not.toMatch(/ON CONFLICT/);
  });

  test("the fill-keys trigger exists before the backfill and the NOT NULL, so an rc.13 insert mid-run is filled in", () => {
    const trigger = SQL.indexOf("CREATE TRIGGER point_redemptions_fill_keys");
    expect(trigger).toBeGreaterThan(SQL.indexOf("ADD COLUMN IF NOT EXISTS person_id"));
    expect(trigger).toBeLessThan(SQL.indexOf("UPDATE public.point_redemptions r"));
    expect(trigger).toBeLessThan(SQL.indexOf("ALTER COLUMN person_id SET NOT NULL"));
  });

  test("two runs at once are serialised by a session lock, taken first and released last", () => {
    const lock = SQL.indexOf("SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzz_pocket_money_creatures_out', 0));");
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(SQL.indexOf("CREATE OR REPLACE FUNCTION"));
    expect(SQL.lastIndexOf("SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzz_pocket_money_creatures_out', 0));"))
      .toBeGreaterThan(SQL.lastIndexOf("END $$;"));
  });

  test("only children, and switched on only where the family has pocket money on", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.creatures_from_accounts("), SQL.indexOf("DO $$"));
    expect(fn).toContain("JOIN public.people p ON p.id = a.person_id AND p.family_id = a.family_id AND p.is_child");
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.settings s\s+WHERE s\.family_id = a\.family_id AND s\.key = 'enabled_plugins'\s+AND s\.value -> 'pocket-money' = 'false'::jsonb\)/);
  });

  test("the old account columns stay, and nothing drops them", () => {
    expect(SQL).not.toMatch(/DROP COLUMN/i);
    expect(SQL).not.toMatch(/DROP FUNCTION/i);
    expect(SQL).not.toMatch(/ALTER TABLE public\.pocket_money_accounts/i);
  });
});

test.describe("against the database", () => {
  test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");
  test.beforeEach(acquireWholeDatabase);
  test.afterEach(releaseWholeDatabase);

  function psql(script: string): string {
    return execFileSync(
      "docker",
      ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
      { input: script, encoding: "utf8" },
    ).trim();
  }

  test("backfill, re-key, a second run, and what a rollback to rc.13 still finds", () => {
    const fam = randomUUID();
    const offFam = randomUUID();
    const [money, points, cat, none, late, adult, offKid] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [aMoney, aPoints, aCat, aLate, aAdult, aOff] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [rPending, rApproved] = [randomUUID(), randomUUID()];
    const creature = (p: string, tag: string) =>
      `SELECT '${tag}|' || coalesce((SELECT concat_ws('|', species, style, look::text, best_tier, last_seen_tier, grows_with, shop_enabled::text, enabled::text)
        FROM public.creatures WHERE person_id = '${p}'), 'none');`;

    const out = psql(`BEGIN;
-- rc.13's schema: no creatures, no person on a request, no trigger filling it.
DROP TABLE public.creatures;
DROP TRIGGER point_redemptions_fill_keys ON public.point_redemptions;
ALTER TABLE public.point_redemptions DROP COLUMN person_id CASCADE;
INSERT INTO public.families (id, name, join_code) VALUES ('${fam}', 'claude-creatures-mig', 'CM' || upper(substr(md5(random()::text), 1, 8)));
INSERT INTO public.people (id, family_id, name, is_child) VALUES
  ('${money}', '${fam}', 'money', true), ('${points}', '${fam}', 'points', true),
  ('${cat}', '${fam}', 'cat', true), ('${none}', '${fam}', 'none', true), ('${late}', '${fam}', 'late', true);
-- A classic dragon nobody touched, in money mode, stage 4 reached.
INSERT INTO public.pocket_money_accounts (id, family_id, person_id, best_tier, last_seen_tier) VALUES ('${aMoney}', '${fam}', '${money}', 4, 4);
-- Points mode, drawn, dressed and named.
INSERT INTO public.pocket_money_accounts (id, family_id, person_id, avatar_species, avatar_style, avatar_look, reward_mode, best_tier, last_seen_tier)
  VALUES ('${aPoints}', '${fam}', '${points}', 'unicorn', 'sticker', '{"name":"Funkel","body":"#FF8A5B"}', 'points', 3, 5);
-- Another species, money mode, a stage out of range left over from long ago.
INSERT INTO public.pocket_money_accounts (id, family_id, person_id, avatar_species, last_seen_tier) VALUES ('${aCat}', '${fam}', '${cat}', 'cat', 0);
INSERT INTO public.point_redemptions (id, family_id, account_id, title, cost_points, status) VALUES
  ('${rPending}', '${fam}', '${aPoints}', 'claude-film', 10, 'pending'),
  ('${rApproved}', '${fam}', '${aPoints}', 'claude-zoo', 20, 'approved');
INSERT INTO public.todo_point_awards (family_id, person_id, completion_key, points) VALUES ('${fam}', '${points}', 'claude-mig', 100);
-- A grown-up with an account: never had a creature on screen.
INSERT INTO public.people (id, family_id, name, is_child) VALUES ('${adult}', '${fam}', 'adult', false);
INSERT INTO public.pocket_money_accounts (id, family_id, person_id) VALUES ('${aAdult}', '${fam}', '${adult}');
-- A family with pocket money switched off.
INSERT INTO public.families (id, name, join_code) VALUES ('${offFam}', 'claude-creatures-mig-off', 'CM' || upper(substr(md5(random()::text), 1, 8)));
INSERT INTO public.settings (family_id, key, value) VALUES ('${offFam}', 'enabled_plugins', '{"pocket-money": false, "media": true}'::jsonb);
INSERT INTO public.people (id, family_id, name, is_child) VALUES ('${offKid}', '${offFam}', 'off', true);
INSERT INTO public.pocket_money_accounts (id, family_id, person_id, avatar_species) VALUES ('${aOff}', '${offFam}', '${offKid}', 'fox');
${MIGRATION}
${creature(adult, "ADULT")}
${creature(offKid, "OFF")}
${creature(money, "MONEY")}
${creature(points, "POINTS")}
${creature(cat, "CAT")}
${creature(none, "NONE")}
SELECT 'KEYS|' || string_agg(id::text || '=' || person_id::text, ',' ORDER BY title) FROM public.point_redemptions WHERE family_id = '${fam}';
SELECT 'NN|' || is_nullable FROM information_schema.columns WHERE table_name = 'point_redemptions' AND column_name = 'person_id';
SELECT 'TOT|' || public.point_person_totals('${fam}', '${points}')::text;
SELECT 'OLDTOT|' || public.point_account_totals('${fam}', '${aPoints}')::text;
-- A parent switches the money child's creature off; the points child restyles.
UPDATE public.creatures SET enabled = false WHERE person_id = '${money}';
UPDATE public.creatures SET style = 'gumdrop' WHERE person_id = '${points}';
-- A pocket-money account added after the upgrade.
INSERT INTO public.pocket_money_accounts (id, family_id, person_id) VALUES ('${aLate}', '${fam}', '${late}');
${MIGRATION}
${creature(money, "MONEY2")}
${creature(points, "POINTS2")}
${creature(late, "LATE2")}
SELECT 'COUNT2|' || count(*) FROM public.creatures WHERE family_id = '${fam}';
-- The rule as a function (an old backup's import): only where none exists.
SELECT 'FN|' || public.creatures_from_accounts('${fam}');
SELECT 'FN2|' || public.creatures_from_accounts('${fam}');
${creature(money, "MONEY3")}
-- rc.13 after a rollback: its columns are there and readable, its insert
-- names only the account, its functions answer.
SELECT 'COLS|' || count(*) FROM information_schema.columns WHERE table_name = 'pocket_money_accounts'
  AND column_name IN ('avatar_species', 'avatar_style', 'avatar_look', 'best_tier', 'last_seen_tier', 'reward_mode');
INSERT INTO public.point_redemptions (family_id, account_id, title, cost_points) VALUES ('${fam}', '${aPoints}', 'claude-rc13', 1);
SELECT 'RC13|' || (person_id = '${points}') FROM public.point_redemptions WHERE title = 'claude-rc13';
SELECT 'RC13FN|' || (public.request_point_redemption('${fam}', '${aPoints}', NULL, NULL)->>'error');
INSERT INTO public.point_redemptions (family_id, person_id, title, cost_points) VALUES ('${fam}', '${points}', 'claude-new', 1);
SELECT 'NEWACCT|' || (account_id = '${aPoints}') FROM public.point_redemptions WHERE title = 'claude-new';
-- Deleting the account no longer deletes the child's requests.
DELETE FROM public.pocket_money_accounts WHERE id = '${aPoints}';
SELECT 'KEPT|' || count(*) || '|' || count(account_id) FROM public.point_redemptions WHERE person_id = '${points}';
SELECT 'KEPTC|' || count(*) FROM public.creatures WHERE person_id = '${points}';
ROLLBACK;
`).split("\n");

    const line = (tag: string) => out.find((l) => l.startsWith(`${tag}|`))?.slice(tag.length + 1);
    // classic, untouched, money mode: a creature growing with money, at its stage
    expect(line("MONEY")).toBe("dragon|classic|{}|4|4|money|true|true");
    // points mode: points, with the drawn style, the look and the stages
    expect(line("POINTS")).toBe(`unicorn|sticker|{"body": "#FF8A5B", "name": "Funkel"}|3|5|points|true|true`);
    // another species in money mode; a stage out of range clamped into 1..8
    expect(line("CAT")).toBe("cat|classic|{}|1|1|money|true|true");
    // no account, no creature; a grown-up's account, no creature
    expect(line("NONE")).toBe("none");
    expect(line("ADULT")).toBe("none");
    // pocket money off: kept, switched off
    expect(line("OFF")).toBe("fox|classic|{}|1|1|money|true|false");
    // the requests now belong to the child
    expect(line("KEYS")).toBe(`${rPending}=${points},${rApproved}=${points}`);
    expect(line("NN")).toBe("NO");
    expect(JSON.parse(line("TOT")!)).toEqual({ earned: 100, spent: 20, pending: 10, balance: 80, owed: 0 });
    expect(line("OLDTOT")).toBe(line("TOT"));
    // the second run: nothing switched back on, nothing restyled, nothing new
    expect(line("MONEY2")).toBe("dragon|classic|{}|4|4|money|true|false");
    expect(line("POINTS2")).toContain("|gumdrop|");
    expect(line("LATE2")).toBe("none");
    expect(line("COUNT2")).toBe("3");
    // the function: creates only what is missing, then nothing
    expect(line("FN")).toBe("1");
    expect(line("FN2")).toBe("0");
    expect(line("MONEY3")).toBe("dragon|classic|{}|4|4|money|true|false");
    // rc.13
    expect(line("COLS")).toBe("6");
    expect(line("RC13")).toBe("true");
    expect(line("RC13FN")).toBe("no_reward");
    expect(line("NEWACCT")).toBe("true");
    expect(line("KEPT")).toBe("4|0");
    expect(line("KEPTC")).toBe("1");

    expect(psql(`SELECT count(*) FROM public.families WHERE id IN ('${fam}', '${offFam}');`)).toBe("0");
    expect(psql(`SELECT to_regclass('public.creatures') IS NOT NULL;`)).toBe("t");
  });

  test("the grants: the browser reads creatures and writes nothing; the service role writes", () => {
    const rows = psql(`
      SELECT r || ':' || string_agg(p, ',' ORDER BY p)
      FROM unnest(ARRAY['anon','authenticated']) r,
           unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
      WHERE has_table_privilege(r, 'public.creatures', p)
      GROUP BY r ORDER BY 1;`).split("\n").filter(Boolean);
    expect(rows).toEqual(["authenticated:SELECT"]);
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(psql(`SELECT has_table_privilege('service_role', 'public.creatures', '${p}');`), p).toBe("t");
    }
    expect(psql(`SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'creatures';`)).toBe("1");
    for (const fn of [
      "public.creatures_from_accounts(uuid)",
      "public.point_person_totals(uuid, uuid)",
      "public.request_person_point_redemption(uuid, uuid, uuid, uuid)",
    ]) {
      expect(psql(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE');`), fn).toBe("f");
      expect(psql(`SELECT has_function_privilege('service_role', '${fn}', 'EXECUTE');`), fn).toBe("t");
    }
  });

  test("a family token reads its own creatures, not another family's, and cannot write one", () => {
    const fam = randomUUID();
    const other = randomUUID();
    const kid = randomUUID();
    const attempt = (label: string, stmt: string) => `
      SAVEPOINT s;
      DO $$
      BEGIN
        ${stmt};
        PERFORM set_config('cr.result', coalesce(current_setting('cr.result', true), '') || '${label}:allowed;', false);
      EXCEPTION
        WHEN insufficient_privilege THEN
          PERFORM set_config('cr.result', coalesce(current_setting('cr.result', true), '') || '${label}:denied;', false);
        WHEN OTHERS THEN
          PERFORM set_config('cr.result', coalesce(current_setting('cr.result', true), '') || '${label}:allowed-' || SQLSTATE || ';', false);
      END $$;
      RELEASE SAVEPOINT s;`;
    const out = psql(`BEGIN;
      INSERT INTO families (id, name, join_code) VALUES ('${fam}', 'claude-cr-rls', 'CR' || upper(substr(md5(random()::text), 1, 8))),
        ('${other}', 'claude-cr-rls2', 'CR' || upper(substr(md5(random()::text), 1, 8)));
      INSERT INTO people (id, family_id, name, is_child) VALUES ('${kid}', '${fam}', 'claude-cr-kid', true);
      INSERT INTO creatures (person_id, family_id) VALUES ('${kid}', '${fam}');
      INSERT INTO pocket_money_accounts (family_id, person_id) VALUES ('${fam}', '${kid}');
      INSERT INTO point_redemptions (family_id, person_id, title, cost_points) VALUES ('${fam}', '${kid}', 'claude-cr', 1);
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"role":"authenticated","family_id":"${fam}"}', true) IS NOT NULL;
      SELECT 'mine:' || count(*) FROM creatures WHERE person_id = '${kid}';
      SELECT 'acct:' || count(*) FROM pocket_money_accounts WHERE person_id = '${kid}';
      SELECT 'req:' || count(*) FROM point_redemptions WHERE person_id = '${kid}';
      ${attempt("update", `UPDATE creatures SET best_tier = 8, enabled = true WHERE person_id = '${kid}'`)}
      ${attempt("insert", `INSERT INTO creatures (person_id, family_id) VALUES ('${kid}', '${fam}')`)}
      ${attempt("delete", `DELETE FROM creatures WHERE person_id = '${kid}'`)}
      ${attempt("truncate", `TRUNCATE creatures`)}
      SELECT 'results:' || current_setting('cr.result', true);
      SELECT set_config('request.jwt.claims', '{"role":"authenticated","family_id":"${other}"}', true) IS NOT NULL;
      SELECT 'theirs:' || count(*) FROM creatures WHERE person_id = '${kid}';
      RESET ROLE;
      UPDATE people SET deleted_at = now() WHERE id = '${kid}';
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"role":"authenticated","family_id":"${fam}"}', true) IS NOT NULL;
      SELECT 'binned:' || count(*) FROM creatures WHERE person_id = '${kid}';
      SELECT 'binnedacct:' || count(*) FROM pocket_money_accounts WHERE person_id = '${kid}';
      SELECT 'binnedreq:' || count(*) FROM point_redemptions WHERE person_id = '${kid}';
      RESET ROLE;
      SELECT 'binnedask:' || (public.request_person_point_redemption('${fam}', '${kid}', NULL, NULL)->>'error');
      ROLLBACK;`);
    expect(out).toContain("mine:1");
    expect(out).toContain("theirs:0");
    expect(out).toContain("binned:0");
    // the same for the child's pocket-money account (migration_zzz_soft_delete.sql §3b,
    // which said NOT EXISTS under people's own RLS and so never hid it) and requests
    expect(out).toContain("acct:1");
    expect(out).toContain("req:1");
    expect(out).toContain("binnedacct:0");
    expect(out).toContain("binnedreq:0");
    // and a binned child cannot ask for a reward
    expect(out).toContain("binnedask:not_found");
    const outcomes = (/results:(.*)/.exec(out)?.[1] ?? "").split(";").filter(Boolean);
    expect(outcomes).toHaveLength(4);
    expect(outcomes.filter((o) => !o.endsWith(":denied"))).toEqual([]);
  });
});
