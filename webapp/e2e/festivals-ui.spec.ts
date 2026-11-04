import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";
import { DRAWN_FESTIVALS, FESTIVAL_KITS } from "../src/lib/festivals/kits";

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

/**
 * Every piece of dressing on Home's cards (each card's ::before and ::after)
 * that overlaps the card's own content -- its text, icons and controls --
 * with how many pieces there were at all. A piece's box comes from its
 * resolved position: top or bottom, left or right, width and height.
 */
async function dressingOverContent(page: Page) {
  return page.evaluate(() => {
    const hits: string[] = [];
    let pieces = 0;
    // A full-bleed card, whose content starts on its very first pixel row and
    // ends on its last (a camera, a photo). CI's demo has one and the devbox
    // families do not, so three decorations passed here and failed there,
    // one CI round each. This one card makes every stack the strictest case.
    const grid = document.querySelector<HTMLElement>(".festival-grid");
    const model = grid?.firstElementChild as HTMLElement | null;
    if (grid && model && !grid.querySelector("[data-test-full-bleed]")) {
      const card = document.createElement("div");
      card.className = model.className;
      card.setAttribute("data-test-full-bleed", "");
      card.style.padding = "0";
      card.style.overflow = "hidden";
      card.innerHTML = '<img alt="" style="display:block;width:100%;height:220px;margin:0" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
      grid.appendChild(card);
    }
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".festival-grid > *, .festival-tasks"));
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (box.height === 0) continue;
      // The other cards, whole: a piece in the gap that reaches the next card
      // is too big for the gap, whatever that card shows where it lands
      // (St Martin's 28px lanterns in a 16px gap, which content alone missed).
      const others = cards
        .filter((c) => c !== card && !c.contains(card) && !card.contains(c))
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      const content = Array.from(card.querySelectorAll<HTMLElement>("h1, h2, h3, h4, p, button, a, input, img, svg, li, [role=button]"))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      for (const pseudo of ["::before", "::after"]) {
        const st = getComputedStyle(card, pseudo);
        if (st.content === "none" || st.backgroundImage === "none" || st.position !== "absolute") continue;
        pieces++;
        const w = parseFloat(st.width);
        const h = parseFloat(st.height);
        // Offsets count from inside the card's border (its padding box), as CSS places them.
        const cs = getComputedStyle(card);
        const [bt, br, bb, bl] = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat);
        const top = st.top !== "auto" ? bt + parseFloat(st.top) : box.height - bb - parseFloat(st.bottom) - h;
        const left = st.left !== "auto" ? bl + parseFloat(st.left) : box.width - br - parseFloat(st.right) - w;
        const p = { x: box.left + left, y: box.top + top, w, h };
        const over = (r: DOMRect) => Math.min(p.x + p.w, r.right) - Math.max(p.x, r.left) > 0.5 && Math.min(p.y + p.h, r.bottom) - Math.max(p.y, r.top) > 0.5;
        const at = (r: DOMRect) => JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height });
        for (const r of content) if (over(r)) hits.push(`${card.className.slice(0, 40)} ${pseudo} ${JSON.stringify(p)} over ${at(r)}`);
        // Into another card by more than its border line: a card without a border of
        // its own (a wrapper) puts an offset meant for a 1px border on that line.
        const into = (r: DOMRect) => Math.min(p.x + p.w, r.right) - Math.max(p.x, r.left) > 1.5 && Math.min(p.y + p.h, r.bottom) - Math.max(p.y, r.top) > 1.5;
        for (const r of others) if (into(r)) hits.push(`${card.className.slice(0, 40)} ${pseudo} ${JSON.stringify(p)} into the next card ${at(r)}`);
      }
    }
    return { pieces, hits };
  });
}

test.describe("festivals on Home", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  // 33 kits and their stages, twice: the dressing tests walk all of them.
  test.describe.configure({ timeout: 900_000 });

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
      // A festival with no visitor previews here too: its dressing on sample cards under its row (St Nicholas's boot).
      await page.getByTestId("festival-preview-st-nicholas").click();
      const boot = page.getByTestId("festival-preview-card-tasks");
      await expect(boot).toBeVisible();
      await expect.poll(() => boot.evaluate((el) => getComputedStyle(el, "::after").backgroundImage)).toContain("st-nicholas/boot");
      await boot.locator("xpath=ancestor::li[1]").screenshot({ path: test.info().outputPath("st-nicholas-preview.png") });
      await page.getByTestId("festival-preview-st-nicholas").click();
      await expect(boot).toBeHidden();

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
    test(`no festival's dressing covers a card's content, at ${viewport.width}px`, async ({ page, baseURL }) => {
      const familyName = `probe-family-festivals-dress-${viewport.width}-${Date.now()}`;
      await page.setViewportSize(viewport);
      await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
      await page.goto("/join", { waitUntil: "domcontentloaded" });
      const familyId = await createThrowawayFamily(page, familyName);
      try {
        // Reduced: the dressing without a visitor flying over the measurements.
        await page.evaluate(() => localStorage.setItem("kinboard_motion", "reduced"));
        // Drafts too: they preview, and the owner reviews them on the household.
        for (const id of DRAWN_FESTIVALS.filter((f) => FESTIVAL_KITS[f]?.dressing)) {
          for (const stage of FESTIVAL_KITS[id]?.stages ?? [null]) {
            await gotoAfterJoin(page, `/?festival-preview=${id}${stage ? `&festival-stage=${stage}` : ""}`);
            await expect(page.locator("html")).toHaveAttribute("data-festival", id, { timeout: 30_000 });
            await expect(page.locator(".festival-grid > div").first()).toBeVisible({ timeout: 30_000 });
            // The cards' content, loaded: the empty states and their buttons are what sit nearest the edges.
            await expect(page.getByText("Loading today")).toHaveCount(0, { timeout: 30_000 });
            await page.waitForTimeout(1_500);
            const { pieces, hits } = await dressingOverContent(page);
            // Soft: one run names every festival that fails, not just the first.
            expect.soft(pieces, `${id} ${stage ?? ""}: some dressing`).toBeGreaterThan(0);
            expect.soft(hits, `${id} ${stage ?? ""}`).toEqual([]);
            // Nothing sticks out sideways.
            expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), id).toBeLessThanOrEqual(0);
          }
        }
      } finally {
        await deleteThrowawayFamily(page, familyId, familyName);
      }
    });
  }
});

test.describe("the engine", () => {
  // The stack jobs install the browsers; the pure Specs job has none to launch.
  // Skipped here, at describe level, because a skip inside the test comes
  // after the page fixture has already tried to start a browser.
  test.skip(!FAMILY_CODE, "runs in the e2e jobs, with Chromium and WebKit");

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
        // Purim in a leap year: Adar II, by that name (lib/festivals.ts looks for it).
        adarII: at("hebrew", "2027-03-23", "long"),
        // A leap month in the Chinese calendar is never the month itself (Dragon Boat, Mid-Autumn).
        leap: at("chinese", "2025-08-01", "numeric"),
      };
    });
    expect(parts).toEqual({ chinese: "1/1", islamic: "10/1", hebrew: "25/Kislev", persian: "1/1", adarII: "14/Adar II", leap: "6bis/8" });
  });
});

