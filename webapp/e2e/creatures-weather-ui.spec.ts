import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * The creatures on Home react to the weather effects showing, end to end on
 * a running stack, in a family of its own with two hatched creatures on Home
 * and no bedtime: Home's weather Preview (`?weather-preview=`) shows rain, a
 * storm and the heat. In rain every creature holds an umbrella, in a storm it
 * shakes, in the heat one goes to lie on its towel, happy; with no weather
 * showing there is none of it. The rules are in creatures-weather.spec.ts.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

async function setUp(page: Page, familyId: string): Promise<string[]> {
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
    const put = async (key: string, value: unknown) => {
      const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_id: familyId, key, value }) });
      if (!r.ok) throw new Error(`settings ${key}: ${r.status}`);
    };
    const kids = await rest("people", "POST", [
      { family_id: familyId, name: "Probe Ana", is_child: true, color: "#56B6E8" },
      { family_id: familyId, name: "Probe Ben", is_child: true, color: "#E8A956" },
    ]);
    const ids: string[] = kids.map((k: { id: string }) => k.id);
    for (const [i, id] of ids.entries()) {
      const c = await fetch("/api/creatures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ person_id: id, species: i === 0 ? "owl" : "unicorn" }) });
      if (!c.ok) throw new Error(`creature: ${c.status}`);
      const [task] = await rest("todos", "POST", [{ family_id: familyId, title: `Probe task ${i}`, person_id: id, points: 60 }]);
      await rest(`todos?id=eq.${task.id}`, "PATCH", { completed: true });
    }
    await put("creatures_on_home", true);
    // No bedtime (the same time twice), whatever the hour.
    await put("creature_bedtime", { sleep: "12:00", wake: "12:00" });
    return ids;
  }, familyId);
}

async function preview(page: Page, effects: string) {
  await page.goto(`/?weather-preview=${effects}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("home-creatures")).toHaveAttribute("data-weather", effects, { timeout: 30_000 });
}

test.describe("creatures and the weather on Home", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  test.describe.configure({ timeout: 240_000 });

  test("umbrellas in rain, shaking in a storm, a towel in the heat (up with a tap), and nothing on a calm day", async ({ page, baseURL }) => {
    const familyName = `probe-family-creature-weather-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await gotoAfterJoin(page, "/");
      const kids = await setUp(page, familyId);

      // Rain: every creature holds an umbrella.
      await preview(page, "rain");
      await expect(page.getByTestId("home-creature-umbrella")).toHaveCount(kids.length);
      for (const id of kids) {
        await expect(page.locator(`[data-testid="home-creature"][data-person="${id}"]`)).toHaveAttribute("data-umbrella", "rain");
      }

      // A storm: the umbrellas shake.
      await preview(page, "storm");
      await expect(page.locator(".home-creature-umbrella-storm")).toHaveCount(kids.length);

      // The heat: no umbrellas; within a minute one lies on its towel, eyes open.
      await preview(page, "heat");
      await expect(page.getByTestId("home-creature-umbrella")).toHaveCount(0);
      const sunning = page.locator('[data-testid="home-creature"][data-sun="true"]').first();
      await expect(sunning).toBeAttached({ timeout: 60_000 });
      const who = await sunning.getAttribute("data-person");
      await expect
        .poll(async () => Number(await page.locator(`[data-testid="home-creature-towel"][data-person="${who}"]`).evaluate((el) => getComputedStyle(el).opacity)), { timeout: 5_000 })
        .toBeGreaterThan(0.5);
      await expect(sunning.locator(".home-creature-zzz")).toHaveCount(0);
      // A tap: it gets up, and the towel rolls away as it does, not all at once.
      const towel = page.locator(`[data-testid="home-creature-towel"][data-person="${who}"]`);
      await sunning.locator("button").click();
      const fading = await towel.evaluate(
        (el) =>
          new Promise<number[]>((done) => {
            const seen: number[] = [];
            const t0 = performance.now();
            const tick = () => {
              seen.push(Number(getComputedStyle(el).opacity));
              if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
              else done(seen);
            };
            tick();
          }),
      );
      expect(fading.some((o) => o > 0.05 && o < 0.95)).toBe(true);
      expect(fading[fading.length - 1]).toBe(0);
      await expect(page.locator(`[data-testid="home-creature"][data-person="${who}"]`)).not.toHaveAttribute("data-sun", "true");

      // Calm: the Preview over, nothing of it left.
      await page.evaluate(() => sessionStorage.removeItem("kinboard.weatherPreview"));
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("home-creatures")).toHaveAttribute("data-count", String(kids.length), { timeout: 30_000 });
      await expect(page.getByTestId("home-creatures")).toHaveAttribute("data-weather", "");
      await expect(page.getByTestId("home-creature-umbrella")).toHaveCount(0);
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});
