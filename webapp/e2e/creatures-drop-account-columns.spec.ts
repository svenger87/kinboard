import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";
import {
  OLD_ACCOUNT_CREATURE_COLUMNS,
  creaturesFromOldAccounts,
  moveCreaturesOffOldAccounts,
} from "../src/lib/creatures/backup";

/**
 * RFC-017 §7 step 5: the creature's old columns leave pocket_money_accounts
 * (migration_zzzzzzzz_pocket_money_creatures_out_zz_drop.sql), with the
 * best_tier trigger, the account-keyed wrappers and creatures_from_accounts().
 *
 * Every migration re-runs on every boot. One that still adds a dropped column,
 * re-creates the trigger, or names the old columns where they are gone puts
 * them back -- empty -- or fails, on the boot after the drop. Each of those
 * statements must sit behind the marker "the creatures moved out": `creatures`
 * exists. This spec reads every migration for that, and the import's rule for
 * an old backup, without a database.
 */

const DIR = join(__dirname, "..", "docker");
const DROP = "migration_zzzzzzzz_pocket_money_creatures_out_zz_drop.sql";
const OUT = "migration_zzzzzzzz_pocket_money_creatures_out.sql";
const COLUMNS = [...OLD_ACCOUNT_CREATURE_COLUMNS];
/** Columns that exist nowhere but on the old account: a mention is a use. */
const ACCOUNT_ONLY = ["avatar_species", "avatar_style", "avatar_look", "reward_mode"];
const GONE_FUNCTIONS = ["point_account_totals", "request_point_redemption", "creatures_from_accounts", "pocket_money_best_tier_only_climbs"];

const migrations = readdirSync(DIR).filter((f) => /^migration.*\.sql$/.test(f)).sort();
const sqlOf = (f: string) => codeOnly(readFileSync(join(DIR, f), "utf8"), { sql: true });

/**
 * Whether the code at `at` in `sql` runs only while `creatures` does not
 * exist: inside a DO block that returns early once it does, or under an
 * `IF to_regclass('public.creatures') IS NULL`.
 */
function guardedByCreatures(sql: string, at: number): boolean {
  for (const m of sql.matchAll(/\bDO\s+(\$[A-Za-z_]*\$)/g)) {
    const start = m.index!;
    const open = start + m[0].length;
    const close = sql.indexOf(m[1], open);
    if (start > at || close < at) continue;
    const before = sql.slice(open, at);
    if (/IF\s+to_regclass\('public\.creatures'\)\s+IS\s+NOT\s+NULL\s+THEN\s+RETURN;\s+END\s+IF;/i.test(before)) return true;
    if (/IF\s+to_regclass\('public\.creatures'\)\s+IS\s+NULL\b/i.test(before)) return true;
  }
  return false;
}

/** Everything in the migrations that would bring the old account back. */
function unguardedRevivals(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [file, sql] of Object.entries(files)) {
    if (file === DROP) continue;
    const line = (at: number) => sql.slice(0, at).split("\n").length;
    // An ALTER TABLE on the account that adds one of the columns.
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?pocket_money_accounts\b[^;]*;/gi)) {
      for (const col of COLUMNS) {
        if (new RegExp(`ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${col}\\b`, "i").test(m[0]) && !guardedByCreatures(sql, m.index!)) {
          found.push(`${file}:${line(m.index!)} adds pocket_money_accounts.${col}`);
        }
      }
    }
    // The trigger, or a function that is gone.
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER\s+pocket_money_accounts_best_tier_climbs|FUNCTION\s+(?:public\.)?(\w+))/gi)) {
      if (m[1] && !GONE_FUNCTIONS.includes(m[1].toLowerCase())) continue;
      if (!guardedByCreatures(sql, m.index!)) found.push(`${file}:${line(m.index!)} creates ${m[1] ?? "the best_tier trigger"}`);
    }
    // Any other use of a column that exists only on the old account. The
    // table's own CREATE in migration_pocket_money.sql runs only when there is
    // no table yet -- a fresh install, before `creatures` -- and its clean-up
    // of an old avatar_species CHECK reads only the catalogue.
    if (file === "migration_pocket_money.sql") continue;
    for (const col of ACCOUNT_ONLY) {
      for (const m of sql.matchAll(new RegExp(`\\b${col}\\b`, "g"))) {
        if (!guardedByCreatures(sql, m.index!)) found.push(`${file}:${line(m.index!)} names ${col}`);
      }
    }
  }
  return found;
}

test.describe("the migrations", () => {
  const all = Object.fromEntries(migrations.map((f) => [f, sqlOf(f)]));

  test("none brings a dropped column, the trigger or a dropped function back once the creatures moved out", () => {
    expect(unguardedRevivals(all)).toEqual([]);
  });

  test("guard the guard: it sees the guarded adds, and an unguarded one is caught", () => {
    // The four files that add the columns are all read, and all guarded.
    const adds = Object.entries(all).flatMap(([f, sql]) =>
      [...sql.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(avatar_species|avatar_style|avatar_look|best_tier|reward_mode)\b/gi)].map((m) => `${f}:${m[1]}`));
    expect(adds.sort()).toEqual([
      "migration_pocket_money_best_tier.sql:best_tier",
      "migration_zzzzzzz_point_rewards.sql:reward_mode",
      "migration_zzzzzzzz_pocket_money_avatar_style.sql:avatar_style",
      "migration_zzzzzzzz_pocket_money_avatar_style_look.sql:avatar_look",
    ]);
    // The same statements, with the guard taken out, are reported.
    const bare = "ALTER TABLE public.pocket_money_accounts\n  ADD COLUMN IF NOT EXISTS avatar_style TEXT NOT NULL DEFAULT 'classic';\n";
    expect(unguardedRevivals({ "migration_x.sql": bare })).toEqual([
      "migration_x.sql:1 adds pocket_money_accounts.avatar_style",
      "migration_x.sql:2 names avatar_style",
    ]);
    const inOtherDo = `DO $$ BEGIN\n  IF to_regclass('public.people') IS NULL THEN RETURN; END IF;\n  ${bare}END $$;`;
    expect(unguardedRevivals({ "migration_x.sql": inOtherDo })).toHaveLength(2);
    const guarded = `DO $$ BEGIN\n  IF to_regclass('public.creatures') IS NOT NULL THEN RETURN; END IF;\n  ${bare}END $$;`;
    expect(unguardedRevivals({ "migration_x.sql": guarded })).toEqual([]);
    // A guard that closes before the statement does not cover it.
    const closedEarly = `DO $$ BEGIN\n  IF to_regclass('public.creatures') IS NOT NULL THEN RETURN; END IF;\nEND $$;\n${bare}`;
    expect(unguardedRevivals({ "migration_x.sql": closedEarly })).toHaveLength(2);
    expect(unguardedRevivals({ "migration_x.sql": "CREATE OR REPLACE FUNCTION public.point_account_totals(a UUID) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;" }))
      .toEqual(["migration_x.sql:1 creates point_account_totals"]);
    expect(unguardedRevivals({ "migration_x.sql": "CREATE TRIGGER pocket_money_accounts_best_tier_climbs BEFORE UPDATE OF best_tier ON x FOR EACH ROW EXECUTE FUNCTION f();" }))
      .toEqual(["migration_x.sql:1 creates the best_tier trigger"]);
  });

  test("the drop: after creatures_out and before the pocket-money revoke, in byte order and in an en_US glob", () => {
    const at = migrations.indexOf(DROP);
    expect(at).toBe(migrations.indexOf(OUT) + 1);
    expect(migrations.indexOf("migration_zzzzzzzz_pocket_money_server_only.sql")).toBeGreaterThan(at);
    // `./start.sh migrate` globs in the host's locale, and glibc's en_US
    // ignores the punctuation: "outzzdrop" still sorts after "outsql", where a
    // plain "_drop" would not. (ICU's default keeps punctuation, hence the option.)
    const glibc = new Intl.Collator("en-US", { ignorePunctuation: true });
    expect(glibc.compare(DROP, OUT)).toBeGreaterThan(0);
    expect(glibc.compare(DROP, "migration_zzzzzzzz_pocket_money_server_only.sql")).toBeLessThan(0);
    expect(glibc.compare(DROP.replace("_zz_drop", "_drop"), OUT), "guard the guard").toBeLessThan(0);
  });

  test("the drop takes all six columns, their CHECKs, the trigger and the functions, and only once the creatures exist", () => {
    const sql = sqlOf(DROP);
    const guard = sql.indexOf("IF to_regclass('public.creatures') IS NULL THEN");
    expect(guard).toBeGreaterThan(0);
    expect(sql.slice(guard, sql.indexOf("END IF;", guard))).toContain("RETURN;");
    for (const col of COLUMNS) expect(sql, col).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${col}[,;]`));
    for (const c of ["reward_mode_check", "best_tier_range", "avatar_style_check", "avatar_look_check"]) {
      expect(sql, c).toContain(`DROP CONSTRAINT IF EXISTS pocket_money_accounts_${c},`);
    }
    expect(sql).toContain("DROP TRIGGER IF EXISTS pocket_money_accounts_best_tier_climbs ON public.pocket_money_accounts;");
    for (const fn of GONE_FUNCTIONS) expect(sql, fn).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\(`));
    // Every drop after the guard, and the table lock only while a column is left.
    for (const stmt of ["DROP TRIGGER", "DROP COLUMN", "DROP FUNCTION"]) expect(sql.indexOf(stmt), stmt).toBeGreaterThan(guard);
    expect(sql.indexOf("IF EXISTS (\n    SELECT 1 FROM information_schema.columns")).toBeLessThan(sql.indexOf("ALTER TABLE public.pocket_money_accounts"));
    // Serialised with creatures_out's backfill: the same session lock.
    expect(sql).toContain("SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzz_pocket_money_creatures_out', 0));");
    expect(sql).toContain("SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzz_pocket_money_creatures_out', 0));");
    // It keeps what is not creature data.
    expect(sql).not.toMatch(/point_redemptions_fill_keys|account_id/);
  });

  test("creatures_out builds the creatures inline, in the statement that creates the table, and keeps no function for it", () => {
    const sql = sqlOf(OUT);
    const create = sql.indexOf("IF to_regclass('public.creatures') IS NULL THEN\n    CREATE TABLE public.creatures");
    expect(create).toBeGreaterThan(0);
    const block = sql.slice(create, sql.indexOf("END IF;", create));
    expect(block).toContain("INSERT INTO public.creatures");
    expect(block).toContain("FROM public.pocket_money_accounts a");
    expect(sql.match(/INSERT INTO public\.creatures/g)).toHaveLength(1);
    expect(sql).not.toMatch(/FUNCTION public\.(creatures_from_accounts|point_account_totals|request_point_redemption)\(/);
  });
});

test.describe("an old backup's creatures (/api/import)", () => {
  const FAMILY = "f0000000-0000-4000-8000-000000000001";
  const people = [
    { id: "p-money", family_id: FAMILY, is_child: true },
    { id: "p-points", family_id: FAMILY, is_child: true },
    { id: "p-odd", family_id: FAMILY, is_child: true },
    { id: "p-adult", family_id: FAMILY, is_child: false },
    { id: "p-none", family_id: FAMILY, is_child: true },
  ];
  const accounts = () => [
    // 1.12: species and stages only, never a style, a look or a mode.
    { id: "a1", family_id: FAMILY, person_id: "p-money", balance_cents: 2480, avatar_species: "turtle", best_tier: 4, last_seen_tier: 3 },
    // 1.13 before the move: points, drawn, dressed and named.
    { id: "a2", family_id: FAMILY, person_id: "p-points", balance_cents: 0, avatar_species: "unicorn", avatar_style: "sticker",
      avatar_look: { name: "Funkel", body: "#FF8A5B" }, best_tier: 3, last_seen_tier: 5, reward_mode: "points" },
    // Out of range, the wrong types, nothing at all.
    { id: "a3", family_id: FAMILY, person_id: "p-odd", balance_cents: 0, avatar_look: ["x"], best_tier: 99, last_seen_tier: 0, reward_mode: "stars" },
    // A grown-up's account: never had a creature on screen.
    { id: "a4", family_id: FAMILY, person_id: "p-adult", balance_cents: 0, avatar_species: "cat" },
  ];

  test("one creature per child with an account, by the migration's rule", () => {
    expect(creaturesFromOldAccounts({ people, pocket_money_accounts: accounts() })).toEqual([
      { person_id: "p-money", family_id: FAMILY, species: "turtle", style: "classic", look: {}, best_tier: 4, last_seen_tier: 3,
        grows_with: "money", shop_enabled: true, enabled: true },
      { person_id: "p-points", family_id: FAMILY, species: "unicorn", style: "sticker", look: { name: "Funkel", body: "#FF8A5B" },
        best_tier: 3, last_seen_tier: 5, grows_with: "points", shop_enabled: true, enabled: true },
      { person_id: "p-odd", family_id: FAMILY, species: "dragon", style: "classic", look: {}, best_tier: 8, last_seen_tier: 1,
        grows_with: "money", shop_enabled: true, enabled: true },
    ]);
  });

  test("switched off where the family had pocket money off; on where the setting says nothing, or something else", () => {
    const off = [{ family_id: FAMILY, key: "enabled_plugins", value: { "pocket-money": false, media: true } }];
    expect(creaturesFromOldAccounts({ people, pocket_money_accounts: accounts(), settings: off }).map((c) => c.enabled))
      .toEqual([false, false, false]);
    for (const value of [{ "pocket-money": true }, { media: false }, "false", null]) {
      const settings = [{ family_id: FAMILY, key: "enabled_plugins", value }];
      expect(creaturesFromOldAccounts({ people, pocket_money_accounts: accounts(), settings }).map((c) => c.enabled), JSON.stringify(value))
        .toEqual([true, true, true]);
    }
  });

  test("a backup without creatures gets them; every account loses the old fields, whichever release wrote it", () => {
    const data: Record<string, unknown[] | undefined> = { people, pocket_money_accounts: accounts() };
    moveCreaturesOffOldAccounts(data);
    expect(data.creatures).toHaveLength(3);
    for (const a of data.pocket_money_accounts as Record<string, unknown>[]) {
      for (const col of COLUMNS) expect(a, `${a.id} ${col}`).not.toHaveProperty(col);
    }
    // the rest of the account is untouched
    expect(data.pocket_money_accounts![0]).toEqual({ id: "a1", family_id: FAMILY, person_id: "p-money", balance_cents: 2480 });
  });

  test("a backup with creatures, even none, keeps exactly those, and still loses the old fields", () => {
    const own = [{ person_id: "p-points", family_id: FAMILY, species: "fox", style: "storybook", look: {}, best_tier: 2,
      last_seen_tier: 2, grows_with: "points", shop_enabled: false, enabled: false }];
    for (const creatures of [own, []]) {
      const data: Record<string, unknown[] | undefined> = { people, pocket_money_accounts: accounts(), creatures: structuredClone(creatures) };
      moveCreaturesOffOldAccounts(data);
      expect(data.creatures).toEqual(creatures);
      for (const a of data.pocket_money_accounts as Record<string, unknown>[]) {
        for (const col of COLUMNS) expect(a, `${a.id} ${col}`).not.toHaveProperty(col);
      }
    }
  });

  test("the import runs it before anything is inserted, and no longer asks the database", () => {
    const imp = codeOnly(readFileSync(join(__dirname, "..", "src/app/api/import/route.ts"), "utf8"));
    const at = imp.indexOf("moveCreaturesOffOldAccounts(payload.data);");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(imp.indexOf("for (const tableSpec of TABLE_SPECS)"));
    expect(imp).not.toContain("creatures_from_accounts");
    // the derived rows go through the creature spec: person remapped, style and look made restorable
    const spec = imp.slice(imp.indexOf('spec("creatures"'), imp.indexOf('spec("settings"'));
    expect(spec).toContain('requiredFks: ["person_id"]');
    expect(spec).toContain("row.style = restorableAvatarStyle(row.style)");
    expect(spec).toContain("row.look = restorableLook(row.look)");
  });
});
