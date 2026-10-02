import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_holiday_region.sql against a real database (RFC-014 §12): each
 * holiday_country state produces the stated row, and a second run changes
 * nothing. It writes a row for every family on the install, so it holds the
 * whole-database lock (./whole-database.ts).
 */

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function applyMigration(): void {
  execFileSync("bash", ["-c",
    `docker exec -i ${dbContainer()} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < webapp/docker/migration_holiday_region.sql`],
    { cwd: process.cwd().replace(/\/webapp$/, ""), encoding: "utf8" });
}

test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");

test.beforeEach(acquireWholeDatabase);
test.afterEach(releaseWholeDatabase);

const families: string[] = [];
function makeFamily(settings: Record<string, unknown>): string {
  const id = psql(
    `INSERT INTO families (name, join_code) VALUES ('holiday-region-test', 'HR' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`,
  );
  families.push(id);
  for (const [key, value] of Object.entries(settings)) {
    const json = JSON.stringify(value).replace(/'/g, "''");
    psql(`INSERT INTO settings (family_id, key, value) VALUES ('${id}', '${key}', '${json}'::jsonb);`);
  }
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

const region = (id: string) =>
  psql(`SELECT COALESCE(value->>'code', 'null') || '|' || (value->>'chosen') FROM settings WHERE family_id = '${id}' AND key = 'holiday_region';`);

test("every family gets the region it effectively had, and a second run changes nothing", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{}, "DE-NI|false"],
    [{ holiday_country: "de" }, "DE-NI|false"],
    [{ holiday_country: "uk" }, "GB-ENG|false"],
    [{ holiday_country: "us" }, "US|false"],
    [{ holiday_country: "nl" }, "NL|false"],
    [{ holiday_country: "fr" }, "FR|false"],
    [{ holiday_country: "xx" }, "DE-NI|false"],
    [{ holiday_country: "de", holiday_region: { code: "AT-9", chosen: true } }, "AT-9|true"],
    [{ holiday_region: { code: null, chosen: false } }, "null|false"],
  ];
  const ids = cases.map(([settings]) => makeFamily(settings));

  applyMigration();
  cases.forEach(([settings, expected], i) => expect(region(ids[i]), JSON.stringify(settings)).toBe(expected));

  const list = ids.map((id) => `'${id}'`).join(",");
  const snapshot = () =>
    psql(`SELECT string_agg(family_id || '|' || value::text || '|' || updated_at::text, ',' ORDER BY family_id)
          FROM settings WHERE key = 'holiday_region' AND family_id IN (${list});`);
  const before = snapshot();
  applyMigration();
  expect(snapshot()).toBe(before);

  // holiday_country is left where it was, for one release.
  expect(psql(`SELECT count(*) FROM settings WHERE key = 'holiday_country' AND family_id IN (${list});`)).toBe("7");
});
