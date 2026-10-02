import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
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

test("the migration is idempotent and every existing row is manual", () => {
  const family = makeFamily();
  manual(family, "Sommerferien", "2026-07-02", "2026-08-12");
  applyMigration();
  applyMigration();
  expect(psql(`SELECT source || '|' || hidden || '|' || coalesce(external_id, '-') FROM school_holidays WHERE family_id = '${family}';`)).toBe("manual|false|-");
});

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
