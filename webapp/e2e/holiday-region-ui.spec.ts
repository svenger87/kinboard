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
let savedSync = "";
test.beforeEach(async () => {
  await acquireWholeDatabase();
  familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
  saved = psql(`SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = 'holiday_region'`);
  savedSync = psql(`SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = 'school_holiday_sync'`);
});
test.afterEach(() => {
  try {
    psql(`DELETE FROM school_holidays WHERE family_id = '${familyId}' AND (source = 'openholidays' OR name LIKE 'claude-%')`);
    psql(
      savedSync
        ? `UPDATE settings SET value = '${savedSync.replace(/'/g, "''")}'::jsonb WHERE family_id = '${familyId}' AND key = 'school_holiday_sync'`
        : `DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'school_holiday_sync'`,
    );
    psql(
      saved
        ? `UPDATE settings SET value = '${saved.replace(/'/g, "''")}'::jsonb WHERE family_id = '${familyId}' AND key = 'holiday_region'`
        : `DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'holiday_region'`,
    );
    // Only this spec's device: other specs running against the same stack
    // keep their sessions.
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-claude-holidays-ui%'`);
  } finally {
    releaseWholeDatabase();
  }
});

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("Settings → Holidays offers cantons for Switzerland and fits the screen", async ({ page }) => {
  // The migrated, never-chosen value: what "Keep this" is for. The demo
  // family starts with a chosen region, so set it rather than rely on it.
  psql(
    `INSERT INTO settings (family_id, key, value) VALUES ('${familyId}', 'holiday_region', '{"code":"DE-NI","chosen":false}'::jsonb)
     ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`,
  );
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

  // "Keep this" records that someone chose the migrated region, and goes.
  const keep = page.getByRole("button", { name: /^(Keep this|Beibehalten|Conserver)$/ });
  await expect(keep).toBeVisible();
  // Retried: under `next dev` (on-demand compilation), the first click can
  // land on a page that is about to be remounted while other routes compile,
  // and no request goes out. Inert against the CI `next start` build, where
  // nothing compiles on demand. Keeping twice is the same as keeping once.
  await expect(async () => {
    if (await keep.isVisible()) await keep.click({ timeout: 2_000 });
    await expect(keep).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  expect(psql(`SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = 'holiday_region'`)).toBe(
    '{"code": "DE-NI", "chosen": true}',
  );

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

test("the wizard's region step preselects from the timezone and fits a phone", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Europe/Vienna", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  // A distinct device name from the Settings test above: establishSession
  // caches cookies per name for the worker's lifetime, and that test's
  // afterEach deletes its device row, so reusing the same name here would
  // replay a cookie for a device that no longer exists ("session was reset").
  await establishSession(page, familyCode!, "claude-holidays-ui-wizard");
  // No region yet, and no family timezone: the device's zone decides. The
  // beforeEach/afterEach pair puts the row back.
  psql(`UPDATE settings SET value = '{"code":null,"chosen":false}'::jsonb WHERE family_id = '${familyId}' AND key = 'holiday_region'`);
  psql(`DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'timezone'`);
  await page.goto("/setup/region", { waitUntil: "domcontentloaded" });
  // First paint waits on the setup-state redirect check plus two settings
  // reads; against a dev server compiling on demand that is slower than the
  // default 5s (same reason the Settings test above uses 20s).
  await expect(page.locator("#setup-region-country")).toContainText(/Austria|Österreich|Autriche/, { timeout: 20_000 });
  await expect(page.locator("#setup-region-state")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await context.close();
});

test("picking a Land turns the sync on; switching it off removes only what was synced", async ({ page }) => {
  test.skip(process.env.OPENHOLIDAYS_LIVE !== "1", "set OPENHOLIDAYS_LIVE=1 to fetch from the real API");
  test.setTimeout(180_000);
  psql(`DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'school_holiday_sync'`);
  // Start from an uncovered country: the picker saves only a change, and the
  // family may already hold DE-NI.
  psql(
    `INSERT INTO settings (family_id, key, value) VALUES ('${familyId}', 'holiday_region', '{"code":"US","chosen":true}'::jsonb)
     ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`,
  );
  psql(`INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES ('${familyId}', 'claude-manual', '2026-10-12', '2026-10-24')`);
  // Its own device name: the first test's afterEach deleted that device, and
  // establishSession would replay its cookies (see the wizard test).
  await establishSession(page, familyCode!, "claude-holidays-ui-sync");
  await page.goto("/settings/holidays", { waitUntil: "domcontentloaded" });

  await page.locator("#holiday-region-country").click();
  await page.getByRole("option", { name: /^(Germany|Deutschland|Allemagne)$/ }).click();
  await page.locator("#holiday-region-state").click();
  await page.getByRole("option", { name: /Niedersachsen/ }).click();

  await expect(page.locator("#school-sync-switch")).toBeChecked();
  const synced = page.getByTestId("synced-holidays").locator("li");
  // The sync is limited to one fetch a minute per family, and the Settings
  // test above may have just used it (its Zürich pick fetches): the pick then
  // answers "rate-limited" and leaves the rows to Refresh now. A limited
  // request does not count against the limit, so retrying is safe.
  const refresh = page.getByRole("button", { name: /^(Refresh now|Jetzt aktualisieren|Actualiser)$/ });
  await expect(async () => {
    if ((await synced.count()) === 0 && (await refresh.isEnabled())) await refresh.click({ timeout: 2_000 });
    await expect(synced.first()).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 100_000, intervals: [5_000] });
  await expect(synced.first()).toHaveAttribute("title", /Open Database License \(ODbL\)/);
  await expect(page.getByRole("link", { name: /Open Database License/ })).toHaveAttribute("href", "https://opendatacommons.org/licenses/odbl/1-0/");
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.locator("#school-sync-switch").click();
  await expect(page.locator("#school-sync-switch")).not.toBeChecked();
  await expect(page.getByTestId("synced-holidays")).toHaveCount(0);
  expect(psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${familyId}' AND source = 'openholidays'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM school_holidays WHERE family_id = '${familyId}' AND name = 'claude-manual'`)).toBe("1");
});
