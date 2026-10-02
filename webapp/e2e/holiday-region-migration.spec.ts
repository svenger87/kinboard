import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_REGIONS, legacyHolidayRegion } from "../src/lib/holidays/region";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_holiday_region.sql against a real database (RFC-014 §12): each
 * holiday_country state produces the stated row, and a second run changes
 * nothing.
 *
 * The expected region for every legacy state comes from legacyHolidayRegion(),
 * the TypeScript mapping /api/import uses for old backups, so the SQL CASE and
 * LEGACY_REGIONS are checked against each other: drift on either side is red.
 * Every LEGACY_REGIONS key is a case, so a mapping added on one side only
 * cannot slip past either.
 *
 * Everything -- the test families, both applications of the migration and
 * every assertion's query -- runs in one psql session inside BEGIN ...
 * ROLLBACK, so the spec leaves the database exactly as it found it. The
 * migration writes a row for every family on the install, so the spec still
 * holds the whole-database lock (./whole-database.ts) while its transaction
 * is open.
 */

test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");

test.beforeEach(acquireWholeDatabase);
test.afterEach(releaseWholeDatabase);

const MIGRATION = readFileSync(join(process.cwd(), "docker/migration_holiday_region.sql"), "utf8");

function psql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: script, encoding: "utf8" },
  ).trim();
}

const lit = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const expected = (country: unknown) => {
  const r = legacyHolidayRegion(country);
  return `${r.code ?? "null"}|${r.chosen}`;
};

/** family_id -> value and physical row version of every holiday_region row; an UPDATE moves the ctid. */
const SNAPSHOT = (tag: string) =>
  `SELECT '${tag}|' || coalesce(string_agg(family_id || '=' || value::text || '@' || ctid::text, ',' ORDER BY family_id), '')
     FROM public.settings WHERE key = 'holiday_region';`;

function parseSnapshot(line: string | undefined): Map<string, string> {
  const body = (line ?? "").split("|").slice(1).join("|");
  return new Map(body ? body.split(",").map((e) => [e.slice(0, 36), e.slice(37)] as [string, string]) : []);
}

test("every family gets the region it effectively had, a second run changes nothing, and nothing is left behind", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{}, expected(undefined)],
    ...Object.keys(LEGACY_REGIONS).map((code): [Record<string, unknown>, string] => [{ holiday_country: code }, expected(code)]),
    // Values the UI never wrote: each must land where legacyHolidayRegion puts it.
    ...["xx", "UK", "constructor", null, { code: "uk" }, 5].map((value): [Record<string, unknown>, string] => [
      { holiday_country: value },
      expected(value),
    ]),
    // An explicit row -- a family's own pick, or a new family's "no region" -- is never touched.
    [{ holiday_country: "de", holiday_region: { code: "AT-9", chosen: true } }, "AT-9|true"],
    [{ holiday_region: { code: null, chosen: false } }, "null|false"],
  ];
  const ids = cases.map(() => randomUUID());
  const list = ids.map((id) => `'${id}'`).join(",");

  const outside = () => psql(SNAPSHOT("O"));
  const before = parseSnapshot(outside());

  const setup = cases
    .map(([settings], i) => [
      `INSERT INTO public.families (id, name, join_code) VALUES ('${ids[i]}', 'holiday-region-test', 'HR' || upper(substr(md5(random()::text), 1, 8)));`,
      ...Object.entries(settings).map(
        ([key, value]) => `INSERT INTO public.settings (family_id, key, value) VALUES ('${ids[i]}', '${key}', ${lit(value)});`,
      ),
    ].join("\n"))
    .join("\n");

  const out = psql(`BEGIN;
${setup}
${MIGRATION}
SELECT 'R|' || family_id || '|' || coalesce(value->>'code', 'null') || '|' || (value->>'chosen')
  FROM public.settings WHERE key = 'holiday_region' AND family_id IN (${list});
${SNAPSHOT("S1")}
${MIGRATION}
${SNAPSHOT("S2")}
SELECT 'C|' || count(*) FROM public.settings WHERE key = 'holiday_country' AND family_id IN (${list});
ROLLBACK;
`).split("\n");

  const regions = new Map(
    out.filter((l) => l.startsWith("R|")).map((l) => {
      const [, id, code, chosen] = l.split("|");
      return [id, `${code}|${chosen}`];
    }),
  );
  cases.forEach(([settings, want], i) => expect(regions.get(ids[i]), JSON.stringify(settings)).toBe(want));

  // The second run inserts nothing and rewrites nothing: same values, same row versions.
  const first = out.find((l) => l.startsWith("S1|"));
  expect(first).toBeTruthy();
  expect(out.find((l) => l.startsWith("S2|"))?.slice(3)).toBe(first!.slice(3));

  // holiday_country is left where it was, for one release.
  const withCountry = cases.filter(([settings]) => "holiday_country" in settings).length;
  expect(out.find((l) => l.startsWith("C|"))).toBe(`C|${withCountry}`);

  // ROLLBACK: none of the test families survive, and every row that existed
  // before is still there, unchanged. Compared on the families present both
  // times, so another spec creating or deleting a family meanwhile cannot
  // make this red.
  expect(psql(`SELECT count(*) FROM public.families WHERE id IN (${list});`)).toBe("0");
  const after = parseSnapshot(outside());
  for (const [family, row] of before) {
    if (after.has(family)) expect(after.get(family), family).toBe(row);
  }
});
