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

const SETTING = {
  enabled: true, region: "DE-NI", group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null,
};
const families: string[] = [];
function makeFamily(): string {
  const id = psql(`INSERT INTO families (name, join_code) VALUES ('school-sync-test', 'SS' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`);
  families.push(id);
  // Switched on for DE-NI: the function writes only for a choice the family holds.
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${id}', 'school_holiday_sync', '${JSON.stringify(SETTING)}'::jsonb);`);
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
const ARGS = (replace: boolean) => (replace ? "true, NULL, NULL, NULL, NULL" : "false, 'DE-NI', NULL, now(), 'de'");
const sync = (family: string, rows: Row[], replace = false, from = "2026-09-01", to = "2029-08-31") =>
  psql(`SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb, '${from}', '${to}', ${ARGS(replace)});`);
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
  expect(JSON.parse(sync(family, [HERBST, WEIHNACHT]))).toEqual({ superseded: false, deleted: 0, upserted: 2 });
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

test("a sync for a choice the family no longer holds writes nothing, and records nothing", () => {
  const family = makeFamily();
  manual(family, HERBST.name, HERBST.starts_on, HERBST.ends_on);
  const before = table(family);
  const setting = () => psql(`SELECT value::text FROM settings WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
  const call = (region: string, group: string) =>
    psql(`SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([HERBST])}'::jsonb, '2026-09-01', '2029-08-31', false, ${region}, ${group}, now(), 'de');`);
  expect(call("'DE-HB'", "NULL")).toContain('"superseded": true');
  expect(call("'DE-NI'", "'DE-NI-X'")).toContain('"superseded": true');
  for (const change of ['{"enabled": false}', '{"pending": "group"}', '"not an object"']) {
    psql(`UPDATE settings SET value = ${change.startsWith('"') ? `'${change}'::jsonb` : `value || '${change}'::jsonb`} WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
    const now = setting();
    expect(call("'DE-NI'", "NULL"), change).toContain('"superseded": true');
    expect(setting(), change).toBe(now);
    psql(`UPDATE settings SET value = '${JSON.stringify(SETTING)}'::jsonb WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
  }
  psql(`DELETE FROM settings WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
  expect(call("'DE-NI'", "NULL")).toContain('"superseded": true');
  expect(table(family)).toBe(before);
});

test("a success is recorded with the rows; an error is merged into the setting as it is", () => {
  const family = makeFamily();
  const setting = () => JSON.parse(psql(`SELECT value::text FROM settings WHERE family_id = '${family}' AND key = 'school_holiday_sync';`));
  const recordError = (at: string, error: string, expect = "'DE-NI', NULL") =>
    psql(`SELECT public.record_school_holiday_sync_error('${family}', ${at}, '${error}', ${expect});`);
  recordError("'2026-10-01T08:00:00Z'", "OpenHolidays answered 502");
  expect(setting()).toEqual({ ...SETTING, last_error_at: "2026-10-01T08:00:00.000Z", last_error: "OpenHolidays answered 502" });
  psql(`SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([HERBST])}'::jsonb, '2026-09-01', '2029-08-31', false, 'DE-NI', NULL, '2026-10-02T10:00:00.123Z', 'de');`);
  expect(setting()).toEqual({ ...SETTING, last_success_at: "2026-10-02T10:00:00.123Z", language: "de" });
  // Without a choice to compare (the failure came before the setting was read) it is merged as it is.
  psql(`UPDATE settings SET value = value || '{"enabled": false}'::jsonb WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
  recordError("'2026-10-03T08:00:00Z'", "x".repeat(600), "NULL, NULL");
  expect(setting()).toMatchObject({ enabled: false, last_error_at: "2026-10-03T08:00:00.000Z", last_error: "x".repeat(500) });
  psql(`DELETE FROM settings WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
  expect(recordError("now()", "x")).toBe("f");
  expect(psql(`SELECT count(*) FROM settings WHERE family_id = '${family}';`)).toBe("0");
});

test("an error for a choice the family no longer holds is not recorded (final review #4)", () => {
  const family = makeFamily();
  const setting = () => psql(`SELECT value::text FROM settings WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
  const recordError = (expect: string) =>
    psql(`SELECT public.record_school_holiday_sync_error('${family}', '2026-10-01T08:00:00Z', 'down', ${expect});`);
  const before = setting();
  // Another region, another group, or switched off since the request went out.
  expect(recordError("'DE-HB', NULL")).toBe("f");
  expect(recordError("'DE-NI', 'DE-NI-X'")).toBe("f");
  psql(`UPDATE settings SET value = value || '{"enabled": false}'::jsonb WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
  const off = setting();
  expect(recordError("'DE-NI', NULL")).toBe("f");
  expect(setting()).toBe(off);
  psql(`UPDATE settings SET value = '${JSON.stringify(SETTING)}'::jsonb WHERE family_id = '${family}' AND key = 'school_holiday_sync';`);
  expect(setting()).toBe(before);
  // The choice it was for: recorded.
  expect(recordError("'DE-NI', NULL")).toBe("t");
  expect(JSON.parse(setting())).toMatchObject({ last_error_at: "2026-10-01T08:00:00.000Z", last_error: "down" });
});

test("a success records the language the names were fetched in, and needs one", () => {
  const family = makeFamily();
  const setting = () => JSON.parse(psql(`SELECT value::text FROM settings WHERE family_id = '${family}' AND key = 'school_holiday_sync';`));
  const call = (language: string) =>
    psql(`SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([HERBST])}'::jsonb, '2026-09-01', '2029-08-31', false, 'DE-NI', NULL, '2026-10-02T10:00:00Z', ${language});`);
  call("'en'");
  expect(setting()).toMatchObject({ last_success_at: "2026-10-02T10:00:00.000Z", language: "en" });
  call("'de'");
  expect(setting()).toMatchObject({ language: "de" });
  const before = table(family);
  for (const bad of ["NULL", "''", "'deutsch'", "'DE'"]) {
    expect(() => call(bad), bad).toThrow(/p_language must be a two-letter language code/);
  }
  expect(setting()).toMatchObject({ language: "de" });
  expect(table(family)).toBe(before);
  // A replace (switch off, new region) names no language: it fetched nothing.
  expect(psql(`SELECT public.apply_school_holiday_sync('${family}', '[]'::jsonb, '1970-01-01', '1970-01-01', true, NULL, NULL, NULL, NULL);`)).toContain('"superseded": false');
});

test("a re-sync in another language rewrites the names of the rows it already has", () => {
  const family = makeFamily();
  const names = () => psql(`SELECT string_agg(external_id || '=' || name, ',' ORDER BY starts_on) FROM school_holidays WHERE family_id = '${family}';`);
  const ids = () => psql(`SELECT string_agg(id::text, ',' ORDER BY starts_on) FROM school_holidays WHERE family_id = '${family}';`);
  const hide = () => psql(`UPDATE school_holidays SET hidden = true WHERE family_id = '${family}' AND external_id = 'oh-weihnacht';`);
  // What prod held: the same breaks, fetched in English before rc.3.
  psql(`SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([{ ...HERBST, name: "Autumn Holidays" }, { ...WEIHNACHT, name: "Christmas Holidays" }])}'::jsonb, '2026-09-01', '2029-08-31', false, 'DE-NI', NULL, now(), 'en');`);
  hide();
  expect(names()).toBe("oh-herbst=Autumn Holidays,oh-weihnacht=Christmas Holidays");
  const before = ids();
  const stamp = () => psql(`SELECT string_agg(updated_at::text, ',' ORDER BY starts_on) FROM school_holidays WHERE family_id = '${family}';`);
  const stampedBefore = stamp();
  psql(`SELECT pg_sleep(0.01);`);
  sync(family, [HERBST, WEIHNACHT]);
  expect(names()).toBe("oh-herbst=Herbstferien,oh-weihnacht=Weihnachtsferien");
  // The same rows, renamed in place: ids kept, the family's hidden flag kept, updated_at moved.
  expect(ids()).toBe(before);
  expect(psql(`SELECT hidden FROM school_holidays WHERE family_id = '${family}' AND external_id = 'oh-weihnacht';`)).toBe("t");
  expect(stamp()).not.toBe(stampedBefore);
});

test("a sync that writes rows must name the region they are for (final review #5)", () => {
  const family = makeFamily();
  const before = table(family);
  expect(() => psql(`SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([HERBST])}'::jsonb, '2026-09-01', '2029-08-31', false, NULL, NULL, now(), 'de');`))
    .toThrow(/p_expect_region is required/);
  expect(table(family)).toBe(before);
  // A replace (switch off, new region) needs none.
  expect(psql(`SELECT public.apply_school_holiday_sync('${family}', '[]'::jsonb, '1970-01-01', '1970-01-01', true, NULL, NULL, NULL, NULL);`)).toContain('"superseded": false');
});

test("families with a chosen region and no sync setting are listed for the cron (final review #2)", () => {
  const made: string[] = [];
  const listed = () => psql(`SELECT string_agg(family_id || '=' || holiday_region, ',') FROM public.school_holiday_sync_unset_families() WHERE family_id = ANY(ARRAY[${made.map((f) => `'${f}'::uuid`).join(",")}]);`);
  const region = (value: string) => {
    const id = psql(`INSERT INTO families (name, join_code) VALUES ('school-sync-test', 'SS' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`);
    families.push(id);
    made.push(id);
    psql(`INSERT INTO settings (family_id, key, value) VALUES ('${id}', 'holiday_region', '${value}'::jsonb);`);
    return id;
  };
  const chosen = region('{"code": "DE-NI", "chosen": true}');
  region('{"code": "DE-NI", "chosen": false}');
  region('{"code": null, "chosen": true}');
  const withSetting = region('{"code": "DE-BY", "chosen": true}');
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${withSetting}', 'school_holiday_sync', '${JSON.stringify({ ...SETTING, enabled: false })}'::jsonb);`);
  expect(listed()).toBe(`${chosen}=DE-NI`);
});

test("a bad row fails the whole write, leaving the table as it was", () => {
  const family = makeFamily();
  sync(family, [HERBST]);
  const before = table(family);
  expect(() => sync(family, [WEIHNACHT, { external_id: "oh-bad", name: "x", starts_on: "2027-02-10", ends_on: "2027-02-01" }])).toThrow();
  expect(table(family)).toBe(before);
});

test("only the service role may call the function", () => {
  for (const signature of [
    "public.apply_school_holiday_sync(uuid, jsonb, date, date, boolean, text, text, timestamptz, text)",
    "public.record_school_holiday_sync_error(uuid, timestamptz, text, text, text)",
    "public.school_holiday_sync_unset_families()",
  ]) {
    for (const role of ["anon", "authenticated"]) {
      expect(psql(`SELECT has_function_privilege('${role}', '${signature}', 'EXECUTE');`), `${role} ${signature}`).toBe("f");
    }
    expect(psql(`SELECT has_function_privilege('service_role', '${signature}', 'EXECUTE');`), signature).toBe("t");
  }
  // The five-argument version from before the race fix and the eight-argument
  // one from before p_language (rc.2) are gone, not left callable beside it.
  expect(psql(`SELECT count(*) FROM pg_proc WHERE proname = 'apply_school_holiday_sync';`)).toBe("1");
  expect(psql(`SELECT count(*) FROM pg_proc WHERE proname = 'record_school_holiday_sync_error';`)).toBe("1");
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
    SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([HERBST])}'::jsonb, '2026-09-01', '2029-08-31', ${ARGS(false)});
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
  // The family is deleted as service_role, the way DELETE /api/family does it:
  // browsers hold no DELETE on families. The cascade into school_holidays runs
  // as the table owner whoever deletes the parent, which is what this checks.
  const out = execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "supabase_admin", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1", "-c",
    `BEGIN;
     ALTER ROLE postgres NOBYPASSRLS;
     SET LOCAL ROLE service_role;
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
    `BEGIN; SELECT public.apply_school_holiday_sync('${family}', '${JSON.stringify([HERBST])}'::jsonb, '2026-09-01', '2029-08-31', ${ARGS(false)}); SELECT pg_sleep(4); COMMIT;`]);
  const done = new Promise<number>((resolve) => a.on("exit", (code) => resolve(code ?? -1)));
  try {
    const held = () => psql(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 1
      AND ((classid::bigint << 32) | objid::bigint) = ${key(family)};`);
    for (let i = 0; i < 50 && held() !== "1"; i++) await new Promise((r) => setTimeout(r, 100));
    expect(held()).toBe("1");
    // Connection B: the same family's sync waits for A (and gives up here
    // after half a second); another family's does not.
    expect(() => psql(`SET lock_timeout = '500ms'; SELECT public.apply_school_holiday_sync('${family}', '[]'::jsonb, '2026-09-01', '2029-08-31', ${ARGS(true)});`))
      .toThrow(/lock timeout/);
    expect(psql(`SET lock_timeout = '500ms'; SELECT public.apply_school_holiday_sync('${other}', '[]'::jsonb, '2026-09-01', '2029-08-31', ${ARGS(true)});`))
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

