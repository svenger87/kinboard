import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * Creatures on Home, end to end on a running stack, in a family of its own:
 * two children whose creatures have hatched (a 50-point task each, ticked),
 * the switch on Settings -> Creatures, then on Home the creatures walking,
 * hopping when tapped while taps elsewhere on the floor go through, lying
 * down at the family's bedtime (an egg too, upright), standing still with reduced motion and gone
 * with animations off. The rules are in creatures-on-home.spec.ts.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

const floor = (page: Page) => page.getByTestId("home-creatures");
const creatures = (page: Page) => page.getByTestId("home-creature");

/** The family's REST and API, from the page, as its own screens use them. */
async function setUp(page: Page, familyId: string) {
  return page.evaluate(async (familyId) => {
    const { token } = await (await fetch("/api/session/token", { cache: "no-store" })).json();
    const rest = (path: string, method: string, body: unknown) =>
      fetch(`/rest/v1/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
        return r.json();
      });
    const kids = await rest("people", "POST", [
      { family_id: familyId, name: "Probe Ana", is_child: true, color: "#56B6E8" },
      { family_id: familyId, name: "Probe Ben", is_child: true, color: "#E8A956" },
    ]);
    const ids: string[] = kids.map((k: { id: string }) => k.id);
    for (const [i, id] of ids.entries()) {
      const r = await fetch("/api/creatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: id, species: i === 0 ? "dragon" : "unicorn" }),
      });
      if (!r.ok) throw new Error(`creature: ${r.status} ${await r.text()}`);
      // 50 points hatches the egg: a task worth that, done.
      const [task] = await rest("todos", "POST", [{ family_id: familyId, title: `Probe task ${i}`, person_id: id, points: 50 }]);
      await rest(`todos?id=eq.${task.id}`, "PATCH", { completed: true });
    }
    return ids;
  }, familyId);
}

/** A third child whose creature hasn't hatched: an egg, no points. */
async function addEgg(page: Page, familyId: string): Promise<string> {
  return page.evaluate(async (familyId) => {
    const { token } = await (await fetch("/api/session/token", { cache: "no-store" })).json();
    const r = await fetch("/rest/v1/people", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify([{ family_id: familyId, name: "Probe Cleo", is_child: true, color: "#8E56E8" }]),
    });
    if (!r.ok) throw new Error(`egg child: ${r.status}`);
    const [{ id }] = await r.json();
    const c = await fetch("/api/creatures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ person_id: id, species: "owl" }) });
    if (!c.ok) throw new Error(`egg creature: ${c.status}`);
    return id as string;
  }, familyId);
}

async function putSetting(page: Page, familyId: string, key: string, value: unknown) {
  const ok = await page.evaluate(
    async ({ familyId, key, value }) =>
      (await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_id: familyId, key, value }) })).ok,
    { familyId, key, value },
  );
  expect(ok, key).toBe(true);
}

/** Each creature's left edge on screen, by child. */
async function positions(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-testid="home-creature"]')].map((el) => [el.dataset.person, el.getBoundingClientRect().left]),
    ),
  );
}

test.describe("creatures on Home", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  test.describe.configure({ timeout: 240_000 });

  test("hatched creatures walk and hop on Home, lie down at bedtime, and keep still or go with the animation switch", async ({ page, baseURL }) => {
    const familyName = `probe-family-creatures-home-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await gotoAfterJoin(page, "/");
      const kids = await setUp(page, familyId);
      expect(kids).toHaveLength(2);
      // No bedtime (the same time twice) while they should walk, whatever the hour: the default
      // 20:00 to 06:30 would put them to bed for anyone running this in the evening.
      await putSetting(page, familyId, "creature_bedtime", { sleep: "12:00", wake: "12:00" });

      // Off until switched on, on Settings -> Creatures.
      await expect(floor(page)).toHaveCount(0);
      await page.goto("/settings/creatures", { waitUntil: "domcontentloaded" });
      const toggle = page.locator("#creatures-on-home");
      await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
      const saved = page.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PUT");
      await toggle.click();
      expect((await saved).ok()).toBe(true);

      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(floor(page)).toHaveAttribute("data-count", "2", { timeout: 30_000 });
      await expect(creatures(page)).toHaveCount(2);
      // Hatched: not eggs.
      for (const id of kids) {
        await expect(page.locator(`[data-testid="home-creature"][data-person="${id}"]`)).not.toHaveAttribute("data-state", "egg", { timeout: 20_000 });
      }

      // They walk: over twelve seconds, at least one of them gets somewhere else.
      const before = await positions(page);
      await page.waitForTimeout(12_000);
      const after = await positions(page);
      expect(Math.max(...kids.map((id) => Math.abs(after[id] - before[id]))), JSON.stringify({ before, after })).toBeGreaterThan(15);

      // Home keeps the floor free at its bottom: the column's bottom padding is the floor's height,
      // so the lowest widget ends above the creatures instead of under them.
      const room = await page.evaluate(() => {
        const floorEl = document.querySelector<HTMLElement>('[data-testid="home-creatures"]')!;
        const column = document.querySelector<HTMLElement>(".home-column")!;
        return { floor: floorEl.getBoundingClientRect().height, padding: parseFloat(getComputedStyle(column).paddingBottom) };
      });
      expect(room.floor).toBeGreaterThan(0);
      expect(room.padding).toBeCloseTo(room.floor, 0);

      // Under the screensaver they stop: nobody sees them, and on a wall display that is most of the day.
      await page.evaluate(() => document.documentElement.setAttribute("data-screensaver", "true"));
      await page.waitForTimeout(500);
      const covered = await positions(page);
      await page.waitForTimeout(6_000);
      expect(await positions(page), "no steps under the screensaver").toEqual(covered);
      await page.evaluate(() => document.documentElement.removeAttribute("data-screensaver"));
      await expect
        .poll(async () => {
          const now = await positions(page);
          return Math.max(...kids.map((id) => Math.abs(now[id] - covered[id])));
        }, { timeout: 20_000 })
        .toBeGreaterThan(5);

      // Taps elsewhere on the floor go through to the page.
      const free = await page.evaluate(() => {
        const floorEl = document.querySelector<HTMLElement>('[data-testid="home-creatures"]')!;
        const box = floorEl.getBoundingClientRect();
        const taken = [...document.querySelectorAll('[data-testid="home-creature"]')].map((c) => c.getBoundingClientRect());
        for (let x = box.left + 5; x < box.right; x += 20) {
          if (taken.some((t) => x > t.left - 10 && x < t.right + 10)) continue;
          const hit = document.elementFromPoint(x, box.bottom - 10);
          return { x, inFloor: Boolean(hit?.closest('[data-testid="home-creatures"]')) };
        }
        return null;
      });
      expect(free?.inFloor).toBe(false);

      // A tap: it hops. Not mid-jump onto or off a card: in the air a tap only sends a heart.
      const first = page.locator(`[data-testid="home-creature"][data-person="${kids[0]}"]`);
      await expect.poll(() => first.getAttribute("data-state"), { intervals: [30], timeout: 5_000 }).not.toBe("jump");
      await first.getByRole("button").click({ force: true });
      await expect.poll(() => first.getAttribute("data-state"), { intervals: [30], timeout: 2_000 }).toBe("hop");

      // Bedtime from a minute ago, on the family's clock: both lie down.
      const clock = await page.evaluate(async () => {
        const zone = ((await (await fetch("/api/time-zone")).json()) as { server: string }).server;
        const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
        return { sleep: hhmm(new Date(Date.now() - 60_000)), wake: hhmm(new Date(Date.now() + 120 * 60_000)) };
      });
      // An egg sleeps too, where it stands (it is not turned on its side).
      const egg = await addEgg(page, familyId);
      await putSetting(page, familyId, "creature_bedtime", clock);
      await page.reload({ waitUntil: "domcontentloaded" });
      for (const id of [...kids, egg]) {
        await expect(page.locator(`[data-testid="home-creature"][data-person="${id}"]`)).toHaveAttribute("data-lying", "true", { timeout: 20_000 });
      }
      const eggEl = page.locator(`[data-testid="home-creature"][data-person="${egg}"]`);
      await expect(eggEl).toHaveAttribute("data-egg", "true");
      await expect(eggEl.locator(".home-creature-body")).not.toHaveAttribute("style", /rotate\(-[1-9]/);
      await expect(page.locator(".home-creature-zzz")).toHaveCount(3);
      // Back to the default the way the card's button does it (a setting can't be saved empty).
      await putSetting(page, familyId, "creature_bedtime", { sleep: "20:00", wake: "06:30" });

      // Reduced motion: they stand still.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(creatures(page)).toHaveCount(3, { timeout: 30_000 });
      // Once they are drawn where they stand (the first frame sets each one's place).
      await expect.poll(async () => Math.min(...Object.values(await positions(page))), { timeout: 5_000 }).toBeGreaterThan(0);
      const still1 = await positions(page);
      await page.waitForTimeout(5_000);
      expect(await positions(page)).toEqual(still1);
      await page.emulateMedia({ reducedMotion: "no-preference" });

      // Animations off on this screen: none.
      await page.evaluate(() => localStorage.setItem("kinboard_motion", "off"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeAttached();
      await page.waitForTimeout(3_000);
      await expect(floor(page)).toHaveCount(0);
      await page.evaluate(() => localStorage.removeItem("kinboard_motion"));

      // Switched off: none.
      await putSetting(page, familyId, "creatures_on_home", false);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3_000);
      await expect(floor(page)).toHaveCount(0);
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});
