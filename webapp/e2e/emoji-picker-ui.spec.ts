import { test, expect, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * The emoji picker, rendered, at phone width: the rewards catalogue's icon
 * field opens it inside the screen, a search in the screen's language finds
 * the ice cream (German "Eis", French "glace", English "ice"), the arrow keys
 * move across the grid, a skin tone sticks, the pick is remembered under
 * "Recently used", and the reward is stored with it and shows it on the
 * Rewards page and in a pending request. The task form opens the same picker.
 *
 * In a family of its own, `claude-emoji`, with no settings PIN, removed
 * afterwards. Needs a running stack: FAMILY_CODE says there is one.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const ID = (n: string) => `c1a0de00-0019-4000-8000-00000000${n}`;
const FAMILY = ID("f001");
const KID = ID("f0a1");
const JOIN_CODE = "CLAUDEEMOJ";
const DEVICE = "claude-emoji-phone";
const PHONE = { width: 390, height: 844 };

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE family_id = '${FAMILY}' OR hardware_id = 'e2e-${DEVICE}';
    DELETE FROM point_redemptions WHERE family_id = '${FAMILY}';
    DELETE FROM point_rewards WHERE family_id = '${FAMILY}';
    DELETE FROM todo_point_awards WHERE family_id = '${FAMILY}';
    DELETE FROM creatures WHERE family_id = '${FAMILY}';
    DELETE FROM people WHERE family_id = '${FAMILY}';
    DELETE FROM settings WHERE family_id = '${FAMILY}';
    DELETE FROM families WHERE id = '${FAMILY}';`);
}

test.beforeAll(() => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-emoji', '${JOIN_CODE}', true);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES ('${KID}', '${FAMILY}', 'claude-Emma', true, '#56B6E8');
    INSERT INTO creatures (person_id, family_id, species, style, enabled) VALUES ('${KID}', '${FAMILY}', 'dragon', 'gumdrop', true);
    INSERT INTO todo_point_awards (family_id, person_id, points, completion_key) VALUES ('${FAMILY}', '${KID}', 40, 'claude-emoji');`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id = '${FAMILY}'`)).toBe("0");
});

async function phone(browser: Browser, locale: "en" | "de" | "fr"): Promise<Page> {
  const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
  const page = await context.newPage();
  await establishSession(page, JOIN_CODE, DEVICE);
  const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: new URL(base).origin }]);
  return page;
}

/** The popover sits inside the screen, and nothing scrolls sideways. */
async function expectInside(page: Page) {
  const box = (await page.getByTestId("emoji-popover").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  expect(box.width).toBeGreaterThan(280);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("a reward's icon, picked at phone width, stored, and shown to the child", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await phone(browser, "en");
  try {
    await page.goto("/settings/creatures", { waitUntil: "domcontentloaded" });
    const catalogue = page.getByTestId("reward-catalogue");
    await expect(catalogue).toBeVisible({ timeout: 30_000 });
    await catalogue.getByTestId("emoji-field").last().click();
    const picker = page.getByTestId("emoji-picker");
    await expect(picker).toBeVisible();
    await expectInside(page);

    // Categories first: the food tab, 8 to a row.
    await expect(picker.getByTestId("emoji-tab")).toHaveCount(8, { timeout: 30_000 });
    await picker.getByRole("tab", { name: "food & drink" }).click();
    const grid = picker.getByTestId("emoji-grid");
    await expect(grid.getByRole("button", { name: "pizza" })).toBeVisible();
    // Drawn in chunks, not all at once.
    const drawn = await grid.locator("button[data-emoji]").count();
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThanOrEqual(96);

    // The arrow keys move across the grid and down a row.
    const first = grid.locator("button[data-emoji]").first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-emoji"))).toBe(
      await grid.locator("button[data-emoji]").nth(1).getAttribute("data-emoji"),
    );
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-emoji"))).toBe(
      await grid.locator("button[data-emoji]").nth(9).getAttribute("data-emoji"),
    );

    // Search, and pick.
    await picker.getByTestId("emoji-search").fill("ice");
    await grid.getByRole("button", { name: "soft ice cream" }).click();
    await expect(picker).toBeHidden();
    await expect(catalogue.getByTestId("emoji-field").last()).toHaveText("🍦");

    await catalogue.locator("#new-reward-title").fill("claude-emoji ice cream");
    await catalogue.locator("#new-reward-cost").fill("10");
    await catalogue.getByRole("button", { name: "Add" }).click();
    await expect
      .poll(() => psql(`SELECT icon FROM point_rewards WHERE family_id = '${FAMILY}' AND title = 'claude-emoji ice cream'`), { timeout: 15_000 })
      .toBe("🍦");

    // Opened again: the pick is under "Recently used", which opens first.
    await catalogue.getByTestId("emoji-field").last().click();
    await expect(picker.getByRole("tab", { name: "Recently used" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    await expect(grid.locator("button[data-emoji]").first()).toHaveAttribute("data-emoji", "🍦");

    // A skin tone, remembered on this device.
    await picker.getByRole("radio", { name: "Medium skin tone" }).click();
    await picker.getByTestId("emoji-search").fill("thumbs up");
    await expect(grid.locator("button[data-emoji]").first()).toHaveAttribute("data-emoji", "👍🏽");
    await page.keyboard.press("Escape");

    // The child sees it on the reward, and on a request waiting for a parent.
    const rewardId = psql(`SELECT id FROM point_rewards WHERE family_id = '${FAMILY}' AND title = 'claude-emoji ice cream'`);
    psql(`INSERT INTO point_redemptions (family_id, person_id, reward_id, title, icon, cost_points, status)
      VALUES ('${FAMILY}', '${KID}', '${rewardId}', 'claude-emoji ice cream', '🍦', 10, 'pending')`);
    await page.goto(`/rewards?child=${KID}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reward-card").filter({ hasText: "claude-emoji ice cream" })).toContainText("🍦", { timeout: 30_000 });
    await expect(page.getByTestId("redemptions-pending")).toContainText("🍦");
  } finally {
    await page.context().close();
  }
});

for (const [locale, word, tab] of [["de", "Eis", "Essen & Trinken"], ["fr", "glace", "nourriture et boissons"]] as const) {
  test(`searching in ${locale}: "${word}" finds the ice cream, and English still works`, async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await phone(browser, locale);
    try {
      await page.goto("/settings/creatures", { waitUntil: "domcontentloaded" });
      const catalogue = page.getByTestId("reward-catalogue");
      await expect(catalogue).toBeVisible({ timeout: 30_000 });
      await catalogue.getByTestId("emoji-field").last().click();
      const picker = page.getByTestId("emoji-picker");
      await expect(picker.getByRole("tab", { name: tab })).toBeVisible({ timeout: 30_000 });
      await expectInside(page);
      const search = picker.getByTestId("emoji-search");
      await search.fill(word);
      await expect(picker.locator('button[data-emoji="🍦"]')).toBeVisible();
      await search.fill("ice cream");
      await expect(picker.locator('button[data-emoji="🍦"]')).toBeVisible();
      // No flags to be found.
      await search.fill(locale === "de" ? "Flagge" : "drapeau");
      await expect(picker.locator("button[data-emoji]").filter({ hasText: /[\u{1F1E6}-\u{1F1FF}]/u })).toHaveCount(0);
    } finally {
      await page.context().close();
    }
  });
}

test("the task form opens the same picker", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await phone(browser, "en");
  try {
    await page.goto("/todos", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /new task|add task/i }).first().click({ timeout: 30_000 });
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("emoji-field").click();
    await expect(page.getByTestId("emoji-picker")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("emoji-search").fill("broom");
    await expect(page.locator('[data-testid=emoji-grid] button[data-emoji="🧹"]')).toBeVisible();
    await page.locator('[data-testid=emoji-grid] button[data-emoji="🧹"]').click();
    await expect(dialog.getByTestId("emoji-field")).toHaveText("🧹");
  } finally {
    await page.context().close();
  }
});
