import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";
import { DB_CONTAINER, SKIP_WITHOUT_DATABASE, dbContainer } from "./whole-database";

/**
 * Only the server creates or deletes a family.
 *
 * Deleting a family cascades to everything it owns. The one intended way to do
 * it is DELETE /api/family, which needs a session and the family's name typed
 * back. The browser roles used to hold DELETE (and INSERT) on `families` under
 * a FOR ALL policy, so a family token could do the same thing through the
 * database API with no confirmation at all.
 *
 * The browser reads its own row and updates it (rename, new join code); those
 * must keep working, so they are asserted too.
 */

const DOCKER = join(__dirname, "..", "docker");
const SRC = join(__dirname, "..", "src");

const rls = codeOnly(readFileSync(join(DOCKER, "migration_zz_row_level_security.sql"), "utf8"), { sql: true });
const revoke = codeOnly(readFileSync(join(DOCKER, "migration_zzzzzz_families_server_only.sql"), "utf8"), { sql: true });

/** Every CREATE POLICY statement on public.families, as written. */
function familiesPolicies(sql: string): string[] {
  return [...sql.matchAll(/CREATE\s+POLICY\s+\w+\s+ON\s+(?:public\.)?families\b[^;]*;/gi)].map((m) => m[0]);
}

test.describe("migrations", () => {
  test("families policies cover only SELECT and UPDATE", () => {
    const policies = familiesPolicies(rls);
    // Guard the guard: a regex that stopped matching would pass vacuously.
    expect(policies.length).toBe(2);
    for (const p of policies) {
      expect(p, `families policy is not SELECT/UPDATE: ${p}`).toMatch(/\bFOR\s+(SELECT|UPDATE)\b/i);
      // Named *_family_scope, or the clean-up loop at the top of the file drops it every boot.
      expect(p).toMatch(/CREATE\s+POLICY\s+\w+_family_scope\b/i);
    }
  });

  test("the browser roles lose INSERT and DELETE on families", () => {
    const stmt = /REVOKE\s+([A-Z,\s]+?)\s+ON\s+(?:TABLE\s+)?public\.families\s+FROM\s+([a-z_,\s]+);/i.exec(revoke);
    expect(stmt, "no REVOKE on public.families").not.toBeNull();
    const privileges = stmt![1].toUpperCase();
    const roles = stmt![2];
    expect(privileges).toContain("DELETE");
    expect(privileges).toContain("INSERT");
    expect(roles).toMatch(/\banon\b/);
    expect(roles).toMatch(/\bauthenticated\b/);
  });

  test("the revoke sorts after every migration that touches families", () => {
    const self = "migration_zzzzzz_families_server_only.sql";
    const touching = readdirSync(DOCKER)
      .filter((f) => /^migration.*\.sql$/.test(f) && f !== self)
      // A foreign key to families (`REFERENCES public.families(id)`) grants
      // nothing on it, so a later table that belongs to a family need not
      // sort before the revoke; anything else naming the table does.
      .filter((f) => /\bpublic\.families\b|\bON\s+families\b|\bTABLE\s+families\b/i.test(
        codeOnly(readFileSync(join(DOCKER, f), "utf8"), { sql: true })
          .replace(/\bREFERENCES\s+public\.families\s*\(\s*id\s*\)/gi, "")))
      .sort();
    expect(touching).toContain("migration_zz_row_level_security.sql");
    for (const f of touching) expect(f < self, `${f} sorts after ${self}`).toBe(true);
  });
});

// Server-side helpers that delete a family with the service-role client they are
// handed. Each must be imported only from API routes; the test below checks it.
const SERVER_ONLY_FAMILY_DELETERS = [join(SRC, "lib", "family-create.ts")];

// A family is deleted through delete_family(), never a plain delete: only the
// function sets kinboard.hard_delete, without which the recycle bin's triggers
// leave the family's rows behind (#344). Granted to the service role alone.
const PLAIN_FAMILY_DELETE = /\.from\(\s*["']families["']\s*\)\s*\.delete\(/;
const DELETE_FAMILY_RPC = /\.rpc\(\s*["']delete_family["']/;

test("each allow-listed deleter deletes through delete_family", () => {
  for (const file of SERVER_ONLY_FAMILY_DELETERS) {
    const code = codeOnly(readFileSync(file, "utf8"));
    // Guard the guard: an entry that no longer deletes a family is stale.
    expect(code, `${file} no longer calls delete_family`).toMatch(DELETE_FAMILY_RPC);
    expect(code, `${file} deletes a family with a plain delete`).not.toMatch(PLAIN_FAMILY_DELETE);
  }
});

test("server-side family deleters are only imported from API routes", () => {
  const api = join(SRC, "app", "api");
  for (const file of SERVER_ONLY_FAMILY_DELETERS) {
    const mod = "@/" + file.slice(SRC.length + 1).replace(/\.tsx?$/, "");
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && path !== file && readFileSync(path, "utf8").includes(`"${mod}"`)) importers.push(path);
      }
    };
    walk(SRC);
    expect(importers.length, `${mod} has no importers`).toBeGreaterThan(0);
    for (const path of importers) expect(path.startsWith(api + "/"), `${path} imports ${mod}`).toBe(true);
  }
});

test("no browser code deletes a family", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        // API routes run on the server with the service role.
        if (path === join(SRC, "app", "api")) continue;
        walk(path);
      } else if (/\.(ts|tsx)$/.test(name) && !SERVER_ONLY_FAMILY_DELETERS.includes(path)) {
        const code = codeOnly(readFileSync(path, "utf8"));
        if (PLAIN_FAMILY_DELETE.test(code) || DELETE_FAMILY_RPC.test(code)) offenders.push(path);
      }
    }
  };
  walk(SRC);
  expect(offenders).toEqual([]);
});

/*
  Against the running database: the grants and policies as they actually are
  after every migration has run, and a DELETE attempted as a family token.
  Everything happens inside BEGIN … ROLLBACK, so it leaves nothing behind.
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

  test("anon and authenticated hold SELECT and UPDATE on families, not INSERT or DELETE", () => {
    expect(DB_CONTAINER).not.toBeNull();
    const rows = psql(`
      SELECT r || ':' || p || ':' || has_table_privilege(r, 'public.families', p)
      FROM unnest(ARRAY['anon','authenticated']) r,
           unnest(ARRAY['SELECT','UPDATE','INSERT','DELETE']) p
      ORDER BY 1;`).split("\n");
    expect(rows).toEqual([
      "anon:DELETE:false",
      "anon:INSERT:false",
      "anon:SELECT:true",
      "anon:UPDATE:true",
      "authenticated:DELETE:false",
      "authenticated:INSERT:false",
      "authenticated:SELECT:true",
      "authenticated:UPDATE:true",
    ]);
  });

  test("no families policy permits INSERT or DELETE", () => {
    const cmds = psql(`SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'families' ORDER BY cmd;`);
    expect(cmds.split("\n")).toEqual(["SELECT", "UPDATE"]);
  });

  test("a family token cannot delete its own family, but can read and rename it", () => {
    const own = "0f0f0f0f-0000-4000-8000-00000000c1a0";
    const other = "0f0f0f0f-0000-4000-8000-00000000c1a1";
    const out = psql(`
      BEGIN;
      INSERT INTO families (id, name, join_code) VALUES
        ('${own}', 'claude-grants-own', 'CLGR' || upper(substr(md5(random()::text), 1, 6))),
        ('${other}', 'claude-grants-other', 'CLGR' || upper(substr(md5(random()::text), 1, 6)));
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"role":"authenticated","family_id":"${own}"}', true) IS NOT NULL;
      SELECT 'visible:' || string_agg(name, ',' ORDER BY name) FROM families;
      UPDATE families SET name = 'claude-grants-renamed' WHERE id = '${own}';
      SELECT 'renamed:' || name FROM families WHERE id = '${own}';
      SAVEPOINT attempt;
      DO $$
      BEGIN
        DELETE FROM families WHERE id = '${own}';
        RAISE NOTICE 'unreachable';
        PERFORM 1 / 0;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'denied';
      END $$;
      ROLLBACK TO attempt;
      SELECT 'remaining:' || count(*) FROM families WHERE id = '${own}';
      ROLLBACK;`);
    expect(out).toContain("visible:claude-grants-own");
    expect(out).not.toContain("claude-grants-other");
    expect(out).toContain("renamed:claude-grants-renamed");
    expect(out).toContain("remaining:1");
  });
});
