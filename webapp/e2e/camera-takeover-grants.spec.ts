import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";
import { DB_CONTAINER, SKIP_WITHOUT_DATABASE, dbContainer } from "./whole-database";

/**
 * Only the server writes a camera takeover (#335).
 *
 * `camera_takeovers` is on the shared FOR ALL family policy, and the
 * Supabase image grants new tables to the browser roles, so a family's own
 * token could write its row straight through the database API: put any
 * camera on every screen with no `announcements:write`, past the 5-per-10-
 * minutes budget, for as long as it liked — a takeover ending in 100 years
 * was accepted. show_camera, on the service role, is the one way in.
 *
 * The screens still read the row, over realtime and the session route, so
 * SELECT is asserted to survive. And the 5-300 s range is a CHECK as well,
 * so whatever writes the row cannot keep a screen awake for good.
 */

const DOCKER = join(__dirname, "..", "docker");
const SELF = "migration_camera_takeovers.sql";
const migration = codeOnly(readFileSync(join(DOCKER, SELF), "utf8"), { sql: true });

test.describe("migration", () => {
  test("the browser roles lose every write on camera_takeovers, and keep SELECT", () => {
    const stmt = /REVOKE\s+([A-Z,\s]+?)\s+ON\s+(?:TABLE\s+)?public\.camera_takeovers\s+FROM\s+([a-z_,\s]+);/i.exec(migration);
    expect(stmt, "no REVOKE on public.camera_takeovers").not.toBeNull();
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(stmt![1].toUpperCase()).toContain(p);
    expect(stmt![2]).toMatch(/\banon\b/);
    expect(stmt![2]).toMatch(/\bauthenticated\b/);
    // Realtime checks SELECT before streaming a change to a screen.
    expect(migration).toMatch(/GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.camera_takeovers\s+TO\s+anon,\s*authenticated\s*;/i);
  });

  test("no migration that runs later grants a write back", () => {
    const later = readdirSync(DOCKER).filter((f) => /^migration.*\.sql$/.test(f) && f > SELF).sort();
    // Guard the guard: the RLS file, which puts the table on the family policy, sorts after this one.
    expect(later).toContain("migration_zz_row_level_security.sql");
    for (const f of later) {
      const code = codeOnly(readFileSync(join(DOCKER, f), "utf8"), { sql: true });
      expect(code, `${f} grants on camera_takeovers`).not.toMatch(/GRANT[^;]*\bcamera_takeovers\b/i);
      expect(code, `${f} grants on every table`).not.toMatch(/GRANT[^;]*ON\s+ALL\s+TABLES/i);
    }
  });

  test("the range is a CHECK, dropped and re-added so a re-run boot applies it", () => {
    const drop = migration.search(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+camera_takeovers_duration_check/i);
    const add = migration.search(/ADD\s+CONSTRAINT\s+camera_takeovers_duration_check\s+CHECK/i);
    expect(drop).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(drop);
    expect(migration).toMatch(/ends_at\s*>\s*started_at/i);
    expect(migration).toMatch(/ends_at\s*<=\s*started_at\s*\+\s*interval\s*'300 seconds'/i);
  });
});

/*
  Against the running database, after every migration has run: the grants as
  they really are, and the writes attempted as a family token and as the
  server. Everything happens inside BEGIN … ROLLBACK and leaves nothing behind.
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

  const OWN = "0f0f0f0f-0000-4000-8000-00000000ca70";
  const OTHER = "0f0f0f0f-0000-4000-8000-00000000ca71";
  const seed = `
    INSERT INTO families (id, name, join_code) VALUES
      ('${OWN}', 'claude-camera-own', 'CLCT' || upper(substr(md5(random()::text), 1, 6))),
      ('${OTHER}', 'claude-camera-other', 'CLCT' || upper(substr(md5(random()::text), 1, 6)));
    INSERT INTO camera_takeovers (family_id, camera_id, device_ids, started_at, ends_at) VALUES
      ('${OWN}', 'cam-door', '{}', now(), now() + interval '60 seconds'),
      ('${OTHER}', 'cam-theirs', '{}', now(), now() + interval '60 seconds');`;

  /** Runs `stmt` in a savepoint and reports whether the privilege layer refused it. */
  const attempt = (label: string, stmt: string) => `
    SAVEPOINT ${label};
    DO $$
    BEGIN
      ${stmt};
      RAISE NOTICE 'unreachable';
      PERFORM 1 / 0;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END $$;
    ROLLBACK TO ${label};
    SELECT '${label}:denied';`;

  test("anon and authenticated hold SELECT on camera_takeovers and nothing that writes", () => {
    expect(DB_CONTAINER).not.toBeNull();
    const rows = psql(`
      SELECT r || ':' || p || ':' || has_table_privilege(r, 'public.camera_takeovers', p)
      FROM unnest(ARRAY['anon','authenticated']) r,
           unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
      ORDER BY 1;`).split("\n");
    expect(rows).toEqual([
      "anon:DELETE:false",
      "anon:INSERT:false",
      "anon:SELECT:true",
      "anon:TRUNCATE:false",
      "anon:UPDATE:false",
      "authenticated:DELETE:false",
      "authenticated:INSERT:false",
      "authenticated:SELECT:true",
      "authenticated:TRUNCATE:false",
      "authenticated:UPDATE:false",
    ]);
  });

  test("a family token reads its own takeover and cannot write one", () => {
    const out = psql(`
      BEGIN;
      ${seed}
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"role":"authenticated","family_id":"${OWN}"}', true) IS NOT NULL;
      SELECT 'visible:' || string_agg(camera_id, ',' ORDER BY camera_id) FROM camera_takeovers;
      ${attempt("stretch", `UPDATE camera_takeovers SET ends_at = now() + interval '100 years' WHERE family_id = '${OWN}'`)}
      ${attempt("remove", `DELETE FROM camera_takeovers WHERE family_id = '${OWN}'`)}
      ${attempt("forge", `INSERT INTO camera_takeovers (family_id, camera_id, ends_at) VALUES ('${OWN}', 'cam-any', now() + interval '100 years') ON CONFLICT (family_id) DO UPDATE SET ends_at = EXCLUDED.ends_at`)}
      RESET ROLE;
      SELECT 'ends_in_seconds:' || round(extract(epoch FROM ends_at - now())) FROM camera_takeovers WHERE family_id = '${OWN}';
      ROLLBACK;`);
    expect(out).toContain("visible:cam-door");
    expect(out).not.toContain("cam-theirs");
    expect(out).toContain("stretch:denied");
    expect(out).toContain("remove:denied");
    expect(out).toContain("forge:denied");
    expect(out).not.toContain("unreachable");
    // Untouched: still the minute it was given, not a century.
    expect(Number(/ends_in_seconds:(-?\d+)/.exec(out)?.[1])).toBeLessThanOrEqual(60);
  });

  test("the server still writes it, inside the 5-300 s range and nowhere outside it", () => {
    const out = psql(`
      BEGIN;
      ${seed}
      SET LOCAL ROLE service_role;
      INSERT INTO camera_takeovers (family_id, camera_id, device_ids, started_at, ends_at)
        VALUES ('${OWN}', 'cam-garden', '{}', now(), now() + interval '300 seconds')
        ON CONFLICT (family_id) DO UPDATE SET camera_id = EXCLUDED.camera_id, ends_at = EXCLUDED.ends_at;
      SELECT 'upserted:' || camera_id FROM camera_takeovers WHERE family_id = '${OWN}';
      SAVEPOINT too_long;
      DO $$
      BEGIN
        UPDATE camera_takeovers SET ends_at = started_at + interval '100 years' WHERE family_id = '${OWN}';
        PERFORM 1 / 0;
      EXCEPTION WHEN check_violation THEN
        NULL;
      END $$;
      ROLLBACK TO too_long;
      SELECT 'too_long:refused';
      SAVEPOINT backwards;
      DO $$
      BEGIN
        UPDATE camera_takeovers SET ends_at = started_at WHERE family_id = '${OWN}';
        PERFORM 1 / 0;
      EXCEPTION WHEN check_violation THEN
        NULL;
      END $$;
      ROLLBACK TO backwards;
      SELECT 'backwards:refused';
      DELETE FROM camera_takeovers WHERE family_id = '${OWN}';
      SELECT 'remaining:' || count(*) FROM camera_takeovers WHERE family_id = '${OWN}';
      ROLLBACK;`);
    expect(out).toContain("upserted:cam-garden");
    expect(out).toContain("too_long:refused");
    expect(out).toContain("backwards:refused");
    expect(out).toContain("remaining:0");
  });
});
