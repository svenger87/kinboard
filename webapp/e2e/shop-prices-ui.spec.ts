import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * The family's own shop prices, end to end on a running stack, in a family of
 * its own: a child with a creature and 100 points; the cap set to 7 on
 * Settings -> Creatures; the shop on /rewards showing 7; a purchase charged 7;
 * the generic settings route and bad prices refused; back to the standard
 * prices, and the next purchase charged the standard price while the cap keeps
 * what it cost. The rules are in shop-prices.spec.ts.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

async function call(page: Page, path: string, method: string, body: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { path, method, body },
  );
}

async function setUp(page: Page, familyId: string): Promise<string> {
  return page.evaluate(async (familyId) => {
    const { token } = await (await fetch("/api/session/token", { cache: "no-store" })).json();
    const rest = async (path: string, method: string, body: unknown) => {
      const r = await fetch(`/rest/v1/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
      return r.json();
    };
    const [kid] = await rest("people", "POST", [{ family_id: familyId, name: "Probe Ana", is_child: true, color: "#56B6E8" }]);
    const c = await fetch("/api/creatures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ person_id: kid.id, species: "dragon" }) });
    if (!c.ok) throw new Error(`creature: ${c.status}`);
    const [task] = await rest("todos", "POST", [{ family_id: familyId, title: "Probe task", person_id: kid.id, points: 100 }]);
    await rest(`todos?id=eq.${task.id}`, "PATCH", { completed: true });
    return kid.id as string;
  }, familyId);
}

test.describe("shop prices", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  test.describe.configure({ timeout: 180_000 });

  test("a parent's price is what the shop shows and charges; the standard one again after the reset", async ({ page, baseURL }) => {
    const familyName = `probe-family-shop-prices-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await gotoAfterJoin(page, "/");
      const kid = await setUp(page, familyId);

      // Settings -> Creatures: the cap from 25 to 7.
      await page.goto("/settings/creatures#prices", { waitUntil: "domcontentloaded" });
      const field = page.locator("#price-cap");
      await expect(field).toHaveValue("25", { timeout: 30_000 });
      await expect(page.getByTestId("price-standard-cap")).toHaveCount(0);
      const saved = page.waitForResponse((r) => r.url().includes("/api/creatures/shop-prices") && r.request().method() === "PUT");
      await field.fill("7");
      await field.press("Enter");
      expect((await saved).status()).toBe(200);
      await expect(page.getByTestId("price-standard-cap")).toHaveText("standard 25");
      await expect(page.locator("#price-cap")).toHaveValue("7");

      // Only through its own route, and only good prices.
      expect((await call(page, "/api/settings", "PUT", { family_id: familyId, key: "shop_prices", value: { cap: 1 } })).status).toBe(403);
      const bad = await call(page, "/api/creatures/shop-prices", "PUT", { prices: { cap: 0 } });
      expect([bad.status, bad.body?.error]).toEqual([400, "bad_price"]);
      const unknown = await call(page, "/api/creatures/shop-prices", "PUT", { prices: { crown: 5 } });
      expect([unknown.status, unknown.body?.error]).toEqual([400, "unknown_item"]);

      // The shop shows 7, and a purchase is charged 7 whatever the request says.
      await page.goto(`/rewards?child=${kid}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("shop-item-cap")).toContainText("7 points", { timeout: 30_000 });
      await expect(page.getByTestId("shop-item-scarf")).toContainText("20 points");
      const bought = await call(page, `/api/creatures/${kid}/purchases`, "POST", { item_id: "cap", cost: 1 });
      expect([bought.status, bought.body?.purchase?.cost]).toEqual([201, 7]);

      // Back to the standard prices: the setting goes, the scarf costs 20, the cap kept its 7.
      await page.goto("/settings/creatures#prices", { waitUntil: "domcontentloaded" });
      const reset = page.waitForResponse((r) => r.url().includes("/api/creatures/shop-prices") && r.request().method() === "PUT");
      await page.getByRole("button", { name: "Back to the standard prices" }).click();
      expect((await reset).status()).toBe(200);
      await expect(page.locator("#price-cap")).toHaveValue("25");
      const scarf = await call(page, `/api/creatures/${kid}/purchases`, "POST", { item_id: "scarf" });
      expect([scarf.status, scarf.body?.purchase?.cost]).toEqual([201, 20]);
      const costs = await page.evaluate(async (kid) => {
        const { token } = await (await fetch("/api/session/token", { cache: "no-store" })).json();
        const r = await fetch(`/rest/v1/point_purchases?person_id=eq.${kid}&select=item_id,cost&order=item_id`, { headers: { Authorization: `Bearer ${token}` } });
        return r.json();
      }, kid);
      expect(costs).toEqual([{ item_id: "cap", cost: 7 }, { item_id: "scarf", cost: 20 }]);
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});
