import { test, expect } from "@playwright/test";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

/**
 * webapp/docker/check-additive-migrations.mjs — the lint that keeps the
 * "an older image runs on the newer schema" promise (RFC-023 §4.11.4).
 *
 * Each case writes a throwaway migrations directory and allow-list and runs
 * the script as CI does, so what is tested is the exit status and message a
 * PR author would actually see.
 */

const SCRIPT = resolve(__dirname, "../docker/check-additive-migrations.mjs");

type Allow = { file: string; rules: string[]; reason: string; grandfathered?: boolean };

function lint(files: Record<string, string>, entries: Allow[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "additive-"));
  try {
    const mig = join(dir, "migrations");
    mkdirSync(mig);
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(mig, name), sql);
    const allow = join(dir, "allow.json");
    writeFileSync(allow, JSON.stringify({ entries }));
    const r = spawnSync(process.execPath, [SCRIPT, "--dir", mig, "--allowlist", allow], { encoding: "utf8" });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const REASON = "an older image never reads this column, checked in every release since";

test("the repository's own 88+ migrations pass with the committed allow-list", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/Migrations additive OK — \d+ files, 4 accepted exception/);
});

test.describe("refuses destructive statements in a new migration", () => {
  const cases: [string, string, string][] = [
    ["drop-column", "ALTER TABLE public.todos DROP COLUMN priority;", "DROP COLUMN"],
    ["drop-column", "ALTER TABLE public.todos DROP IF EXISTS priority;", "the COLUMN keyword is optional"],
    ["drop-column", "DO $$ BEGIN EXECUTE format('ALTER TABLE public.%I DROP COLUMN x', 'todos'); END $$;", "dynamic SQL"],
    ["alter-column-type", "ALTER TABLE public.todos ALTER COLUMN priority TYPE integer USING 0;", "ALTER … TYPE"],
    ["alter-column-type", "ALTER TABLE todos ALTER priority SET DATA TYPE text;", "SET DATA TYPE"],
    ["rename", "ALTER TABLE public.todos RENAME COLUMN title TO name;", "RENAME COLUMN"],
    ["rename", "ALTER TABLE public.todos RENAME TO tasks;", "RENAME TO"],
    ["rename", "ALTER TYPE public.mood RENAME VALUE 'sad' TO 'blue';", "RENAME VALUE"],
    ["delete-without-where", "DELETE FROM public.todos;", "unfiltered DELETE"],
    ["delete-without-where", "DO $$ BEGIN\n  DELETE FROM public.todos;\nEND $$;", "unfiltered DELETE in a DO block"],
    ["drop-table", "DROP TABLE IF EXISTS public.todos;", "DROP TABLE"],
    ["drop-object", "DROP TYPE public.mood;", "DROP TYPE"],
    ["drop-object", "DROP FUNCTION IF EXISTS public.f(int);", "DROP FUNCTION that is not re-created"],
    ["drop-object", "DROP VIEW public.v;", "DROP VIEW"],
    ["truncate", "TRUNCATE public.todos;", "TRUNCATE"],
    ["set-not-null", "ALTER TABLE public.todos ALTER COLUMN title SET NOT NULL;", "SET NOT NULL on an existing column"],
    ["add-not-null", "ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS owner uuid NOT NULL;", "NOT NULL with no default"],
  ];
  for (const [rule, sql, what] of cases) {
    test(`${rule}: ${what}`, () => {
      const r = lint({ "094_new.sql": `-- a new migration\n${sql}\n` });
      expect(r.code, r.out).toBe(1);
      // The line is the statement's own, after the comment on line 1.
      const line = sql.startsWith("DO $$ BEGIN\n") ? 3 : 2;
      expect(r.out).toContain(`094_new.sql:${line} [${rule}]`);
    });
  }
});

test("lets the common, harmless shapes through", () => {
  const sql = `
-- DROP COLUMN in a comment is just a comment; so is /* RENAME x TO y */
/* ALTER TABLE t DROP COLUMN c; */
DROP POLICY IF EXISTS todos_read ON public.todos;
CREATE POLICY todos_read ON public.todos FOR SELECT USING (true);
DROP TRIGGER IF EXISTS t1 ON public.todos;
DROP INDEX IF EXISTS public.todos_idx;
ALTER TABLE public.todos DROP CONSTRAINT IF EXISTS todos_kind_check;
ALTER TABLE public.todos ALTER COLUMN title DROP NOT NULL, ALTER COLUMN title DROP DEFAULT;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS size int NOT NULL DEFAULT 0;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS note text;
DROP FUNCTION IF EXISTS public.f(int, text);
CREATE OR REPLACE FUNCTION public.f(a int, b text, c int DEFAULT 0) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
CREATE OR REPLACE FUNCTION public.purge() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.todos WHERE deleted_at < now() - interval '30 days';
  RAISE NOTICE 'did not RENAME anything; TRUNCATE is revoked';
END $$;
DELETE FROM public.todos a USING public.todos b WHERE a.id < b.id;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.todos FROM anon;
CREATE TABLE IF NOT EXISTS public.fresh (id uuid PRIMARY KEY, name text);
ALTER TABLE public.fresh ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.fresh ADD COLUMN kind text NOT NULL;
CREATE TEMP TABLE _staging ON COMMIT DROP AS SELECT 1 AS x;
DROP TABLE IF EXISTS _staging;
`;
  const r = lint({ "094_new.sql": sql });
  expect(r.out).toContain("1 files, 0 accepted");
  expect(r.code, r.out).toBe(0);
});

test.describe("the escape hatch: a marker in the file and an entry in the allow-list", () => {
  const destructive = "-- not-additive: the column was never read by any release, see #999\nALTER TABLE public.todos DROP COLUMN legacy;\n";

  test("marker + matching entry passes", () => {
    const r = lint({ "094_new.sql": destructive }, [{ file: "094_new.sql", rules: ["drop-column"], reason: REASON }]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("1 accepted exception");
  });

  test("marker alone is not enough", () => {
    const r = lint({ "094_new.sql": destructive });
    expect(r.code).toBe(1);
    expect(r.out).toContain("has no entry in migrations-not-additive.json");
  });

  test("entry alone is not enough", () => {
    const r = lint(
      { "094_new.sql": "ALTER TABLE public.todos DROP COLUMN legacy;\n" },
      [{ file: "094_new.sql", rules: ["drop-column"], reason: REASON }],
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('has no "-- not-additive: <reason>" line');
  });

  test("an entry covers only the rules it names", () => {
    const r = lint(
      { "094_new.sql": destructive + "ALTER TABLE public.todos RENAME COLUMN a TO b;\n" },
      [{ file: "094_new.sql", rules: ["drop-column"], reason: REASON }],
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("094_new.sql:3 [rename]");
  });

  test("a rule the file no longer breaks is reported as stale", () => {
    const r = lint(
      { "094_new.sql": destructive },
      [{ file: "094_new.sql", rules: ["drop-column", "truncate"], reason: REASON }],
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('accepts "truncate", but the file no longer does that');
  });

  test("a new file cannot be grandfathered", () => {
    const r = lint(
      { "094_new.sql": "ALTER TABLE public.todos DROP COLUMN legacy;\n" },
      [{ file: "094_new.sql", rules: ["drop-column"], reason: REASON, grandfathered: true }],
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("only files up to 093 can be grandfathered");
  });

  test("an old file can, without a marker", () => {
    const r = lint(
      { "013_old.sql": "ALTER TABLE public.todos DROP COLUMN legacy;\n" },
      [{ file: "013_old.sql", rules: ["drop-column"], reason: REASON, grandfathered: true }],
    );
    expect(r.code, r.out).toBe(0);
  });

  test("an empty reason is refused", () => {
    const r = lint(
      { "094_new.sql": "-- not-additive:\nALTER TABLE public.todos DROP COLUMN legacy;\n" },
      [{ file: "094_new.sql", rules: ["drop-column"], reason: "" }],
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("needs a reason after the colon");
    expect(r.out).toContain('needs a "reason" a reviewer can judge');
  });

  test("an entry for a file that doesn't exist is refused", () => {
    const r = lint({ "094_new.sql": "SELECT 1;\n" }, [{ file: "095_gone.sql", rules: ["drop-column"], reason: REASON }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("095_gone.sql, which is not a migration file");
  });
});
