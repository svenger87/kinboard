import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { legacyHolidayRegion, withHolidayRegion } from "../src/lib/holidays/region";
import { familyHolidayRegion } from "../src/lib/family-time";
import { SETTINGS_KEYS } from "../src/lib/settings-keys";
import { codeOnly } from "./source-helpers";

/** RFC-014 §4.2: the holiday region is its own setting, and nothing loses the region it had. */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";

function settingsDb(rows: { family_id: string; key: string; value: unknown }[], fail = false) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
        async maybeSingle() {
          if (fail) return { data: null, error: { message: `${table} failed` } };
          const hit = table === "settings"
            ? rows.find((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v))
            : undefined;
          return { data: hit ? { value: hit.value } : null, error: null };
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof familyHolidayRegion>[1];
}

test("the key is holiday_region", () => {
  expect(SETTINGS_KEYS.holidayRegion).toBe("holiday_region");
});

test("a legacy country maps to the region it always meant, unchosen", () => {
  expect(legacyHolidayRegion(undefined)).toEqual({ code: "DE-NI", chosen: false });
  expect(legacyHolidayRegion("de")).toEqual({ code: "DE-NI", chosen: false });
  expect(legacyHolidayRegion("uk")).toEqual({ code: "GB-ENG", chosen: false });
  expect(legacyHolidayRegion("us")).toEqual({ code: "US", chosen: false });
  expect(legacyHolidayRegion("nl")).toEqual({ code: "NL", chosen: false });
  expect(legacyHolidayRegion("fr")).toEqual({ code: "FR", chosen: false });
  expect(legacyHolidayRegion("xx")).toEqual({ code: "DE-NI", chosen: false });
  expect(legacyHolidayRegion("constructor")).toEqual({ code: "DE-NI", chosen: false });
});

test("a restored backup without holiday_region gets the region its holiday_country meant", () => {
  const ids = ["new-id"];
  const old = withHolidayRegion([{ id: "a", key: "holiday_country", value: "uk" }, { id: "b", key: "theme", value: "dark" }], () => ids[0]);
  expect(old).toContainEqual({ id: "new-id", key: "holiday_region", value: { code: "GB-ENG", chosen: false } });
  expect(withHolidayRegion([], () => "x")).toEqual([{ id: "x", key: "holiday_region", value: { code: "DE-NI", chosen: false } }]);
  const current = [{ id: "c", key: "holiday_region", value: { code: null, chosen: false } }];
  expect(withHolidayRegion(current, () => "y")).toEqual(current);
});

test("familyHolidayRegion reads this family's row only, validated", async () => {
  const rows = [
    { family_id: THEIRS, key: "holiday_region", value: { code: "AT-9", chosen: true } },
  ];
  expect(await familyHolidayRegion(OURS, settingsDb(rows))).toBeNull();
  rows.push({ family_id: OURS, key: "holiday_region", value: { code: "CH-ZH", chosen: true } });
  expect(await familyHolidayRegion(OURS, settingsDb(rows))).toEqual({ code: "CH-ZH", chosen: true });
  const bad = [{ family_id: OURS, key: "holiday_region", value: { code: "JP", chosen: true } }];
  expect(await familyHolidayRegion(OURS, settingsDb(bad))).toEqual({ code: null, chosen: false });
  await expect(familyHolidayRegion(OURS, settingsDb([], true))).rejects.toBeTruthy();
});

test("a new family starts with no region, so the backfill cannot give it one", () => {
  const route = codeOnly(readFileSync(join(process.cwd(), "src/app/api/session/create/route.ts"), "utf8"));
  expect(route).toMatch(/key: SETTINGS_KEYS\.holidayRegion,\s*value: \{ code: null, chosen: false \}/);
});

test("an import adds the region before the id map is built", () => {
  const route = codeOnly(readFileSync(join(process.cwd(), "src/app/api/import/route.ts"), "utf8"));
  const added = route.indexOf("withHolidayRegion(");
  expect(added).toBeGreaterThan(-1);
  expect(added).toBeLessThan(route.indexOf("const idMap = new Map"));
});

test("the migration is idempotent and only ever inserts", () => {
  const sql = codeOnly(readFileSync(join(process.cwd(), "docker/migration_holiday_region.sql"), "utf8"), { sql: true });
  expect(sql).toContain("ON CONFLICT (family_id, key) DO NOTHING");
  expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b/i);
});
