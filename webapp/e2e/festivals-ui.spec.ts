import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * Festivals (RFC-020) end to end on a running stack, in a family of its own:
 * Settings -> Design -> Festivals, the preview on Home, the visitor flying
 * and taking one tap, what each Animations setting leaves (§4), the weather
 * effects unchanged with no festival on, and the dressing never over a
 * card's content at 320px and on a wall. The dates and rules are
 * festivals.spec.ts. Run it with --project=webkit too: WebKit is where
 * layout and `Intl` calendars differ.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

const visitor = (page: Page) => page.getByTestId("festival-visitor");
const tap = (page: Page) => page.getByTestId("festival-visitor-tap");

async function putSetting(page: Page, familyId: string, key: string, value: unknown) {
  const status = await page.evaluate(
    async ({ familyId, key, value }) =>
      (await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_id: familyId, key, value }) })).status,
    { familyId, key, value },
  );
  expect(status).toBe(200);
}

/** Where the snow on each card ends and where the card's own content begins, px. */
async function dressingClearance(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ snowBottom: number; contentTop: number; snow: boolean }> = [];
    for (const card of Array.from(document.querySelectorAll<HTMLElement>(".festival-grid > div"))) {
      const before = getComputedStyle(card, "::before");
      const snow = before.content !== "none" && before.backgroundImage !== "none";
      const box = card.getBoundingClientRect();
      if (box.height === 0) continue;
      // The first thing with text or an icon in it: the title row.
      const first = Array.from(card.querySelectorAll<HTMLElement>("h1, h2, h3, p, span, button, a, svg, img")).find((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.width > 0;
      });
      if (!first) continue;
      out.push({ snow, snowBottom: box.top + parseFloat(before.top) + parseFloat(before.height), contentTop: first.getBoundingClientRect().top });
    }
    return out;
  });
}

test.describe("festivals on Home", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  test.describe.configure({ timeout: 240_000 });

  test("Settings -> Design, a preview on Home, the visitor's one tap, and what each Animations setting leaves", async ({ page, baseURL }) => {
    const familyName = `probe-family-festivals-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      // On by default, with the country's festivals: no region yet, so Christmas.
      await gotoAfterJoin(page, "/settings/theme");
      await expect(page.locator("#festivals-enabled")).toHaveAttribute("aria-checked", "true", { timeout: 60_000 });
      await expect(page.locator("#festival-christmas")).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("#festival-st-martin")).toHaveAttribute("aria-checked", "false");
      // Ticking one makes the list the family's own, kept across a reload.
      const saved = page.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PUT");
      await page.locator("#festival-st-martin").click();
      expect((await saved).ok()).toBe(true);
      await page.reload();
      await expect(page.locator("#festival-st-martin")).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Back to your country's festivals" })).toBeVisible();

      // Preview in place, over the settings page: the wash and the visitor, whatever the date.
      await page.getByTestId("festival-preview-christmas").click();
      await expect(page.locator("html")).toHaveAttribute("data-festival", "christmas");
      await expect(visitor(page)).toHaveAttribute("data-state", "flying", { timeout: 20_000 });
      await page.getByTestId("festival-preview-christmas").click();
      await expect(page.locator("html")).not.toHaveAttribute("data-festival", "christmas");

      // On Home: the lantern walk flies, takes one tap, and the button is gone for the rest of the pass.
      await gotoAfterJoin(page, "/?festival-preview=st-martin");
      await expect(page.locator("html")).toHaveAttribute("data-festival", "st-martin", { timeout: 30_000 });
      await expect(visitor(page)).toHaveAttribute("data-state", "flying", { timeout: 20_000 });
      await page.waitForTimeout(2_500);
      await expect(tap(page)).toBeVisible();
      const box = await tap(page).boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(tap(page)).toBeHidden();
      // The preview outlives taking the parameter out of the address.
      expect(new URL(page.url()).search).toBe("");
      await expect(page.locator("html")).toHaveAttribute("data-festival", "st-martin");

      // The wash's two colours, on every setting; Christmas's snow on the cards.
      const state = () =>
        page.evaluate(() => {
          const card = document.querySelector(".festival-grid > div");
          const before = card ? getComputedStyle(card, "::before") : null;
          return {
            top: getComputedStyle(document.documentElement).getPropertyValue("--festival-top").trim(),
            snow: !!before && before.content !== "none" && before.backgroundImage.includes("snow-cap"),
            visitors: document.querySelectorAll('[data-testid="festival-visitor"]').length,
            taps: document.querySelectorAll('[data-testid="festival-visitor-tap"]').length,
          };
        });
      const levels: Record<string, { snow: boolean; visitors: number }> = {
        auto: { snow: true, visitors: 1 },
        reduced: { snow: true, visitors: 0 },
        off: { snow: false, visitors: 0 },
      };
      for (const [motion, expected] of Object.entries(levels)) {
        await page.evaluate((m) => localStorage.setItem("kinboard_motion", m), motion);
        await gotoAfterJoin(page, "/?festival-preview=christmas");
        await expect(page.locator("html")).toHaveAttribute("data-festival", "christmas", { timeout: 30_000 });
        await expect(page.locator(".festival-grid > div").first()).toBeVisible({ timeout: 30_000 });
        await expect.poll(state, { message: motion }).toEqual({ top: expect.stringMatching(/^355 /), snow: expected.snow, visitors: expected.visitors, taps: expected.visitors });
      }
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });

  test("with no festival on, the weather effects are what they were", async ({ page, baseURL }) => {
    const familyName = `probe-family-festivals-off-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await putSetting(page, familyId, "festivals", { enabled: false, chosen: null });
      await gotoAfterJoin(page, "/?weather-preview=snow");
      const overlay = page.getByTestId("weather-effects");
      await expect(overlay).toHaveAttribute("data-effects", "snow", { timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await expect(page.getByTestId("weather-effects-motion")).toHaveCount(1);
      await expect(overlay).not.toHaveAttribute("data-visitor", /.*/);
      await expect(visitor(page)).toHaveCount(0);
      await expect(tap(page)).toHaveCount(0);
      await expect(page.getByTestId("festival-scene")).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveAttribute("data-festival", /.*/);
      // The wash is the month's.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--festival-top").trim())).toBe("");
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });

  for (const viewport of [{ width: 320, height: 700 }, { width: 1920, height: 1080 }]) {
    test(`the dressing never covers a card's content, at ${viewport.width}px`, async ({ page, baseURL }) => {
      const familyName = `probe-family-festivals-dress-${viewport.width}-${Date.now()}`;
      await page.setViewportSize(viewport);
      await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
      await page.goto("/join", { waitUntil: "domcontentloaded" });
      const familyId = await createThrowawayFamily(page, familyName);
      try {
        await gotoAfterJoin(page, "/?festival-preview=christmas");
        await expect(page.locator("html")).toHaveAttribute("data-festival", "christmas", { timeout: 30_000 });
        await expect(page.locator(".festival-grid > div").first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(2_000);
        const cards = await dressingClearance(page);
        expect(cards.filter((c) => c.snow).length).toBeGreaterThan(2);
        for (const c of cards.filter((c) => c.snow)) expect(c.snowBottom, JSON.stringify(c)).toBeLessThanOrEqual(c.contentTop);
        // Nothing sticks out sideways.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      } finally {
        await deleteThrowawayFamily(page, familyId, familyName);
      }
    });
  }
});

test("this browser has the calendars the dates come from", async ({ page }) => {
  // A missing calendar would silently mean no festival (RFC-020 §3.1): check the engine itself.
  const parts = await page.evaluate(() => {
    const at = (cal: string, day: string, month: "numeric" | "long") =>
      new Intl.DateTimeFormat(`en-US-u-ca-${cal}`, { timeZone: "UTC", month, day: "numeric" })
        .formatToParts(new Date(`${day}T12:00:00Z`))
        .filter((p) => p.type === "month" || p.type === "day")
        .map((p) => p.value)
        .join("/");
    return {
      chinese: at("chinese", "2026-02-17", "numeric"),
      islamic: at("islamic-umalqura", "2026-03-20", "numeric"),
      hebrew: at("hebrew", "2026-12-05", "long"),
      persian: at("persian", "2026-03-21", "numeric"),
    };
  });
  expect(parts).toEqual({ chinese: "1/1", islamic: "10/1", hebrew: "25/Kislev", persian: "1/1" });
});
