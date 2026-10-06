import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_STYLES } from "../src/lib/pocket-money/creatures/styles";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_zzzzzzzz_pocket_money_avatar_style.sql: every account gets
 * avatar_style 'classic' -- so nothing changes until a child picks a look --
 * and the database takes only the four styles the app knows.
 *
 * The live part runs in one psql session inside BEGIN ... ROLLBACK: it drops
 * the column (as on an install that never had it), seeds an account, applies
 * the migration twice and probes the CHECK, then rolls everything back. It
 * holds the whole-database lock (./whole-database.ts) because the migration
 * alters a table every family shares.
 */

const FILE = "migration_zzzzzzzz_pocket_money_avatar_style.sql";
const DIR = join(process.cwd(), "docker");
const MIGRATION = readFileSync(join(DIR, FILE), "utf8");

test.describe("the file", () => {
  test("sorts after the last migration that changed pocket_money_accounts", () => {
    const files = readdirSync(DIR).filter((f) => /^migration.*\.sql$/.test(f)).sort();
    const at = files.indexOf(FILE);
    expect(at).toBeGreaterThan(-1);
    const touching = files.filter((f) => f !== FILE && /pocket_money_accounts/.test(readFileSync(join(DIR, f), "utf8")));
    for (const other of touching.filter((f) => /ALTER TABLE (public\.)?pocket_money_accounts/.test(readFileSync(join(DIR, f), "utf8")))) {
      expect(files.indexOf(other), `${other} must sort before ${FILE}`).toBeLessThan(at);
    }
  });

  test("is safe to run twice, and its CHECK lists exactly the app's styles", () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS avatar_style TEXT NOT NULL DEFAULT 'classic'/);
    expect(MIGRATION).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'pocket_money_accounts_avatar_style_check'\)/);
    const check = MIGRATION.match(/CHECK \(avatar_style IN \(([^)]*)\)\)/);
    expect(check).not.toBeNull();
    const values = check![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(values.sort()).toEqual([...AVATAR_STYLES].sort());
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

  test("an existing account becomes classic, a second run changes nothing, and only the four styles are accepted", () => {
    const fam = randomUUID();
    const kid = randomUUID();
    const acct = randomUUID();
    const probe = (value: string, tag: string) =>
      `UPDATE public.pocket_money_accounts SET avatar_style = '${value}' WHERE id = '${acct}';\nSELECT '${tag}|accepted';`;

    // Each accepted value, then a rejected one inside a savepoint we roll back to.
    const accepted = AVATAR_STYLES.map((v, i) => probe(v, `ok${i}`)).join("\n");
    const out = psql(`BEGIN;
ALTER TABLE public.pocket_money_accounts DROP CONSTRAINT IF EXISTS pocket_money_accounts_avatar_style_check;
ALTER TABLE public.pocket_money_accounts DROP COLUMN IF EXISTS avatar_style;
INSERT INTO public.families (id, name, join_code) VALUES ('${fam}', 'avatar-style-test', 'AS' || upper(substr(md5(random()::text), 1, 8)));
INSERT INTO public.people (id, family_id, name, is_child) VALUES ('${kid}', '${fam}', 'avatar-style-kid', true);
INSERT INTO public.pocket_money_accounts (id, family_id, person_id) VALUES ('${acct}', '${fam}', '${kid}');
${MIGRATION}
SELECT 'A|' || avatar_style FROM public.pocket_money_accounts WHERE id = '${acct}';
SELECT 'S1|' || ctid::text FROM public.pocket_money_accounts WHERE id = '${acct}';
${MIGRATION}
SELECT 'S2|' || ctid::text FROM public.pocket_money_accounts WHERE id = '${acct}';
SELECT 'K|' || count(*) FROM pg_constraint WHERE conname = 'pocket_money_accounts_avatar_style_check';
${accepted}
SAVEPOINT bad;
\\set ON_ERROR_STOP 0
UPDATE public.pocket_money_accounts SET avatar_style = 'neon' WHERE id = '${acct}';
\\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT bad;
SELECT 'R|neon|' || :'LAST_ERROR_SQLSTATE';
SAVEPOINT nul;
\\set ON_ERROR_STOP 0
UPDATE public.pocket_money_accounts SET avatar_style = NULL WHERE id = '${acct}';
\\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT nul;
SELECT 'R|null|' || :'LAST_ERROR_SQLSTATE';
SELECT 'Z|' || avatar_style FROM public.pocket_money_accounts WHERE id = '${acct}';
ROLLBACK;
`).split("\n");

    expect(out).toContain("A|classic");
    // The second run rewrites no row.
    const s1 = out.find((l) => l.startsWith("S1|"));
    expect(s1).toBeTruthy();
    expect(out.find((l) => l.startsWith("S2|"))?.slice(3)).toBe(s1!.slice(3));
    expect(out).toContain("K|1");
    AVATAR_STYLES.forEach((_, i) => expect(out).toContain(`ok${i}|accepted`));
    // 'neon' breaks the CHECK (23514), NULL the NOT NULL (23502), so the last
    // accepted value stands.
    expect(out).toContain("R|neon|23514");
    expect(out).toContain("R|null|23502");
    expect(out).toContain(`Z|${AVATAR_STYLES[AVATAR_STYLES.length - 1]}`);

    // Nothing left behind, and the real column is back as it was.
    expect(psql(`SELECT count(*) FROM public.families WHERE id = '${fam}';`)).toBe("0");
    expect(psql(`SELECT column_default FROM information_schema.columns WHERE table_name = 'pocket_money_accounts' AND column_name = 'avatar_style';`)).toBe("'classic'::text");
  });
});
