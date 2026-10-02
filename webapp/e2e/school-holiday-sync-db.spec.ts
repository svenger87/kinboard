import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "child_process";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_zzzzz_school_holiday_sync.sql and apply_school_holiday_sync()
 * against a real database (RFC-014 §5.1, §5.2, §6.2, §12). The rule these
 * protect: nothing fetched can delete, edit or hide anything the family made.
 */

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function applyMigration(): void {
  execFileSync("bash", ["-c",
    `docker exec -i ${dbContainer()} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < webapp/docker/migration_zzzzz_school_holiday_sync.sql`],
    { cwd: process.cwd().replace(/\/webapp$/, ""), encoding: "utf8" });
}

test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");
test.beforeEach(acquireWholeDatabase);
test.afterEach(releaseWholeDatabase);

const families: string[] = [];
function makeFamily(): string {
  const id = psql(`INSERT INTO families (name, join_code) VALUES ('school-sync-test', 'SS' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`);
  families.push(id);
  return id;
}
test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    for (const id of families) psql(`DELETE FROM families WHERE id = '${id}';`);
  } finally {
    releaseWholeDatabase();
  }
});

type Row = { external_id: string; name: string; starts_on: string; ends_on: string };
const sync = (family: string, rows: Row[], replace = false, from = "2026-09-01", to = "2029-08-31") =>
  psql(`SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb, '${from}', '${to}', ${replace});`);
/** Every row of the family, as text, in a fixed order: "byte-identical" means this string. */
const table = (family: string) =>
  psql(`SELECT string_agg(concat_ws('|', source, coalesce(external_id, '-'), name, starts_on, ends_on, hidden, updated_at), E'\\n' ORDER BY source, name, starts_on)
        FROM school_holidays WHERE family_id = '${family}';`);
const manual = (family: string, name: string, from: string, to: string) =>
  psql(`INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES ('${family}', '${name}', '${from}', '${to}');`);

const HERBST: Row = { external_id: "oh-herbst", name: "Herbstferien", starts_on: "2026-10-12", ends_on: "2026-10-24" };
const WEIHNACHT: Row = { external_id: "oh-weihnacht", name: "Weihnachtsferien", starts_on: "2026-12-23", ends_on: "2027-01-06" };

test("a manual row cannot carry an external id, and a synced row must", () => {
  const family = makeFamily();
  expect(() => psql(`INSERT INTO school_holidays (family_id, name, starts_on, ends_on, external_id) VALUES ('${family}', 'x', '2026-10-01', '2026-10-02', 'oh-1');`)).toThrow();
  expect(() => psql(`INSERT INTO school_holidays (family_id, name, starts_on, ends_on, source) VALUES ('${family}', 'x', '2026-10-01', '2026-10-02', 'openholidays');`)).toThrow();
  expect(() => psql(`INSERT INTO school_holidays (family_id, name, starts_on, ends_on, source) VALUES ('${family}', 'x', '2026-10-01', '2026-10-02', 'feed');`)).toThrow();
});

test("first sync inserts; an identical second one changes nothing a family can see", () => {
  const family = makeFamily();
  expect(JSON.parse(sync(family, [HERBST, WEIHNACHT]))).toEqual({ deleted: 0, upserted: 2 });
  const before = table(family);
  sync(family, [HERBST, WEIHNACHT]);
  expect(table(family)).toBe(before);
});

test("a row gone from the response is deleted inside the window and kept before it", () => {
  const family = makeFamily();
  const old: Row = { external_id: "oh-old", name: "Sommerferien", starts_on: "2026-07-02", ends_on: "2026-08-12" };
  sync(family, [old, HERBST, WEIHNACHT], false, "2026-06-01", "2029-05-31");
  // The next run's window starts after the summer holidays ended.
  sync(family, [WEIHNACHT]);
  expect(psql(`SELECT string_agg(external_id, ',' ORDER BY external_id) FROM school_holidays WHERE family_id = '${family}';`)).toBe("oh-old,oh-weihnacht");
});

test("a manual row with the same name and dates as a fetched one survives every path", () => {
  const family = makeFamily();
  manual(family, HERBST.name, HERBST.starts_on, HERBST.ends_on);
  const mine = () => psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${family}' AND source = 'manual' AND name = 'Herbstferien';`);
  sync(family, [HERBST]);          // insert
  sync(family, [HERBST]);          // identical
  sync(family, []);                // missing from the response, inside the window
  sync(family, [WEIHNACHT], true); // switched off and on, or a new school region
  sync(family, [], true);          // switched off
  expect(mine()).toBe("1");
  expect(psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${family}' AND source = 'openholidays';`)).toBe("0");
});

test("hidden survives an upsert, and replacing clears it with the row", () => {
  const family = makeFamily();
  sync(family, [HERBST]);
  psql(`UPDATE school_holidays SET hidden = true WHERE family_id = '${family}' AND external_id = 'oh-herbst';`);
  sync(family, [{ ...HERBST, name: "Herbstferien 2026" }]);
  expect(psql(`SELECT name || '|' || hidden FROM school_holidays WHERE family_id = '${family}' AND external_id = 'oh-herbst';`)).toBe("Herbstferien 2026|true");
  sync(family, [HERBST], true);
  expect(psql(`SELECT hidden FROM school_holidays WHERE family_id = '${family}' AND external_id = 'oh-herbst';`)).toBe("f");
});

test("one family's sync cannot reach another family's rows", () => {
  const ours = makeFamily();
  const theirs = makeFamily();
  sync(theirs, [HERBST]);
  manual(theirs, "Ihre Ferien", "2026-11-02", "2026-11-03");
  const before = table(theirs);
  sync(ours, [], true);
  sync(ours, [WEIHNACHT]);
  expect(table(theirs)).toBe(before);
});

test("a bad row fails the whole write, leaving the table as it was", () => {
  const family = makeFamily();
  sync(family, [HERBST]);
  const before = table(family);
  expect(() => sync(family, [WEIHNACHT, { external_id: "oh-bad", name: "x", starts_on: "2027-02-10", ends_on: "2027-02-01" }])).toThrow();
  expect(table(family)).toBe(before);
});

test("only the service role may call the function", () => {
  const signature = "public.apply_school_holiday_sync(uuid, jsonb, date, date, boolean)";
  for (const role of ["anon", "authenticated"]) {
    expect(psql(`SELECT has_function_privilege('${role}', '${signature}', 'EXECUTE');`), role).toBe("f");
  }
  expect(psql(`SELECT has_function_privilege('service_role', '${signature}', 'EXECUTE');`)).toBe("t");
});

test("the browser roles are held to manual rows by restrictive policies", () => {
  const policies = psql(`SELECT string_agg(policyname || ':' || permissive || ':' || cmd, ',' ORDER BY policyname)
    FROM pg_policies WHERE tablename = 'school_holidays' AND policyname LIKE 'school_holidays_manual_%';`);
  expect(policies).toBe("school_holidays_manual_delete:RESTRICTIVE:DELETE,school_holidays_manual_insert:RESTRICTIVE:INSERT,school_holidays_manual_update:RESTRICTIVE:UPDATE");
});

test("only a synced row can be hidden", () => {
  const family = makeFamily();
  expect(() => psql(`INSERT INTO school_holidays (family_id, name, starts_on, ends_on, hidden) VALUES ('${family}', 'x', '2026-10-01', '2026-10-02', true);`))
    .toThrow(/school_holidays_hidden_synced_only/);
  manual(family, "Mine", "2026-10-01", "2026-10-02");
  expect(() => psql(`UPDATE school_holidays SET hidden = true WHERE family_id = '${family}';`)).toThrow(/school_holidays_hidden_synced_only/);
});

/**
 * As the browser: `authenticated` with the family's claim, the way PostgREST
 * runs a request. Everything runs inside one transaction that is rolled back.
 * `dropPolicies` simulates the boot window, when migration_zz_row_level_security.sql
 * has swept the restrictive policies and this file has not yet put them back.
 */
const asBrowser = (family: string, sql: string, dropPolicies = false) =>
  psql(`BEGIN;
    ${dropPolicies ? ["insert", "update", "delete"].map((c) => `DROP POLICY school_holidays_manual_${c} ON public.school_holidays;`).join(" ") : ""}
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"family_id":"${family}","role":"authenticated"}', true) IS NULL;
    ${sql}
    ROLLBACK;`);

for (const dropPolicies of [false, true]) {
  const when = dropPolicies ? "while the policies are missing" : "with the policies in place";

  test(`the browser writes its own manual rows ${when}`, () => {
    const family = makeFamily();
    const out = asBrowser(family, `
      INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES ('${family}', 'browser', '2026-10-01', '2026-10-02');
      UPDATE school_holidays SET name = 'browser-edited' WHERE family_id = '${family}' AND name = 'browser';
      DELETE FROM school_holidays WHERE family_id = '${family}' AND name = 'browser-edited';
      SELECT 'manual-ok';`, dropPolicies);
    expect(out).toContain("manual-ok");
  });

  test(`the browser cannot forge, adopt, edit or delete a synced row ${when}`, () => {
    const family = makeFamily();
    sync(family, [HERBST]);
    manual(family, "Mine", "2026-11-01", "2026-11-02");
    const before = table(family);
    const refused = dropPolicies ? /only manual rows/ : /row-level security|only manual rows/;
    expect(() => asBrowser(family, `INSERT INTO school_holidays (family_id, name, starts_on, ends_on, source, external_id) VALUES ('${family}', 'forged', '2026-10-01', '2026-10-02', 'openholidays', 'forged');`, dropPolicies)).toThrow(refused);
    expect(() => asBrowser(family, `UPDATE school_holidays SET source = 'openholidays', external_id = 'adopted' WHERE family_id = '${family}' AND name = 'Mine';`, dropPolicies)).toThrow(refused);
    for (const write of [
      `UPDATE school_holidays SET hidden = true WHERE external_id = 'oh-herbst' AND family_id = '${family}'`,
      `UPDATE school_holidays SET name = 'renamed' WHERE external_id = 'oh-herbst' AND family_id = '${family}'`,
      `DELETE FROM school_holidays WHERE external_id = 'oh-herbst' AND family_id = '${family}'`,
    ]) {
      if (dropPolicies) {
        expect(() => asBrowser(family, `${write};`, dropPolicies), write).toThrow(/only manual rows/);
      } else {
        // The restrictive USING hides the row: nothing to change, nothing changed.
        expect(asBrowser(family, `WITH w AS (${write} RETURNING 1) SELECT 'touched:' || count(*) FROM w;`), write).toContain("touched:0");
      }
    }
    expect(table(family)).toBe(before);
    expect(psql(`SELECT count(*) FROM pg_policies WHERE tablename = 'school_holidays' AND policyname LIKE 'school_holidays_manual_%';`)).toBe("3");
  });
}

test("the service role still syncs, and a family's synced rows go with the family", () => {
  const family = makeFamily();
  const out = psql(`BEGIN; SET LOCAL ROLE service_role;
    SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([HERBST])}'::jsonb, '2026-09-01', '2029-08-31', false);
    UPDATE school_holidays SET hidden = true WHERE family_id = '${family}' AND external_id = 'oh-herbst';
    COMMIT;`);
  expect(out).toContain('"upserted": 1');
  expect(psql(`SELECT hidden FROM school_holidays WHERE family_id = '${family}';`)).toBe("t");
  psql(`DELETE FROM families WHERE id = '${family}';`);
  expect(psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${family}';`)).toBe("0");
});

test("deleting a family takes its synced rows even when the owner does not bypass RLS", () => {
  const family = makeFamily();
  sync(family, [HERBST]);
  manual(family, "Mine", "2026-11-01", "2026-11-02");
  // ALTER ROLE is transactional: the owner loses BYPASSRLS only inside this
  // rolled-back transaction. supabase_admin, because postgres may not alter itself.
  const out = execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "supabase_admin", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1", "-c",
    `BEGIN;
     ALTER ROLE postgres NOBYPASSRLS;
     SET LOCAL ROLE authenticated;
     SELECT set_config('request.jwt.claims', '{"family_id":"${family}","role":"authenticated"}', true) IS NULL;
     DELETE FROM families WHERE id = '${family}';
     RESET ROLE;
     SELECT 'left:' || count(*) FROM school_holidays WHERE family_id = '${family}';
     ROLLBACK;`], { encoding: "utf8" });
  expect(out).toContain("left:0");
  // Outside a cascade the same delete is still the browser's to be refused.
  expect(() => asBrowser(family, `DELETE FROM school_holidays WHERE external_id = 'oh-herbst' AND family_id = '${family}';`, true)).toThrow(/only manual rows/);
});

test("two syncs for one family take turns", async () => {
  const family = makeFamily();
  const other = makeFamily();
  const key = (f: string) => `hashtextextended('school_holiday_sync:' || '${f}', 0)`;
  // Connection A syncs and holds its transaction open.
  const a = spawn("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1", "-c",
    `BEGIN; SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([HERBST])}'::jsonb, '2026-09-01', '2029-08-31', false); SELECT pg_sleep(4); COMMIT;`]);
  const done = new Promise<number>((resolve) => a.on("exit", (code) => resolve(code ?? -1)));
  try {
    const held = () => psql(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 1
      AND ((classid::bigint << 32) | objid::bigint) = ${key(family)};`);
    for (let i = 0; i < 50 && held() !== "1"; i++) await new Promise((r) => setTimeout(r, 100));
    expect(held()).toBe("1");
    // Connection B: the same family's sync waits for A (and gives up here
    // after half a second); another family's does not.
    expect(() => psql(`SET lock_timeout = '500ms'; SELECT public.apply_school_holiday_sync('${family}', '[]'::jsonb, '2026-09-01', '2029-08-31', true);`))
      .toThrow(/lock timeout/);
    expect(psql(`SET lock_timeout = '500ms'; SELECT public.apply_school_holiday_sync('${other}', '[]'::jsonb, '2026-09-01', '2029-08-31', true);`))
      .toContain('"deleted": 0');
  } finally {
    expect(await done).toBe(0);
  }
  expect(psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${family}';`)).toBe("1");
});

/*
 * Last on purpose. It re-applies the migration, which would quietly repair a
 * trigger, constraint or policy someone removed by hand to see a test above
 * go red. The tests in this file run in order on one worker, under the
 * whole-database lock, so running it last is enough.
 */
test("the migration is idempotent and every existing row is manual", () => {
  const family = makeFamily();
  manual(family, "Sommerferien", "2026-07-02", "2026-08-12");
  applyMigration();
  applyMigration();
  expect(psql(`SELECT source || '|' || hidden || '|' || coalesce(external_id, '-') FROM school_holidays WHERE family_id = '${family}';`)).toBe("manual|false|-");
});

