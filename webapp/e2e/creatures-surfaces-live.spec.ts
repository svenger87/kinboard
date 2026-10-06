import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * Where the creatures live (RFC-017 §4, step 2), in a browser against the
 * stack: the Creatures widget with no, one and four creatures at phone and
 * wall widths; the Rewards nav item appearing only once a child has a
 * creature; the Rewards page, where a child without a pocket-money account
 * redeems a reward with no PIN; a child's own device opening on their Rewards
 * page while a kiosk opens on the dashboard; and the creatures cheering on
 * the new surfaces when a task is ticked.
 *
 * Layout checks are measured, not eyeballed: no page wider than the screen,
 * every creature inside its card, none overlapping. CI runs this file under
 * WebKit too (e2e.yml), where layout rules have differed from Chromium before.
 *
 * In a family of its own, `claude-surfaces`, created here and removed with
 * its devices afterwards. Needs a running stack: FAMILY_CODE says there is
 * one (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const ID = (n: string) => `c1a0de00-0018-4000-8000-00000000${n}`;
const FAMILY = ID("e001");
const KIDS = [ID("e0a1"), ID("e0a2"), ID("e0a3"), ID("e0a4")];
const NAMES = ["claude-Mia", "claude-Ben", "claude-Lea", "claude-Tom"];
const SPECIES = ["dragon", "unicorn", "owl", "fox"];
const NO_CREATURE = ID("e0a5");
const PARENT = ID("e0b1");
const REWARD = ID("e0c1");
const TASK = ID("e0d1");
const JOIN_CODE = "CLAUDESURF";
const DEVICES = ["claude-surf-a", "claude-surf-b", "claude-surf-phone", "claude-surf-kiosk"];

const PHONE = { width: 390, height: 844 };
const WALL = { width: 1920, height: 1080 };

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE family_id = '${FAMILY}' OR hardware_id IN (${DEVICES.map((d) => `'e2e-${d}'`).join(", ")});
    DELETE FROM point_redemptions WHERE family_id = '${FAMILY}';
    DELETE FROM point_rewards WHERE family_id = '${FAMILY}';
    DELETE FROM todo_point_awards WHERE family_id = '${FAMILY}';
    DELETE FROM todos WHERE family_id = '${FAMILY}';
    DELETE FROM creatures WHERE family_id = '${FAMILY}';
    DELETE FROM pocket_money_accounts WHERE family_id = '${FAMILY}';
    DELETE FROM people WHERE family_id = '${FAMILY}';
    DELETE FROM settings WHERE family_id = '${FAMILY}';
    DELETE FROM families WHERE id = '${FAMILY}';`);
}

/** Switch on exactly the first `n` children's creatures; the rest are kept, switched off. */
function creatures(n: number) {
  psql(KIDS.map((id, i) => `UPDATE creatures SET enabled = ${i < n} WHERE person_id = '${id}';`).join("\n"));
}

test.beforeAll(() => {
  purge();
  // The Creatures widget alone on the dashboard, so what is measured is it.
  const widgets = JSON.stringify({
    weather: false, upcomingEvents: false, weekOverview: false, schedule: false, mealPlan: false, timers: false,
    messages: false, tasks: false, creatures: true,
  });
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-surfaces', '${JOIN_CODE}', true);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES
      ${KIDS.map((id, i) => `('${id}', '${FAMILY}', '${NAMES[i]}', true, '#56B6E8')`).join(",\n      ")},
      ('${NO_CREATURE}', '${FAMILY}', 'claude-Ida', true, '#E85656'),
      ('${PARENT}', '${FAMILY}', 'claude-Mum', false, '#8E56E8');
    INSERT INTO creatures (person_id, family_id, species, style, enabled) VALUES
      ${KIDS.map((id, i) => `('${id}', '${FAMILY}', '${SPECIES[i]}', 'gumdrop', false)`).join(",\n      ")};
    INSERT INTO point_rewards (id, family_id, title, cost_points, icon, active)
      VALUES ('${REWARD}', '${FAMILY}', 'claude-surf ice cream', 10, '🍦', true);
    INSERT INTO todos (id, family_id, title, person_id, recurrence, points)
      VALUES ('${TASK}', '${FAMILY}', 'claude-surf feed the cat', '${KIDS[0]}', 'once', 5);
    INSERT INTO settings (family_id, key, value) VALUES ('${FAMILY}', 'widget_visibility', '${widgets}'::jsonb);`);
  // The first child has points to spend, and no pocket-money account.
  psql(`INSERT INTO todo_point_awards (family_id, person_id, points, completion_key)
    VALUES ('${FAMILY}', '${KIDS[0]}', 25, 'claude-surf-start')`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id = '${FAMILY}'`)).toBe("0");
});

async function screen(browser: Browser, device: string, viewport = WALL): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await context.newPage();
  await establishSession(page, JOIN_CODE, device);
  return { context, page };
}

/** Nothing wider than the screen, and every cell inside the card and clear of the others. */
async function expectTidy(page: Page, card: Locator, cells: Locator) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
  const box = (await card.boundingBox())!;
  const boxes = [];
  for (let i = 0; i < (await cells.count()); i++) {
    const b = (await cells.nth(i).boundingBox())!;
    expect(b.x, `cell ${i} left`).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(b.x + b.width, `cell ${i} right`).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(b.y + b.height, `cell ${i} bottom`).toBeLessThanOrEqual(box.y + box.height + 0.5);
    expect(b.width, `cell ${i} width`).toBeGreaterThan(60);
    boxes.push(b);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const apart = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
      expect(apart, `cells ${i} and ${j} overlap`).toBe(true);
    }
  }
}

const rewardsLink = (page: Page) => page.locator('nav a[href="/rewards"]');

test.describe("the Creatures widget", () => {
  for (const [label, viewport] of [["phone", PHONE], ["wall", WALL]] as const) {
    test(`no, one and four creatures at ${label} width`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { context, page } = await screen(browser, DEVICES[0], viewport);
      try {
        creatures(0);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        const empty = page.getByTestId("creatures-widget-empty");
        await expect(empty).toBeVisible({ timeout: 30_000 });
        await expect(empty.getByRole("link")).toHaveAttribute("href", "/settings/creatures");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

        creatures(1);
        await page.reload({ waitUntil: "domcontentloaded" });
        const grid = page.getByTestId("creatures-widget");
        await expect(grid).toHaveAttribute("data-count", "1", { timeout: 30_000 });
        const cells = grid.getByTestId("creature-cell");
        await expect(cells).toHaveCount(1);
        await expect(cells.first()).toContainText(NAMES[0]);
        await expect(cells.first().getByTestId("creature-balance")).toContainText("25");
        await expect(cells.first()).toHaveAttribute("href", `/rewards?child=${KIDS[0]}`);
        await expectTidy(page, grid, cells);

        creatures(4);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(grid).toHaveAttribute("data-count", "4", { timeout: 30_000 });
        await expect(cells).toHaveCount(4);
        for (let i = 0; i < 4; i++) {
          await expect(cells.nth(i)).toContainText(NAMES[i]);
          await expect(cells.nth(i).getByTestId("creature-stage")).not.toBeEmpty();
          // Drawn, and still: nothing moves on the wall outside a reaction.
          await expect(cells.nth(i).locator("svg").first()).toBeVisible();
        }
        await expect(grid.locator(".creature-animated")).toHaveCount(0);
        // The child without a creature is not in it.
        await expect(grid).not.toContainText("claude-Ida");
        await expectTidy(page, grid, cells);
        if (label === "wall") {
          // Four side by side on a wall: one row.
          const ys = await Promise.all([0, 1, 2, 3].map(async (i) => Math.round((await cells.nth(i).boundingBox())!.y)));
          expect(new Set(ys).size, "one row of four").toBe(1);
        }

        // Tapping a creature opens that child's Rewards page.
        await cells.nth(1).click();
        await expect(page).toHaveURL(new RegExp(`/rewards\\?child=${KIDS[1]}$`), { timeout: 30_000 });
        await expect(page.getByTestId("rewards-page")).toHaveAttribute("data-child", KIDS[1], { timeout: 30_000 });
      } finally {
        await context.close();
      }
    });
  }
});

test("the Rewards nav item: only once a child has a creature", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await screen(browser, DEVICES[0], { width: 1280, height: 900 });
  try {
    creatures(0);
    await page.goto("/todos", { waitUntil: "domcontentloaded" });
    await expect(page.locator('nav a[href="/todos"]')).toBeVisible({ timeout: 30_000 });
    // Long enough for the creatures to have loaded and said no.
    await page.waitForTimeout(3_000);
    await expect(rewardsLink(page)).toHaveCount(0);

    creatures(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rewardsLink(page)).toHaveCount(1, { timeout: 30_000 });
    await expect(rewardsLink(page)).toContainText(/Rewards|Belohnungen/);

    // Hidden on this device under Settings -> Navigation: gone here only.
    await page.evaluate(() => {
      localStorage.setItem("kinboard.hidden-nav-items", JSON.stringify(["/rewards"]));
      window.dispatchEvent(new Event("kinboard:nav-visibility-change"));
    });
    await expect(rewardsLink(page)).toHaveCount(0, { timeout: 10_000 });
    await page.evaluate(() => {
      localStorage.removeItem("kinboard.hidden-nav-items");
      window.dispatchEvent(new Event("kinboard:nav-visibility-change"));
    });
    await expect(rewardsLink(page)).toHaveCount(1, { timeout: 10_000 });
  } finally {
    await context.close();
  }
});

test.describe("the Rewards page", () => {
  test("a child without a pocket-money account sees their creature and redeems a reward, no PIN", async ({ browser }) => {
    test.setTimeout(120_000);
    creatures(4);
    expect(psql(`SELECT count(*) FROM pocket_money_accounts WHERE person_id = '${KIDS[0]}'`)).toBe("0");
    const { context, page } = await screen(browser, DEVICES[0], PHONE);
    try {
      await page.goto(`/rewards?child=${KIDS[2]}`, { waitUntil: "domcontentloaded" });
      const main = page.getByTestId("rewards-page");
      // ?child= preselects.
      await expect(main).toHaveAttribute("data-child", KIDS[2], { timeout: 30_000 });
      // Only the children with a creature are offered.
      await expect(page.getByRole("radio", { name: "claude-Ida" })).toHaveCount(0);
      await page.getByRole("radio", { name: NAMES[0], exact: true }).click();
      await expect(main).toHaveAttribute("data-child", KIDS[0]);

      // The creature, large; its stage, the progress to the next one; the look; the stages.
      const creature = page.getByTestId("rewards-creature");
      await expect(creature.locator("[data-testid=creature-reaction-host]")).toBeVisible();
      const host = (await creature.locator("[data-testid=creature-reaction-host]").boundingBox())!;
      expect(host.width).toBeGreaterThanOrEqual(200);
      await expect(page.getByTestId("stage-name")).not.toBeEmpty();
      await expect(page.getByTestId("stage-progress")).toBeVisible();
      await expect(page.getByTestId("change-look")).toBeVisible();
      await page.getByTestId("stage-button").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();

      // The points, and the reward.
      await expect(page.getByTestId("points-balance")).toContainText("25", { timeout: 30_000 });
      const card = page.getByTestId("reward-card").filter({ hasText: "claude-surf ice cream" });
      await card.getByRole("button").click();
      await page.getByRole("alertdialog").getByRole("button", { name: /Redeem|Einlösen|Échanger/ }).click();
      await expect(page.getByTestId("redemptions-pending")).toContainText("claude-surf ice cream", { timeout: 30_000 });
      expect(psql(`SELECT status || '|' || cost_points FROM point_redemptions WHERE person_id = '${KIDS[0]}'`)).toBe("pending|10");

      // No sideways scroll on the phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
      psql(`DELETE FROM point_redemptions WHERE family_id = '${FAMILY}'`);
    }
  });

  test("with no creature at all, it says where creatures come from", async ({ browser }) => {
    test.setTimeout(60_000);
    creatures(0);
    const { context, page } = await screen(browser, DEVICES[0], PHONE);
    try {
      await page.goto("/rewards", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /Creatures & rewards|Kreaturen & Belohnungen/ })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("rewards-page")).toHaveCount(0);
    } finally {
      await context.close();
      creatures(4);
    }
  });
});

test.describe("a child's own device (RFC-017 §8.2)", () => {
  const hw = (name: string) => `e2e-${name}`;

  test("Settings -> Devices: a parent says whose device it is", async ({ browser }) => {
    test.setTimeout(120_000);
    // This family has no settings PIN, so Settings is open; the route's PIN
    // boundary is device-owner-pin.spec.ts.
    const { context, page } = await screen(browser, DEVICES[0], PHONE);
    try {
      await page.goto("/settings/devices", { waitUntil: "domcontentloaded" });
      const owner = page.getByTestId("device-owner").first();
      await expect(owner).toBeVisible({ timeout: 30_000 });
      await owner.click();
      await page.getByRole("option", { name: NAMES[2] }).click();
      await expect
        .poll(() => psql(`SELECT COALESCE(person_id::text, 'null') FROM devices WHERE hardware_id = '${hw(DEVICES[0])}'`), { timeout: 15_000 })
        .toBe(KIDS[2]);
      await expect(owner).toContainText(NAMES[2]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await owner.click();
      await page.getByRole("option").first().click();
      await expect
        .poll(() => psql(`SELECT COALESCE(person_id::text, 'null') FROM devices WHERE hardware_id = '${hw(DEVICES[0])}'`), { timeout: 15_000 })
        .toBe("null");
    } finally {
      await context.close();
      psql(`UPDATE devices SET person_id = NULL WHERE hardware_id = '${hw(DEVICES[0])}'`);
    }
  });

  test("opens on the child's Rewards page; Home is the dashboard", async ({ browser }) => {
    test.setTimeout(120_000);
    creatures(4);
    const { context, page } = await screen(browser, DEVICES[2], { width: 1280, height: 900 });
    try {
      psql(`UPDATE devices SET person_id = '${KIDS[1]}', is_kiosk = false WHERE hardware_id = '${hw(DEVICES[2])}'`);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`/rewards\\?child=${KIDS[1]}$`), { timeout: 30_000 });
      await expect(page.getByTestId("rewards-page")).toHaveAttribute("data-child", KIDS[1], { timeout: 30_000 });

      // Home, tapped: the dashboard, and it stays.
      // A click on the element itself: in dev, Next's issue badge sits over
      // the pinned Home link at the bottom left and would take the tap.
      await page.locator('nav a[href="/"]:visible').first().evaluate((a) => (a as HTMLAnchorElement).click());
      await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
      await expect(page.getByTestId("creatures-widget")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await expect(page).toHaveURL(/\/$/);

      // Opened again (a reload is a start): the creature again.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`/rewards\\?child=${KIDS[1]}$`), { timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test("a child whose creature is switched off: the dashboard", async ({ browser }) => {
    test.setTimeout(120_000);
    psql(`UPDATE creatures SET enabled = false WHERE person_id = '${KIDS[1]}'`);
    const { context, page } = await screen(browser, DEVICES[2], { width: 1280, height: 900 });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("creatures-widget")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await expect(page).toHaveURL(/\/$/);
    } finally {
      await context.close();
      creatures(4);
    }
  });

  test("a kiosk ignores it: the family's screen opens on the dashboard", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await screen(browser, DEVICES[3], { width: 1280, height: 900 });
    try {
      psql(`UPDATE devices SET person_id = '${KIDS[1]}', is_kiosk = true WHERE hardware_id = '${hw(DEVICES[3])}'`);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("creatures-widget")).toBeVisible({ timeout: 30_000 });
      // Past the heartbeat that brings the device row into the store.
      await page.waitForTimeout(5_000);
      await expect(page).toHaveURL(/\/$/);
      expect(await page.evaluate(() => document.cookie.includes("person_id"))).toBe(true);
    } finally {
      await context.close();
    }
  });
});

test.describe("the creatures cheer on the new surfaces", () => {
  async function tickAndWatch(page: Page, scope: Locator) {
    psql(`UPDATE todos SET completed = false WHERE id = '${TASK}'`);
    await page.waitForTimeout(3_000);
    psql(`UPDATE todos SET completed = true WHERE id = '${TASK}'`);
    await expect(scope.getByTestId("creature-reaction")).toHaveText("+5 ⭐", { timeout: 10_000 });
  }

  for (const [where, path, scope] of [
    ["the Creatures widget", "/", (p: Page) => p.locator(`[data-testid=creature-cell][data-person="${KIDS[0]}"]`)],
    ["the tasks page", "/todos", (p: Page) => p.locator(`[data-testid=todo-child][data-person="${KIDS[0]}"]`)],
    ["the Rewards page", `/rewards?child=${KIDS[0]}`, (p: Page) => p.getByTestId("rewards-creature")],
  ] as const) {
    test(`a tick on another screen: ${where}`, async ({ browser }) => {
      test.setTimeout(120_000);
      creatures(4);
      const { context, page } = await screen(browser, DEVICES[1], WALL);
      try {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        const host = scope(page).locator("[data-testid=creature-reaction-host]");
        await expect(host).toBeVisible({ timeout: 30_000 });
        // Realtime subscribed.
        await page.waitForTimeout(3_000);
        await tickAndWatch(page, scope(page));
      } finally {
        await context.close();
      }
    });
  }

  test("the tasks page: only the children with a creature have one, and nothing breaks at phone width", async ({ browser }) => {
    test.setTimeout(120_000);
    creatures(2);
    const { context, page } = await screen(browser, DEVICES[1], PHONE);
    try {
      await page.goto("/todos", { waitUntil: "domcontentloaded" });
      const row = page.getByTestId("todo-children");
      await expect(row).toBeVisible({ timeout: 30_000 });
      const chip = (id: string) => row.locator(`[data-testid=todo-child][data-person="${id}"]`);
      await expect(chip(KIDS[0]).locator("[data-testid=creature-reaction-host]")).toBeVisible();
      await expect(chip(KIDS[1]).locator("[data-testid=creature-reaction-host]")).toBeVisible();
      // The family uses points, so every child has a chip; only two a creature.
      await expect(chip(KIDS[2])).toBeVisible();
      await expect(chip(KIDS[2]).locator("[data-testid=creature-reaction-host]")).toHaveCount(0);
      await expect(chip(NO_CREATURE).locator("[data-testid=creature-reaction-host]")).toHaveCount(0);
      await expect(row.locator(".creature-animated")).toHaveCount(0);
      await expectTidy(page, row, row.getByTestId("todo-child"));
    } finally {
      await context.close();
      creatures(4);
    }
  });
});
