import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * Deleting a family deletes all of it (#344).
 *
 * A plain DELETE on `families` cascades into the recycle-bin tables, and their
 * soft_delete() triggers turned every cascaded delete into a binning UPDATE:
 * the family's rows stayed behind pointing at nothing, and a task assigned to
 * someone already in the bin failed the delete with todos_family_id_fkey.
 * migration_zzzzzz_delete_family.sql adds delete_family(), which sets
 * kinboard.hard_delete for its transaction as purge_deleted() does, and
 * cleans up what earlier deletes left behind. Every caller goes through it.
 *
 * Source checks run anywhere; the database half skips without a stack.
 */

const SRC = join(__dirname, "..", "src");
const MIGRATION = join(__dirname, "..", "docker", "migration_zzzzzz_delete_family.sql");

/** The three places that delete a family: the route, and two rollbacks. */
const CALLERS = [
  join(SRC, "app", "api", "family", "route.ts"),
  join(SRC, "lib", "family-create.ts"),
  join(SRC, "app", "api", "import", "route.ts"),
];

test.describe("source", () => {
  test("nothing in webapp/src deletes a family with a plain delete", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const code = codeOnly(readFileSync(path, "utf8"));
          if (/\.from\(\s*["']families["']\s*\)\s*\.delete\(/.test(code)) offenders.push(path);
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  test("every caller deletes the family through delete_family", () => {
    for (const file of CALLERS) {
      const code = codeOnly(readFileSync(file, "utf8"));
      expect(code, `${file} does not call delete_family`).toMatch(
        /\.rpc\(\s*["']delete_family["']\s*,\s*\{\s*p_family_id\s*:/,
      );
    }
  });

  test("delete_family sets hard_delete for its transaction before it deletes", () => {
    const sql = codeOnly(readFileSync(MIGRATION, "utf8"), { sql: true });
    const fn = /CREATE OR REPLACE FUNCTION public\.delete_family\b[\s\S]*?END \$\$;/i.exec(sql);
    expect(fn, "no delete_family in the migration").not.toBeNull();
    const body = fn![0];
    const set = body.search(/set_config\(\s*'kinboard\.hard_delete'\s*,\s*'on'\s*,\s*true\s*\)/i);
    const del = body.search(/DELETE FROM public\.families/i);
    expect(set).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(set);
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/SET search_path = public, pg_temp/i);
  });
});

test.describe("database", () => {
  test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");
  test.beforeEach(acquireWholeDatabase);
  test.afterEach(releaseWholeDatabase);

  function psql(sql: string): string {
    return execFileSync(
      "docker",
      ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  }

  /** The migration as the entrypoint applies it, so the cleanup under test is the shipped SQL. */
  function applyMigration(): void {
    psql(readFileSync(MIGRATION, "utf8"));
  }

  const made: string[] = [];

  test.afterAll(async () => {
    if (made.length === 0) return;
    await acquireWholeDatabase();
    try {
      for (const id of made) psql(`SET ROLE service_role; SELECT public.delete_family('${id}');`);
    } finally {
      releaseWholeDatabase();
    }
  });

  interface Seeded {
    family: string;
    /** Every seeded row of a recycle-bin table, by table. */
    rows: Record<string, string[]>;
  }

  /**
   * A family with a row in every recycle-bin table, a person in the bin with
   * a task still assigned to them (Jorge's second case), and a binned note.
   */
  function seed(label: string): Seeded {
    const out = psql(`
      WITH f AS (
        INSERT INTO families (name, join_code)
        VALUES ('claude-family-delete-${label}', 'CFD' || upper(substr(md5(random()::text), 1, 7))) RETURNING id
      ), p AS (
        INSERT INTO people (family_id, name, color, is_child)
        SELECT id, n, '#123456', false FROM f, unnest(ARRAY['Live', 'Binned']) n RETURNING id, name, family_id
      ), t AS (
        INSERT INTO todos (family_id, title, person_id)
        SELECT family_id, 'assigned to ' || name, id FROM p RETURNING id
      ), n AS (
        INSERT INTO notes (family_id, content) SELECT id, x FROM f, unnest(ARRAY['kept', 'binned']) x RETURNING id
      ), b AS (
        INSERT INTO birthdays (family_id, name, date) SELECT id, 'B', DATE '2015-03-04' FROM f RETURNING id, family_id
      ), g AS (
        INSERT INTO birthday_gift_ideas (family_id, birthday_id, text) SELECT family_id, id, 'kite' FROM b RETURNING id
      ), s AS (
        INSERT INTO subjects (family_id, name) SELECT id, 'Maths' FROM f RETURNING id
      ), r AS (
        INSERT INTO recipes (family_id, title) SELECT id, 'Soup' FROM f RETURNING id
      ), mp AS (
        INSERT INTO meal_plans (family_id, week_start) SELECT id, date_trunc('week', now())::date FROM f RETURNING id
      ), me AS (
        INSERT INTO meal_plan_entries (meal_plan_id, date, meal_type, recipe_id)
        SELECT mp.id, date_trunc('week', now())::date, 'dinner', r.id FROM mp, r RETURNING id
      ), a AS (
        INSERT INTO pocket_money_accounts (family_id, person_id)
        SELECT family_id, id FROM p WHERE name = 'Live' RETURNING id
      ), pg AS (
        INSERT INTO pocket_money_goals (account_id, name, target_amount_cents) SELECT id, 'Bike', 5000 FROM a RETURNING id
      )
      SELECT json_build_object(
        'family', (SELECT id FROM f),
        'rows', json_build_object(
          'people', (SELECT json_agg(id) FROM p), 'todos', (SELECT json_agg(id) FROM t),
          'notes', (SELECT json_agg(id) FROM n), 'birthdays', (SELECT json_agg(id) FROM b),
          'birthday_gift_ideas', (SELECT json_agg(id) FROM g), 'subjects', (SELECT json_agg(id) FROM s),
          'recipes', (SELECT json_agg(id) FROM r), 'meal_plan_entries', (SELECT json_agg(id) FROM me),
          'pocket_money_goals', (SELECT json_agg(id) FROM pg)));`);
    const seeded = JSON.parse(out) as Seeded;
    made.push(seeded.family);
    // Into the bin, the way the app bins: a plain DELETE the trigger turns into an UPDATE.
    psql(`DELETE FROM people WHERE family_id = '${seeded.family}' AND name = 'Binned';
          DELETE FROM notes WHERE family_id = '${seeded.family}' AND content = 'binned';`);
    expect(psql(`SELECT count(*) FROM people WHERE family_id = '${seeded.family}' AND deleted_at IS NOT NULL;`)).toBe("1");
    expect(psql(`SELECT count(*) FROM todos t JOIN people p ON p.id = t.person_id
                  WHERE t.family_id = '${seeded.family}' AND p.deleted_at IS NOT NULL;`)).toBe("1");
    return seeded;
  }

  /** How many of the seeded rows are still in the database, per table. */
  function remaining(s: Seeded): Record<string, number> {
    const parts = Object.entries(s.rows).map(
      ([table, ids]) => `SELECT '${table}', count(*) FROM public.${table} WHERE id = ANY (ARRAY[${ids.map((id) => `'${id}'`).join(",")}]::uuid[])`,
    );
    const out: Record<string, number> = {};
    for (const line of psql(parts.join(" UNION ALL ") + ";").split("\n")) {
      const [table, n] = line.split("|");
      out[table] = Number(n);
    }
    return out;
  }

  const none = (s: Seeded) => Object.fromEntries(Object.keys(s.rows).map((t) => [t, 0]));
  const all = (s: Seeded) => Object.fromEntries(Object.entries(s.rows).map(([t, ids]) => [t, ids.length]));

  test("the seed covers every table the recycle bin's trigger is on", () => {
    const triggered = psql(`
      SELECT DISTINCT c.relname FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
       WHERE tg.tgfoid = 'public.soft_delete()'::regprocedure ORDER BY 1;`).split("\n");
    const s = seed("coverage");
    expect(Object.keys(s.rows).sort()).toEqual(triggered);
  });

  test("delete_family leaves nothing of the family behind, binned rows and a task for a binned person included", () => {
    applyMigration();
    const s = seed("whole");
    expect(remaining(s)).toEqual(all(s));
    // As the API calls it: the service role, through the function.
    const out = psql(`SET ROLE service_role; SELECT public.delete_family('${s.family}');`);
    expect(out).toBe("t");
    expect(psql(`SELECT count(*) FROM families WHERE id = '${s.family}';`)).toBe("0");
    expect(remaining(s)).toEqual(none(s));
    // Nothing left to delete the second time.
    expect(psql(`SET ROLE service_role; SELECT public.delete_family('${s.family}');`)).toBe("f");
  });

  test("a task assigned to someone in the bin no longer fails the delete", () => {
    applyMigration();
    const s = seed("binned-assignee");
    // Without the function this is the reported failure; with it, the family goes.
    expect(() => psql(`SET ROLE service_role; SELECT public.delete_family('${s.family}');`)).not.toThrow();
    expect(psql(`SELECT count(*) FROM todos WHERE family_id = '${s.family}';`)).toBe("0");
    expect(psql(`SELECT count(*) FROM people WHERE family_id = '${s.family}';`)).toBe("0");
  });

  test("the migration removes what earlier family deletes left behind, and nothing else", () => {
    applyMigration();
    const live = seed("cleanup-live");
    const gone = seed("cleanup-orphaned");
    // The old way, which needs nobody in the bin with a task to get through.
    psql(`UPDATE todos SET person_id = NULL WHERE family_id = '${gone.family}';
          DELETE FROM families WHERE id = '${gone.family}';`);
    // Guard the guard: the plain delete really did leave rows behind in every
    // table. Only what was already in the bin went (the trigger lets a second
    // delete through): the binned person and the binned note.
    expect(remaining(gone)).toEqual({ ...all(gone), people: 1, notes: 1 });
    expect(psql(`SELECT count(*) FROM todos WHERE family_id = '${gone.family}' AND deleted_at IS NOT NULL;`)).toBe("2");

    applyMigration();
    expect(remaining(gone)).toEqual(none(gone));
    expect(remaining(live)).toEqual(all(live));
    // Idempotent: a second boot finds nothing more to do and breaks nothing.
    applyMigration();
    expect(remaining(live)).toEqual(all(live));
  });

  test("only the service role can execute delete_family", () => {
    const rows = psql(`
      SELECT r || ':' || has_function_privilege(r, 'public.delete_family(uuid)', 'EXECUTE')
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r ORDER BY 1;`).split("\n");
    expect(rows).toEqual(["anon:false", "authenticated:false", "service_role:true"]);

    const s = seed("grants");
    for (const role of ["anon", "authenticated"]) {
      // Notices go to stderr, so read both streams.
      const run = spawnSync(
        "docker",
        ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"],
        {
          input: `
            BEGIN;
            SET LOCAL ROLE ${role};
            SELECT set_config('request.jwt.claims', '{"role":"${role}","family_id":"${s.family}"}', true) IS NOT NULL;
            DO $$
            BEGIN
              PERFORM public.delete_family('${s.family}');
              RAISE NOTICE 'unreachable';
            EXCEPTION WHEN insufficient_privilege THEN
              RAISE NOTICE 'denied';
            END $$;
            COMMIT;`,
          encoding: "utf8",
        },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(run.stderr, role).toContain("denied");
      expect(run.stderr, role).not.toContain("unreachable");
      expect(psql(`SELECT count(*) FROM families WHERE id = '${s.family}';`), role).toBe("1");
    }
  });
});
