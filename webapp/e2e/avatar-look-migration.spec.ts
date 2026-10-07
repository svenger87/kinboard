import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_zzzzzzzz_pocket_money_avatar_style_look.sql: every account gets
 * avatar_look '{}' -- the creature's own look, so nothing changes until a
 * child picks something -- and the column only ever holds a JSON object.
 *
 * The live part runs in one psql session inside BEGIN ... ROLLBACK, as the
 * avatar_style spec does: drop the column, seed an account, apply the
 * migration twice, probe the CHECK, roll everything back.
 */

const FILE = "migration_zzzzzzzz_pocket_money_avatar_style_look.sql";
const DIR = join(process.cwd(), "docker");
const MIGRATION = readFileSync(join(DIR, FILE), "utf8");

test.describe("the file", () => {
  test("sorts after every other migration that changes pocket_money_accounts", () => {
    const files = readdirSync(DIR).filter((f) => /^migration.*\.sql$/.test(f)).sort();
    const at = files.indexOf(FILE);
    expect(at).toBeGreaterThan(-1);
    const altering = files.filter((f) => f !== FILE && /ALTER TABLE (public\.)?pocket_money_accounts/.test(readFileSync(join(DIR, f), "utf8")));
    expect(altering).toContain("migration_zzzzzzzz_pocket_money_avatar_style.sql");
    for (const other of altering) expect(files.indexOf(other), `${other} must sort before ${FILE}`).toBeLessThan(at);
  });

  test("is safe to run twice", () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS avatar_look JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
    expect(MIGRATION).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'pocket_money_accounts_avatar_look_check'\)/);
    expect(MIGRATION).toMatch(/CHECK \(jsonb_typeof\(avatar_look\) = 'object'\)/);
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

  test("an existing account gets {}, a second run changes nothing, and only an object is accepted", () => {
    const fam = randomUUID();
    const kid = randomUUID();
    const acct = randomUUID();
    const reject = (value: string, tag: string) => `SAVEPOINT ${tag};
\\set ON_ERROR_STOP 0
UPDATE public.pocket_money_accounts SET avatar_look = ${value} WHERE id = '${acct}';
\\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT ${tag};
SELECT 'R|${tag}|' || :'LAST_ERROR_SQLSTATE';`;

    const out = psql(`BEGIN;
-- As on an install from before the creatures moved out (RFC-017): no
-- creatures table, no column yet. Rolled back below.
DROP TABLE public.creatures CASCADE;
ALTER TABLE public.pocket_money_accounts DROP CONSTRAINT IF EXISTS pocket_money_accounts_avatar_look_check;
ALTER TABLE public.pocket_money_accounts DROP COLUMN IF EXISTS avatar_look;
INSERT INTO public.families (id, name, join_code) VALUES ('${fam}', 'avatar-look-test', 'AL' || upper(substr(md5(random()::text), 1, 8)));
INSERT INTO public.people (id, family_id, name, is_child) VALUES ('${kid}', '${fam}', 'avatar-look-kid', true);
INSERT INTO public.pocket_money_accounts (id, family_id, person_id) VALUES ('${acct}', '${fam}', '${kid}');
${MIGRATION}
SELECT 'A|' || avatar_look::text FROM public.pocket_money_accounts WHERE id = '${acct}';
SELECT 'S1|' || ctid::text FROM public.pocket_money_accounts WHERE id = '${acct}';
${MIGRATION}
SELECT 'S2|' || ctid::text FROM public.pocket_money_accounts WHERE id = '${acct}';
SELECT 'K|' || count(*) FROM pg_constraint WHERE conname = 'pocket_money_accounts_avatar_look_check';
UPDATE public.pocket_money_accounts SET avatar_look = '{"name":"Funkel","body":"#FF8A5B"}' WHERE id = '${acct}';
SELECT 'OK|' || (avatar_look->>'name') FROM public.pocket_money_accounts WHERE id = '${acct}';
${reject(`'[]'::jsonb`, "arr")}
${reject(`'"x"'::jsonb`, "str")}
${reject(`'null'::jsonb`, "jnull")}
${reject("NULL", "sqlnull")}
SELECT 'Z|' || (avatar_look->>'name') FROM public.pocket_money_accounts WHERE id = '${acct}';
ROLLBACK;
`).split("\n");

    expect(out).toContain("A|{}");
    const s1 = out.find((l) => l.startsWith("S1|"));
    expect(s1).toBeTruthy();
    expect(out.find((l) => l.startsWith("S2|"))?.slice(3)).toBe(s1!.slice(3));
    expect(out).toContain("K|1");
    expect(out).toContain("OK|Funkel");
    expect(out).toContain("R|arr|23514");
    expect(out).toContain("R|str|23514");
    expect(out).toContain("R|jnull|23514");
    expect(out).toContain("R|sqlnull|23502");
    expect(out).toContain("Z|Funkel");

    expect(psql(`SELECT count(*) FROM public.families WHERE id = '${fam}';`)).toBe("0");
    // A rollback to this release after a later one dropped the column
    // (RFC-017 step 5): the creatures exist, and the file adds nothing back.
    expect(psql(`BEGIN;
ALTER TABLE public.pocket_money_accounts DROP CONSTRAINT IF EXISTS pocket_money_accounts_avatar_look_check;
ALTER TABLE public.pocket_money_accounts DROP COLUMN IF EXISTS avatar_look;
${MIGRATION}
SELECT count(*) FROM information_schema.columns WHERE table_name = 'pocket_money_accounts' AND column_name = 'avatar_look';
ROLLBACK;`)).toBe("0");
    expect(psql(`SELECT column_default FROM information_schema.columns WHERE table_name = 'pocket_money_accounts' AND column_name = 'avatar_look';`)).toBe("'{}'::jsonb");
  });
});
