import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { joinFamilyViaUI } from "./helpers";
import { establishSession } from "./session";

/**
 * RFC-024 §8 as a household meets it: an empty database, /join, a new
 * family, the install's two steps, the family's steps, the PIN, Home; then a
 * second device joins. And an install that already had a family before
 * migration 094: that family never sees the install's steps.
 *
 * DESTRUCTIVE: it empties `families` and the first-run keys of
 * instance_settings before each run. It therefore runs only when
 * FIRST_RUN_DB_CONTAINER names a throwaway database container, never one of
 * the dev stack's or prod's, and only while that database holds nothing but
 * this spec's families. The server under PLAYWRIGHT_BASE_URL must use that
 * database, with SITE_URL, VAPID_SUBJECT and OPENWEATHERMAP_API_KEY unset so
 * the steps show their fields rather than the environment's values.
 *
 * Screenshots of every step in light and dark go to SHOT_DIR when it is set.
 */

const DB = process.env.FIRST_RUN_DB_CONTAINER ?? "";
const PROTECTED = /^(kbfresh|kinboard)-/;
test.skip(!DB, "needs FIRST_RUN_DB_CONTAINER: a throwaway stack with the server under test on it");
test.skip(PROTECTED.test(DB), `refusing to empty ${DB}: not a throwaway database`);
test.describe.configure({ mode: "serial" });

const SHOT_DIR = process.env.SHOT_DIR;
const MIGRATION = "docker/migrations/094_first_run.sql";

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();
}

/** The database as a fresh install has it: no family, no first-run record. */
function emptyInstall() {
  const others = psql("SELECT count(*) FROM families WHERE name NOT LIKE 'claude-%'");
  if (others !== "0") throw new Error(`${DB} holds ${others} families this spec did not make; refusing to delete them`);
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices;
    DELETE FROM families;
    DELETE FROM instance_settings WHERE key IN ('first_run_done', 'site_url', 'vapid_subject', 'update_operator_family');`);
}

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "kiosk", width: 1080, height: 1920 },
] as const;

async function noSidewaysScroll(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${where} scrolls sideways`).toBeLessThanOrEqual(0);
}

/** Both themes, by next-themes' class on <html>, without a reload that would lose the step's state. */
async function shoot(page: Page, label: string) {
  if (!SHOT_DIR) return;
  // Pages fade in; WebKit captured the first frame of that as an empty page.
  await page.waitForTimeout(1000);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      const html = document.documentElement;
      html.classList.remove("light", "dark");
      html.classList.add(t);
      html.style.colorScheme = t;
    }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/${label}-${theme}.png`, fullPage: true });
  }
}

async function step(page: Page, name: string, label: string) {
  await expect(page).toHaveURL(new RegExp(`/setup/${name}$`), { timeout: 90_000 });
  await expect(page.getByTestId("wizard-progress")).toHaveAttribute("data-step", name, { timeout: 60_000 });
  await noSidewaysScroll(page, name);
  await shoot(page, `${label}-${name}`);
}

for (const vp of VIEWPORTS) {
  test(`a fresh install, through every step to Home, then a second device (${vp.name})`, async ({ page, browser, browserName }) => {
    test.setTimeout(600_000);
    emptyInstall();
    const label = `${browserName}-${vp.name}`;
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // The welcome screen on an empty database: Create is the only way on.
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#create-family-name")).toBeVisible({ timeout: 90_000 });
    await shoot(page, `${label}-0-join`);
    await page.locator("#create-family-name").fill(`claude-firstrun-${vp.name}`);
    await page.locator("#create-device-name").fill(`claude-firstrun-${vp.name}-1`);
    await page.getByRole("button", { name: /^create family$/i }).click();

    // 1. The install's address: proposed from where this page was opened.
    await step(page, "install", `${label}-1`);
    await expect(page.getByTestId("wizard-progress")).toContainText("Step 1 of 9");
    const origin = new URL(page.url()).origin;
    await expect(page.locator("#instance-site-url")).toHaveValue(origin);
    await expect(page.getByTestId("instance-data-location")).toBeVisible();
    await page.locator("#instance-site-url").fill("https://kinboard.example.org/path");
    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("instance-address").getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/setup\/install$/);
    await page.locator("#instance-site-url").fill("http://kinboard.test:3000");
    await page.getByTestId("wizard-continue").click();

    // 2. Push: ready, and a contact.
    await step(page, "push", `${label}-2`);
    await expect(page.getByTestId("push-ready").or(page.getByTestId("push-not-ready"))).toBeVisible();
    await page.locator("#instance-push-contact").fill("claude@example.org");
    await page.getByTestId("wizard-continue").click();

    // 3. Language, time zone, region; Back would lead to push.
    await step(page, "region", `${label}-3`);
    await expect(page.getByTestId("wizard-progress")).toContainText("Step 3 of 9");
    await expect(page.getByTestId("setup-language")).toBeVisible();
    await expect(page.getByTestId("setup-time-zone")).toBeVisible();
    await expect(page.getByTestId("wizard-back")).toBeVisible();
    await expect(page.getByTestId("wizard-continue")).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId("wizard-continue").click();

    await step(page, "people", `${label}-4`);
    await page.locator('input[placeholder="Name"]').first().fill("Alex");
    await page.getByTestId("wizard-continue").click();

    // 4. Calendars, with the Google client's fields since the server has none.
    await step(page, "calendar", `${label}-5`);
    await expect(page.getByTestId("api-key-google_oauth_client")).toBeVisible();
    await page.getByTestId("wizard-skip").click();

    await step(page, "homeassistant", `${label}-6`);
    await page.getByTestId("wizard-skip").click();

    // The weather key, as in Settings → Weather.
    await step(page, "weather", `${label}-7`);
    await expect(page.getByTestId("api-key-openweathermap")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("wizard-skip").click();

    // 5. The PIN, typed twice.
    await step(page, "pin", `${label}-8`);
    await page.locator("#setup-pin-0").click();
    await page.keyboard.type("1234");
    await expect(page.getByTestId("setup-pin-prompt")).toHaveText(/again/i);
    await page.locator("#setup-pin-0").click();
    await page.keyboard.type("1234");
    await expect(page.getByTestId("setup-pin-saved")).toBeVisible({ timeout: 15_000 });
    await shoot(page, `${label}-8-pin-saved`);
    await page.getByTestId("wizard-continue").click();

    await expect(page).toHaveURL(/\/setup\/done$/, { timeout: 20_000 });
    await noSidewaysScroll(page, "done");
    await shoot(page, `${label}-9-done`);
    await page.getByRole("link", { name: /go to dashboard/i }).click();
    await expect(page).toHaveURL(new RegExp(`^${origin}/?$`), { timeout: 20_000 });
    await expect(page.locator("main").first()).toBeVisible({ timeout: 30_000 });
    // The getting-started checklist is gone: setup is complete.
    await expect(page.getByText(/finish setting up kinboard/i)).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(2500); // the app's own replace-navigation after a load
    await shoot(page, `${label}-10-home`);

    // What was saved.
    const family = psql(`SELECT id || '|' || join_code || '|' || setup_completed FROM families WHERE name = 'claude-firstrun-${vp.name}'`);
    const [familyId, joinCode, completed] = family.split("|");
    expect(completed).toBe("true");
    expect(psql("SELECT value FROM instance_settings WHERE key = 'site_url'")).toBe("http://kinboard.test:3000");
    expect(psql("SELECT value FROM instance_settings WHERE key = 'vapid_subject'")).toBe("mailto:claude@example.org");
    expect(JSON.parse(psql("SELECT value FROM instance_settings WHERE key = 'first_run_done'")).family_id).toBe(familyId);
    expect(psql(`SELECT count(*) FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`)).toBe("1");
    expect(psql(`SELECT count(*) FROM people WHERE family_id = '${familyId}'`)).toBe("1");

    // /setup again: the install's steps are not due any more.
    await page.goto("/setup", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/setup\/(?!install|push)\w+$/, { timeout: 20_000 });

    // A second device joins with the code, and lands on Home, not in the wizard.
    const second = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, serviceWorkers: "block" });
    const p2 = await second.newPage();
    try {
      await joinFamilyViaUI(p2, joinCode, `claude-firstrun-${vp.name}-2`);
      await expect(p2).toHaveURL(new RegExp(`^${origin}/?$`), { timeout: 20_000 });
      await p2.goto("/setup", { waitUntil: "domcontentloaded" });
      await expect(p2).toHaveURL(/\/setup\/(?!install|push)\w+$/, { timeout: 20_000 });
      expect(psql(`SELECT count(*) FROM devices WHERE family_id = '${familyId}'`)).toBe("2");
    } finally {
      await second.close();
    }
  });
}

test("an install that had a family before migration 094 never shows the install's steps", async ({ page, browserName }) => {
  test.setTimeout(600_000);
  emptyInstall();
  // The family as an older release left it: created, wizard finished, no marker.
  const code = "CLFRX1";
  const id = psql(`INSERT INTO families (name, join_code, setup_completed) VALUES ('claude-firstrun-existing', '${code}', true) RETURNING id`)
    .split("\n")[0]
    .trim();
  expect(psql("SELECT count(*) FROM instance_settings WHERE key = 'first_run_done'")).toBe("0");
  // The update runs the migration.
  psql(readFileSync(MIGRATION, "utf8"));
  expect(psql("SELECT value FROM instance_settings WHERE key = 'first_run_done'")).toBe("before-094");
  // And a second run changes nothing.
  psql(readFileSync(MIGRATION, "utf8"));
  expect(psql("SELECT count(*) FROM instance_settings WHERE key = 'first_run_done'")).toBe("1");

  await establishSession(page, code, `claude-firstrun-existing-${browserName}`);
  await page.waitForTimeout(3000); // the app's own replace-navigation (#378)
  await page.goto("/join", { waitUntil: "domcontentloaded" }).catch((err: Error) => {
    if (!/interrupted by another navigation/.test(err.message)) throw err;
  });
  await page.waitForURL((u) => !u.pathname.startsWith("/join"), { timeout: 120_000 });
  expect(new URL(page.url()).pathname).not.toMatch(/^\/setup/);

  // It is the only family, hence the operator; still nothing due or listed.
  const view = await page.evaluate(async () => (await fetch("/api/setup/instance")).json());
  expect(view).toMatchObject({ operator: true, firstRunDone: true, firstRunMine: false });

  // Even sent to /setup by hand, it goes to its own steps.
  await page.goto("/setup", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/setup\/(?!install|push)\w+$/, { timeout: 120_000 });
  await expect(page.getByTestId("wizard-progress")).toContainText(/of 7$/);
  await page.waitForTimeout(1000);
  expect(new URL(page.url()).pathname).not.toMatch(/^\/setup\/(install|push)$/);
  await shoot(page, `${browserName}-existing-setup`);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
});
