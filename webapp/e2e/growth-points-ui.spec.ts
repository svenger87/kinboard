import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * The family's own growth, end to end on a running stack, in a family of its
 * own: a child whose owl has 160 points (stage 3 with the standard numbers).
 * Raising stage 3 to 200 on Settings -> Creatures keeps the owl at stage 3
 * (its floor is written); stage 4 below stage 3 is refused on the card; lowering
 * stages 3 and 4 to 120 and 160 grows it to stage 4 at once;
 * the generic settings route and a list that isn't rising are refused. The rules are in growth-points.spec.ts.
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
    const c = await fetch("/api/creatures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ person_id: kid.id, species: "owl" }) });
    if (!c.ok) throw new Error(`creature: ${c.status}`);
    const [task] = await rest("todos", "POST", [{ family_id: familyId, title: "Probe task", person_id: kid.id, points: 160 }]);
    await rest(`todos?id=eq.${task.id}`, "PATCH", { completed: true });
    return kid.id as string;
  }, familyId);
}

/**
 * The Rewards page draws the child's owl at `tier`: the main creature, once
 * the points have loaded (it is drawn from best_tier alone before that).
 */
async function expectStage(page: Page, kid: string, tier: string) {
  await page.goto(`/rewards?child=${kid}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("creature-shop")).toBeVisible({ timeout: 30_000 });
  const owl = page.getByTestId("rewards-creature").locator('svg.creature-svg[data-species="owl"]');
  await expect(owl).toHaveAttribute("data-tier", tier, { timeout: 20_000 });
}

async function setStage(page: Page, stage: number, value: string) {
  await page.goto("/settings/creatures#growth", { waitUntil: "domcontentloaded" });
  const field = page.locator(`#growth-${stage}`);
  await expect(field).toBeVisible({ timeout: 30_000 });
  // The fields stay locked until the family's numbers are in.
  await expect(field).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForResponse((r) => r.url().includes("/api/creatures/growth") && r.request().method() === "PUT");
  await field.fill(value);
  await field.press("Enter");
  const res = await saved;
  expect(res.status()).toBe(200);
  return (await res.json()) as { points: number[] | null; kept: number };
}

test.describe("growth points", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  test.describe.configure({ timeout: 240_000 });

  test("raising a stage keeps the creature where it is, lowering one grows it, and the standard numbers come back", async ({ page, baseURL }) => {
    const familyName = `probe-family-growth-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await gotoAfterJoin(page, "/");
      const kid = await setUp(page, familyId);
      // Let the Rewards page record the stage it shows before anything changes.
      await expectStage(page, kid, "3");

      // Raise stage 3 to 200: 160 points no longer reach it, but the owl keeps it.
      const raised = await setStage(page, 3, "200");
      expect(raised).toEqual({ points: [50, 200, 300, 600, 1000, 1600, 2500], kept: 1 });
      await expect(page.getByTestId("growth-standard-3")).toHaveText("standard 150");
      await expectStage(page, kid, "3");

      // Stage 4 below stage 3 is refused on the card: a message, nothing saved, the field as it was.
      await page.goto("/settings/creatures#growth", { waitUntil: "domcontentloaded" });
      const four = page.locator("#growth-4");
      await expect(page.locator("#growth-3")).toHaveValue("200", { timeout: 30_000 });
      await expect(four).toBeEnabled();
      await expect(four).toHaveValue("300");
      let sent = false;
      page.on("request", (r) => {
        if (r.url().includes("/api/creatures/growth") && r.method() === "PUT") sent = true;
      });
      await four.fill("160");
      await four.press("Enter");
      await expect(page.getByText("Each stage needs more points than the one before it, as whole numbers.")).toBeVisible();
      await expect(four).toHaveValue("300");
      expect(sent).toBe(false);

      // Lower stage 3 to 120, then stage 4 to 160: the owl grows to stage 4 at once.
      expect(await setStage(page, 3, "120")).toEqual({ points: [50, 120, 300, 600, 1000, 1600, 2500], kept: 0 });
      expect(await setStage(page, 4, "160")).toEqual({ points: [50, 120, 160, 600, 1000, 1600, 2500], kept: 0 });
      await expectStage(page, kid, "4");
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });

  test("only through its own route, and only rising lists", async ({ page, baseURL }) => {
    const familyName = `probe-family-growth-api-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await gotoAfterJoin(page, "/");
      expect((await call(page, "/api/settings", "PUT", { family_id: familyId, key: "growth_points", value: [1, 2, 3, 4, 5, 6, 7] })).status).toBe(403);
      const flat = await call(page, "/api/creatures/growth", "PUT", { points: [50, 50, 300, 600, 1000, 1600, 2500] });
      expect([flat.status, flat.body?.error]).toEqual([400, "bad_points"]);
      const short = await call(page, "/api/creatures/growth", "PUT", { points: [50, 150] });
      expect([short.status, short.body?.error]).toEqual([400, "bad_points"]);
      const mine = await call(page, "/api/creatures/growth", "PUT", { points: [10, 20, 30, 40, 50, 60, 70] });
      expect([mine.status, mine.body]).toEqual([200, { points: [10, 20, 30, 40, 50, 60, 70], kept: 0 }]);
      const back = await call(page, "/api/creatures/growth", "PUT", { points: null });
      expect([back.status, back.body]).toEqual([200, { points: null, kept: 0 }]);
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});
