import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * The creature shop (RFC-017 §5) in a browser against the stack: on
 * /rewards a child buys, wears and takes off an item with no PIN; turned off
 * by a parent the shop is gone and the item stays on; Change look offers what
 * was bought; the shop fits a phone; Settings -> Creatures & rewards lists
 * what each child bought, with the dates.
 *
 * Only psql and the app, so CI runs it under WebKit too (e2e.yml). The
 * database half is creature-shop-live.spec.ts. In a family of its own,
 * `claude-shop-ui`, removed with its devices afterwards.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const ID = (n: string) => `c1a0de00-0218-4000-8000-00000000${n}`;
const FAMILY = ID("f001");
const KID = ID("f0a1");
const KID2 = ID("f0a2");
const JOIN_CODE = "CLAUDESHUI";
const DEVICE = "claude-shop-ui";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE family_id = '${FAMILY}' OR hardware_id LIKE '%${DEVICE}%';
    DELETE FROM families WHERE id = '${FAMILY}';
    DELETE FROM people WHERE id IN ('${KID}', '${KID2}');`);
}

/** The child has earned exactly `points`, owns nothing, and a creature with the shop on. */
function reset(points: number, child = KID) {
  psql(`DELETE FROM point_purchases WHERE person_id = '${child}';
    DELETE FROM todo_point_awards WHERE person_id = '${child}';
    ${points > 0 ? `INSERT INTO todo_point_awards (family_id, person_id, completion_key, points) VALUES ('${FAMILY}', '${child}', 'claude-shop-ui', ${points});` : ""}
    UPDATE creatures SET enabled = true, shop_enabled = true, look = '{}'::jsonb, style = 'gumdrop' WHERE person_id = '${child}';`);
}

const owned = (child = KID) => psql(`SELECT coalesce(string_agg(item_id, ',' ORDER BY item_id), '') FROM point_purchases WHERE person_id = '${child}'`);

test.beforeAll(() => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-shop-ui', '${JOIN_CODE}', true);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES
      ('${KID}', '${FAMILY}', 'claude-Mia', true, '#56B6E8'), ('${KID2}', '${FAMILY}', 'claude-Ben', true, '#E85656');
    INSERT INTO creatures (person_id, family_id, species, style, enabled, shop_enabled) VALUES
      ('${KID}', '${FAMILY}', 'dragon', 'gumdrop', true, true), ('${KID2}', '${FAMILY}', 'princess', 'sticker', true, true);`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id = '${FAMILY}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE '%${DEVICE}%'`)).toBe("0");
});

test.describe("the shop on /rewards", () => {
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });

  const card = (page: Page, item: string) => page.getByTestId(`shop-item-${item}`);

  test("buy, wear and take off; turned off, the shop is gone and the item stays on", async ({ page }) => {
    test.setTimeout(180_000);
    reset(100);
    await establishSession(page, JOIN_CODE, DEVICE);
    await page.goto(`/rewards?child=${KID}`, { waitUntil: "domcontentloaded" });
    const shop = page.getByTestId("creature-shop");
    await expect(shop).toBeVisible({ timeout: 60_000 });
    await expect(shop.getByRole("heading", { name: /Shop|Boutique/ })).toBeVisible();
    // every item, each with the child's dragon wearing it
    await expect(shop.locator('[data-testid^="shop-item-"]')).toHaveCount(19);
    await expect(card(page, "pirate_hat").locator('svg [data-item="pirate_hat"]')).toHaveCount(1);
    // 120 points is more than 100
    await expect(card(page, "outer_space").getByTestId("shop-buy")).toBeDisabled();

    await card(page, "pirate_hat").getByTestId("shop-buy").click();
    await page.getByTestId("shop-confirm").click();
    await expect(card(page, "pirate_hat")).toHaveAttribute("data-owned", "true", { timeout: 30_000 });
    await expect(page.getByTestId("points-balance")).toContainText("60");
    expect(owned()).toBe("pirate_hat");

    await card(page, "pirate_hat").getByTestId("shop-wear").click();
    await expect(card(page, "pirate_hat")).toHaveAttribute("data-worn", "true", { timeout: 30_000 });
    const creature = page.getByTestId("rewards-creature");
    await expect(creature.locator('svg [data-item="pirate_hat"]')).toHaveCount(1);
    expect(psql(`SELECT look->>'head' FROM creatures WHERE person_id = '${KID}'`)).toBe("pirate_hat");

    // Change look offers it in its slot
    await page.getByTestId("change-look").click();
    await expect(page.getByTestId("look-head").locator('[data-value="pirate_hat"]')).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    await card(page, "pirate_hat").getByTestId("shop-wear").click();
    await expect(card(page, "pirate_hat")).toHaveAttribute("data-worn", "false", { timeout: 30_000 });
    await expect(creature.locator('svg [data-item="pirate_hat"]')).toHaveCount(0);
    await card(page, "pirate_hat").getByTestId("shop-wear").click();
    await expect(creature.locator('svg [data-item="pirate_hat"]')).toHaveCount(1, { timeout: 30_000 });

    // A parent turns the shop off: gone, and the hat stays on.
    psql(`UPDATE creatures SET shop_enabled = false WHERE person_id = '${KID}'`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("rewards-creature")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("rewards-panel")).toBeVisible();
    await expect(page.getByTestId("creature-shop")).toHaveCount(0);
    await expect(page.getByTestId("rewards-creature").locator('svg [data-item="pirate_hat"]')).toHaveCount(1);
    psql(`UPDATE creatures SET shop_enabled = true WHERE person_id = '${KID}'`);
  });

  test("no page wider than the phone, and the cards inside the shop", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await establishSession(page, JOIN_CODE, DEVICE);
    await page.goto(`/rewards?child=${KID2}`, { waitUntil: "domcontentloaded" });
    const shop = page.getByTestId("creature-shop");
    await expect(shop).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const box = (await shop.boundingBox())!;
    const cards = shop.locator('[data-testid^="shop-item-"]');
    for (let i = 0; i < (await cards.count()); i++) {
      const b = (await cards.nth(i).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
    if (process.env.SHOT_DIR) {
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await shop.screenshot({ path: `${process.env.SHOT_DIR}/shop-phone-${scheme}.png` });
      }
    }
  });

  test("the parent's list of what was bought, with dates", async ({ page }) => {
    test.setTimeout(120_000);
    reset(100);
    psql(`INSERT INTO point_purchases (family_id, person_id, item_id, cost, created_at) VALUES
      ('${FAMILY}', '${KID}', 'bow_tie', 20, now() - interval '2 days'), ('${FAMILY}', '${KID}', 'snow', 70, now())`);
    await establishSession(page, JOIN_CODE, DEVICE);
    await page.goto("/settings/creatures", { waitUntil: "domcontentloaded" });
    const list = page.getByTestId(`purchases-${KID}`);
    await expect(list).toBeVisible({ timeout: 60_000 });
    const rows = list.getByTestId("purchase-row");
    await expect(rows).toHaveCount(2);
    await expect(list).toContainText(/Snow|Schnee|Neige/);
    await expect(list).toContainText(/Bow tie|Fliege|Nœud papillon/);
    await expect(rows.first().locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId(`purchases-${KID2}`)).toContainText(/Nothing bought yet|Noch nichts gekauft|Rien acheté/);
  });
});
