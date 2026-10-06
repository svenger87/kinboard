import { test, expect, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";
import { wallMinutes } from "../src/lib/creature-mood";

/**
 * A creature's mood on the real screens (RFC-016, lib/creature-mood.ts): it
 * turns happy when the child's last task for today is ticked off, on the
 * dashboard widget, the profile, the pocket-money page and the stages sheet's
 * current stage; and it falls asleep at 20:00 in the family's time zone
 * without a reload, the "z z" moving only where the creature moves.
 *
 * It works in a family of its own, `claude-creature-mood`, created here and
 * removed with its devices afterwards. The family's time zone is one where it
 * is daytime as the test runs, so "happy" is not hidden by "sleepy"; the
 * evening is reached with Playwright's clock. Needs a running stack.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const FAMILY = "c1a0de00-0017-4000-8000-00000000f001";
const CHILD = "c1a0de00-0017-4000-8000-00000000f0a1";
const ACCOUNT = "c1a0de00-0017-4000-8000-00000000f0c1";
const TASK = "c1a0de00-0017-4000-8000-00000000f0d1";
const JOIN_CODE = "CLAUDEMOOD";
const DEVICE = "claude-creature-mood";
const TASK_TITLE = "claude-mood brush teeth";

/** A zone where it is between 09:00 and 16:00 now: hours of daylight left. */
const ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/New_York", "America/Sao_Paulo", "UTC", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];
const DAY_ZONE = ZONES.find((z) => {
  const m = wallMinutes(new Date(), z);
  return m >= 9 * 60 && m <= 16 * 60;
})!;

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE hardware_id = 'e2e-${DEVICE}';
    DELETE FROM todo_point_awards WHERE family_id = '${FAMILY}';
    DELETE FROM todos WHERE family_id = '${FAMILY}';
    DELETE FROM pocket_money_accounts WHERE family_id = '${FAMILY}';
    DELETE FROM people WHERE family_id = '${FAMILY}';
    DELETE FROM settings WHERE family_id = '${FAMILY}';
    DELETE FROM families WHERE id = '${FAMILY}';`);
}

test.beforeAll(() => {
  expect(DAY_ZONE, "some zone is in its daytime").toBeTruthy();
  purge();
  const widgets = JSON.stringify({
    weather: false, upcomingEvents: false, weekOverview: false, schedule: false, mealPlan: false, timers: false,
    tasks: true, pocketMoney: true,
  });
  // Stage 5, so there are eyes to close; seen, so no celebration plays.
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-creature-mood', '${JOIN_CODE}', true);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES ('${CHILD}', '${FAMILY}', 'claude-mood-kid', true, '#56B6E8');
    INSERT INTO pocket_money_accounts (id, family_id, person_id, balance_cents, reward_mode, avatar_species, avatar_style, best_tier, last_seen_tier)
      VALUES ('${ACCOUNT}', '${FAMILY}', '${CHILD}', 0, 'points', 'dragon', 'sticker', 5, 5);
    SELECT public.creatures_from_accounts('${FAMILY}');
    INSERT INTO todos (id, family_id, title, person_id, recurrence, points)
      VALUES ('${TASK}', '${FAMILY}', '${TASK_TITLE}', '${CHILD}', 'daily', 0);
    INSERT INTO settings (family_id, key, value) VALUES
      ('${FAMILY}', 'widget_visibility', '${widgets}'::jsonb),
      ('${FAMILY}', 'timezone', '"${DAY_ZONE}"'::jsonb);`);
});

test.afterAll(() => {
  purge();
});

async function open(browser: Browser, path: string, clock = false): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await establishSession(page, JOIN_CODE, DEVICE);
  if (clock) await page.clock.install({ time: new Date() });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  return { page, close: () => context.close() };
}

const widgetSvg = (page: Page) => page.locator("[data-testid=creature-reaction-host] svg[data-species]").first();

test("the last task of the day ticked: the creature turns happy everywhere", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, close } = await open(browser, "/");
  try {
    const svg = widgetSvg(page);
    await expect(svg).toHaveAttribute("data-mood", "normal", { timeout: 30_000 });
    await expect(page.locator(".creature-happy-sparkle")).toHaveCount(0);
    await page.waitForTimeout(2_000);

    // Ticked off on the tasks widget, as a person would.
    await page.getByText(TASK_TITLE).first().click();

    // A reaction may play first; then it is happy, and still.
    await expect(svg).toHaveAttribute("data-mood", "happy", { timeout: 10_000 });
    await expect(svg.locator('[data-eyes="happy"]')).toHaveCount(1);
    await expect(svg.locator(".creature-happy-sparkle")).toHaveCount(1);
    await expect(page.locator("[data-testid=creature-reaction-host] .creature-animated")).toHaveCount(0, { timeout: 5_000 });

    // The profile wears it too.
    await page.getByRole("button", { name: /claude-mood-kid/ }).first().click();
    await expect(page.locator("[data-testid=profile-pet-avatar] svg")).toHaveAttribute("data-mood", "happy", { timeout: 10_000 });
  } finally {
    await close();
  }
});

test("the page and the stages sheet: happy on the current stage only", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, close } = await open(browser, "/pocket-money");
  try {
    const big = widgetSvg(page);
    await expect(big).toHaveAttribute("data-mood", "happy", { timeout: 30_000 });
    await page.getByRole("button", { name: "Show all evolution stages" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.locator("svg[data-tier='5']")).toHaveAttribute("data-mood", "happy");
    for (const tier of [2, 3, 4, 6, 7, 8]) await expect(sheet.locator(`svg[data-tier='${tier}']`)).toHaveAttribute("data-mood", "normal");
  } finally {
    await close();
  }
});

test("at 20:00 in the family's zone it falls asleep, without a reload", async ({ browser }) => {
  test.setTimeout(120_000);
  const toEvening = (now: Date) => (20 * 60 - wallMinutes(now, DAY_ZONE)) * 60_000 + 5_000;

  // Today's task done (as the first test leaves it), so this runs on its own too.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: DAY_ZONE }).format(new Date());
  psql(`UPDATE todos SET last_completed = now(), last_completed_day = '${today}' WHERE id = '${TASK}'`);

  const dash = await open(browser, "/", true);
  try {
    const svg = widgetSvg(dash.page);
    await expect(svg).toHaveAttribute("data-mood", "happy", { timeout: 30_000 });
    await dash.page.clock.fastForward(toEvening(new Date()));
    // The minute clock notices within its next tick.
    await dash.page.clock.fastForward(61_000);
    await expect(svg).toHaveAttribute("data-mood", "sleepy", { timeout: 10_000 });
    await expect(svg.locator(".creature-zzz")).toHaveCount(1);
    // The widget stands still: the z z does not float.
    await expect(dash.page.locator("[data-testid=creature-reaction-host] .creature-animated")).toHaveCount(0);
  } finally {
    await dash.close();
  }

  const own = await open(browser, "/pocket-money", true);
  try {
    await own.page.clock.fastForward(toEvening(new Date()) + 61_000);
    const svg = widgetSvg(own.page);
    await expect(svg).toHaveAttribute("data-mood", "sleepy", { timeout: 30_000 });
    // The page's creature breathes, and its z z float with it.
    await expect(svg).toHaveClass(/creature-animated/);
    const zAnimation = await svg.locator(".creature-zzz").evaluate((el) => getComputedStyle(el).animationName);
    expect(zAnimation).toBe("creature-zzz");
  } finally {
    await own.close();
  }
});
