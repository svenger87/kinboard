import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { CURRENT_ZONE_NAMES } from "../src/lib/time-zones";
import { establishSession } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

// page.route below must see /api/realtime; a service worker would answer first.
test.use({ serviceWorkers: "block" });

/**
 * Settings → Language → Time zone, against a running stack: the picker saves
 * the family's zone and the database's "today" follows it, Automatic deletes
 * the setting, the settings route refuses a zone nothing knows, and every
 * zone a browser can offer is one the database knows. Needs FAMILY_CODE.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// One device for the file, joined once: joining is limited to 10 a minute per
// IP and the smoke run already comes close (see session.ts), so the tests run
// in one worker, share it, and it is removed after the last of them.
test.describe.configure({ mode: "serial" });
const DEVICE = "time-zone-ui";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

const AUTOMATIC = /^(Automatic|Automatisch|Automatique)/;
let familyId = "";
let saved = "";
const stored = () => psql(`SELECT coalesce(string_agg(value #>> '{}', ','), '') FROM settings WHERE family_id = '${familyId}' AND key = 'timezone'`);

test.beforeEach(async () => {
  await acquireWholeDatabase();
  familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
  saved = psql(`SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = 'timezone'`);
  psql(`DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'timezone'`);
});
test.afterEach(() => {
  try {
    psql(
      saved
        ? `INSERT INTO settings (family_id, key, value) VALUES ('${familyId}', 'timezone', '${saved.replace(/'/g, "''")}'::jsonb)
           ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`
        : `DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'timezone'`,
    );
  } finally {
    releaseWholeDatabase();
  }
});
test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    // Only this spec's device: other specs keep their sessions.
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE}%'`);
  } finally {
    releaseWholeDatabase();
  }
});

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("Settings → Language sets the family's time zone, and the database's today follows it", async ({ page }) => {
  await establishSession(page, familyCode!, DEVICE);
  // No realtime: its settings broadcast would refresh the zone on this device
  // too, and hide a save that forgot to invalidate the query.
  // The service worker is blocked for this file (test.use below), or it would
  // answer the request before the route sees it.
  await page.route("**/api/realtime", (route) => route.abort());
  const server = ((await (await page.request.get("/api/time-zone")).json()) as { server: string }).server;
  expect(() => new Intl.DateTimeFormat("en-US", { timeZone: server })).not.toThrow();

  await page.goto("/settings/language", { waitUntil: "domcontentloaded" });
  const current = page.getByTestId("time-zone-current");
  // The first paint waits on the PIN guard and the setting; against a dev
  // server that compiles on demand it takes longer than the default 5 s.
  await expect(current).toBeVisible({ timeout: 20_000 });
  await expect(current).toContainText(AUTOMATIC);
  await expect(current).toContainText(server.replace(/_/g, " "));
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Darwin: +09:30 all year, and the same name in every browser.
  const list = page.getByTestId("time-zone-list");
  // Retried: under `next dev` the first click can land on a page about to be
  // remounted while other routes compile. Inert against the CI build.
  await expect(async () => {
    if (!(await list.isVisible())) await current.click({ timeout: 2_000 });
    await expect(list).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("textbox").last().fill("darwin");
  await list.getByRole("button", { name: /Australia\/Darwin/ }).click();
  // The button shows the stored setting: it changes only once the save has
  // invalidated the query, which is what the rest of this device reads.
  await expect(current).toContainText("Australia/Darwin");
  await expect(current).toContainText("UTC+09:30");
  expect(stored()).toBe("Australia/Darwin");
  expect(psql(`SELECT public.family_time_zone('${familyId}')`)).toBe("Australia/Darwin");
  expect(psql(`SELECT public.family_today('${familyId}') = (now() AT TIME ZONE 'Australia/Darwin')::date`)).toBe("t");
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // An offset finds a zone by number, under its current name in any browser.
  await current.click();
  await page.getByRole("textbox").last().fill("utc+5:30");
  await expect(list.getByRole("button", { name: /Asia\/Kolkata/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Asia\/Calcutta/ })).toHaveCount(0);

  // Automatic deletes the setting, and the server's zone is back.
  await page.getByRole("textbox").last().fill("");
  await list.getByRole("button", { name: AUTOMATIC }).click();
  await expect(current).toContainText(AUTOMATIC);
  expect(stored()).toBe("");
  expect(psql(`SELECT public.family_time_zone('${familyId}')`)).toBe(server);
});

test("the settings route refuses a zone nothing knows, and Automatic is a delete", async ({ page }) => {
  await establishSession(page, familyCode!, DEVICE);
  for (const value of ["Mars/Olympus_Mons", "", 42, null, "+05:00", "+0530"]) {
    const res = await page.request.put("/api/settings", { data: { family_id: familyId, key: "timezone", value } });
    expect(res.status(), JSON.stringify(value)).toBe(400);
  }
  expect(stored()).toBe("");
  const put = await page.request.put("/api/settings", { data: { family_id: familyId, key: "timezone", value: "Europe/Kyiv" } });
  expect(put.status()).toBe(200);
  expect(stored()).toBe("Europe/Kyiv");
  expect(psql(`SELECT public.family_time_zone('${familyId}')`)).toBe("Europe/Kyiv");
  const del = await page.request.delete("/api/settings", { data: { family_id: familyId, key: "timezone" } });
  expect(del.status()).toBe(200);
  expect(stored()).toBe("");
});

test("every zone a browser offers is one the database knows", async ({ page }) => {
  // The browser's own list, renamed as the picker renames it: a zone the
  // database did not know would be passed over there, silently, as unset.
  const listed = await page.evaluate(() => Intl.supportedValuesOf("timeZone"));
  const offered = [...new Set([...listed.map((zone) => CURRENT_ZONE_NAMES[zone] ?? zone), "UTC"])];
  expect(offered.length).toBeGreaterThan(300);
  for (const zone of offered) expect(zone, "a zone name is letters, digits and / _ + -").toMatch(/^[A-Za-z0-9/_+-]+$/);
  const unknown = psql(
    `SELECT coalesce(string_agg(z, ', '), '') FROM unnest(ARRAY[${offered.map((z) => `'${z}'`).join(",")}]) AS z
      WHERE NOT EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = z)`,
  );
  expect(unknown).toBe("");
});
