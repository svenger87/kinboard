import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

/**
 * Settings → Holidays and the wizard's region step, rendered (RFC-014 §4.2).
 * Run with --project=webkit and --project=mobile: long German and French
 * names, two selects side by side. Needs FAMILY_CODE and a running stack.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

let familyId = "";
let saved = "";
test.beforeEach(async () => {
  await acquireWholeDatabase();
  familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
  saved = psql(`SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = 'holiday_region'`);
});
test.afterEach(() => {
  try {
    psql(
      saved
        ? `UPDATE settings SET value = '${saved.replace(/'/g, "''")}'::jsonb WHERE family_id = '${familyId}' AND key = 'holiday_region'`
        : `DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'holiday_region'`,
    );
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-claude-%'`);
  } finally {
    releaseWholeDatabase();
  }
});

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("Settings → Holidays offers cantons for Switzerland and fits the screen", async ({ page }) => {
  await establishSession(page, familyCode!, "claude-holidays-ui");
  // No realtime: its settings broadcast would refresh the region on this
  // device too, and hide a save that forgot to invalidate the query.
  let realtimeSockets = 0;
  await page.routeWebSocket(/\/realtime\/v1\//, (ws) => {
    realtimeSockets++;
    ws.close();
  });
  await page.goto("/settings/holidays", { waitUntil: "domcontentloaded" });

  // The first paint waits on the PIN guard and the setting; against a dev
  // server that compiles on demand it takes longer than the default 5 s.
  await expect(page.locator("#holiday-region-country")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /School holidays|Schulferien|Vacances scolaires/ })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.locator("#holiday-region-country").click();
  await page.getByRole("option", { name: /^(Switzerland|Schweiz|Suisse)$/ }).click();
  await expect(page.locator("#holiday-region-state")).toBeVisible();
  await page.locator("#holiday-region-state").click();
  await page.getByRole("option", { name: /Zürich/ }).click();
  // The picker shows the stored setting, not local state: Zürich appears only
  // once the save has invalidated the query useHolidayRegion() reads, which is
  // also what the calendar and the widget on this device read.
  await expect(page.locator("#holiday-region-state")).toContainText("Zürich");
  await expect(page.getByTestId("holiday-preview").locator("li").first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(psql(`SELECT value->>'code' FROM settings WHERE family_id = '${familyId}' AND key = 'holiday_region'`)).toBe("CH-ZH");
  expect(realtimeSockets, "the realtime socket was opened and refused").toBeGreaterThan(0);

  // The Netherlands has no state worth picking: no second select.
  await page.locator("#holiday-region-country").click();
  await page.getByRole("option", { name: /^(Netherlands|Niederlande|Pays-Bas)$/ }).click();
  await expect(page.locator("#holiday-region-state")).toHaveCount(0);
});
