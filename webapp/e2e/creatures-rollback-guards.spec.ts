import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";

/**
 * A later release drops the creature's old columns from pocket_money_accounts
 * (RFC-017 §7 step 5), along with the best_tier trigger. Every migration
 * re-runs on every boot, so going back to this release afterwards re-runs the
 * four files that add those columns. Unguarded, two of them fail on the
 * missing columns -- and the webapp entrypoint refuses to start on a failed
 * migration -- and the other two put the columns back, empty.
 *
 * Each of those statements therefore runs only while `creatures` does not
 * exist: on an install from before the creatures moved out, where
 * migration_zzzzzzzz_pocket_money_creatures_out.sql still has to build the
 * creatures from them. No database needed.
 */

const DIR = join(__dirname, "..", "docker");
const sqlOf = (f: string) => codeOnly(readFileSync(join(DIR, f), "utf8"), { sql: true });

/** What each file must only do before the creatures moved out. */
const GUARDED: Record<string, RegExp[]> = {
  "migration_pocket_money_best_tier.sql": [/ADD COLUMN best_tier\b/, /UPDATE public\.pocket_money_accounts\s+SET best_tier/, /SET last_seen_tier/],
  "migration_zzzzzzz_point_rewards.sql": [
    /ADD COLUMN IF NOT EXISTS reward_mode\b/,
    /ADD CONSTRAINT pocket_money_accounts_reward_mode_check/,
    /CREATE OR REPLACE FUNCTION public\.pocket_money_best_tier_only_climbs\(/,
    /CREATE TRIGGER pocket_money_accounts_best_tier_climbs/,
    /UPDATE public\.pocket_money_accounts SET best_tier = best_tier/,
    /ADD CONSTRAINT pocket_money_accounts_best_tier_range/,
  ],
  "migration_zzzzzzzz_pocket_money_avatar_style.sql": [/ADD COLUMN IF NOT EXISTS avatar_style\b/, /ADD CONSTRAINT pocket_money_accounts_avatar_style_check/],
  "migration_zzzzzzzz_pocket_money_avatar_style_look.sql": [/ADD COLUMN IF NOT EXISTS avatar_look\b/, /ADD CONSTRAINT pocket_money_accounts_avatar_look_check/],
};

/**
 * Whether the code at `at` runs only while `creatures` does not exist: inside
 * a DO block that returns once it does, or under
 * `IF to_regclass('public.creatures') IS NULL`, opened before `at` in the same
 * block.
 */
function guardedByCreatures(sql: string, at: number): boolean {
  for (const m of sql.matchAll(/\bDO\s+(\$[A-Za-z_]*\$)/g)) {
    const open = m.index! + m[0].length;
    const close = sql.indexOf(m[1], open);
    if (m.index! > at || close < at) continue;
    const before = sql.slice(open, at);
    if (/IF\s+to_regclass\('public\.creatures'\)\s+IS\s+NOT\s+NULL\s+THEN\s+RETURN;\s+END\s+IF;/i.test(before)) return true;
    if (/IF\s+to_regclass\('public\.creatures'\)\s+IS\s+NULL\b/i.test(before)) return true;
  }
  return false;
}

/** Every statement in GUARDED that is missing, or runs whether or not `creatures` exists. */
function unguarded(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [file, patterns] of Object.entries(GUARDED)) {
    const sql = files[file];
    for (const re of patterns) {
      const all = [...sql.matchAll(new RegExp(re.source, "g"))];
      if (all.length === 0) found.push(`${file}: ${re.source} not found`);
      for (const m of all) if (!guardedByCreatures(sql, m.index!)) found.push(`${file}: ${re.source} unguarded`);
    }
  }
  return found;
}

const files = Object.fromEntries(Object.keys(GUARDED).map((f) => [f, sqlOf(f)]));

test("the four migrations that add the creature's old account columns run only before `creatures` exists", () => {
  expect(unguarded(files)).toEqual([]);
});

test("guard the guard: without the guard, or with it closed early, the statement is reported", () => {
  const f = "migration_zzzzzzzz_pocket_money_avatar_style.sql";
  const without = { ...files, [f]: files[f].replace("IF to_regclass('public.creatures') IS NOT NULL THEN RETURN; END IF;", "") };
  expect(unguarded(without)).toEqual([
    `${f}: ${GUARDED[f][0].source} unguarded`,
    `${f}: ${GUARDED[f][1].source} unguarded`,
  ]);
  const bare = "ALTER TABLE public.pocket_money_accounts ADD COLUMN IF NOT EXISTS avatar_style TEXT;";
  const closedEarly = `DO $$ BEGIN IF to_regclass('public.creatures') IS NOT NULL THEN RETURN; END IF; END $$;\n${bare}`;
  expect(guardedByCreatures(closedEarly, closedEarly.indexOf("ADD COLUMN"))).toBe(false);
  const otherTable = `DO $$ BEGIN\n  IF to_regclass('public.people') IS NOT NULL THEN RETURN; END IF;\n  ${bare}\nEND $$;`;
  expect(guardedByCreatures(otherTable, otherTable.indexOf("ADD COLUMN"))).toBe(false);
});

test("creatures_out still builds the creatures from those columns, after all four", () => {
  const OUT = "migration_zzzzzzzz_pocket_money_creatures_out.sql";
  for (const f of Object.keys(GUARDED)) expect(f < OUT, f).toBe(true);
  const out = sqlOf(OUT);
  const create = out.indexOf("IF to_regclass('public.creatures') IS NULL THEN\n    CREATE TABLE public.creatures");
  expect(create).toBeGreaterThan(0);
  expect(out.slice(create, out.indexOf("END IF;", create))).toContain("PERFORM public.creatures_from_accounts(NULL);");
});
