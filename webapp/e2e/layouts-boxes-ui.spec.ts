import { expect, test } from "@playwright/test";

/**
 * The layout primitives, rendered on the dev page /dev/layout-boxes: a list
 * that shows whole rows and a "+n", and a value fitted to a box. Needs a
 * running dev server (PLAYWRIGHT_BASE_URL), no family session.
 */
test.skip(!process.env.PLAYWRIGHT_BASE_URL, "needs PLAYWRIGHT_BASE_URL: a running dev server");
test.use({ serviceWorkers: "block", viewport: { width: 1000, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/layout-boxes");
  await expect(page.getByTestId("list-full")).toBeVisible({ timeout: 60_000 });
});

test("a list shows whole rows that fit, then +n", async ({ page }) => {
  const box = page.getByTestId("list-full");
  await expect(box.locator("[data-list-shown]").first()).toBeVisible();
  const root = box.locator("[data-list-shown]").first();
  const shown = Number(await root.getAttribute("data-list-shown"));
  const more = Number(await root.getAttribute("data-list-more"));
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(10);
  expect(more).toBe(10 - shown);
  const visible = root.locator("[data-list-visible]");
  await expect(visible.getByTestId("list-row")).toHaveCount(shown);
  await expect(visible.getByTestId("list-more")).toHaveText(`+${more}`);
  // Readable on the screensaver's dark photo: its own light colour, not the page's text colour.
  const color = await visible.getByTestId("list-more").evaluate((el) => getComputedStyle(el).color);
  const [r, g, bl, alpha = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
  expect(Math.min(r, g, bl), color).toBeGreaterThan(240);
  expect(alpha, color).toBeGreaterThanOrEqual(0.7);
  const b = (await box.boundingBox())!;
  expect(b.height).toBeCloseTo(300, 0);
  for (const child of await visible.locator("[data-testid]").all()) {
    const c = (await child.boundingBox())!;
    expect(c.y).toBeGreaterThanOrEqual(b.y - 0.5);
    expect(c.y + c.height).toBeLessThanOrEqual(b.y + b.height + 0.5);
  }
});

test("an empty list shows the empty node and keeps its box", async ({ page }) => {
  const box = page.getByTestId("list-empty");
  await expect(box.getByTestId("list-empty-node")).toBeVisible();
  const b = (await box.boundingBox())!;
  expect(b.height).toBeCloseTo(300, 0);
  const e = (await box.getByTestId("list-empty-node").boundingBox())!;
  expect(e.y + e.height).toBeLessThanOrEqual(b.y + b.height + 0.5);
});

for (const [id, w, h] of [["fit-wide", 400, 120], ["fit-tall", 120, 400]] as const) {
  test(`a value fitted in ${w}x${h} fills one axis and overflows neither`, async ({ page }) => {
    const box = page.getByTestId(id);
    const text = box.getByTestId("fit-text");
    await expect.poll(async () => {
      const t = (await text.boundingBox())!;
      return Math.min(w - t.width, h - t.height);
    }, { timeout: 10_000 }).toBeLessThanOrEqual(3);
    const b = (await box.boundingBox())!;
    const t = (await text.boundingBox())!;
    expect(b.width).toBeCloseTo(w, 0);
    expect(b.height).toBeCloseTo(h, 0);
    expect(t.width).toBeLessThanOrEqual(w + 1.5);
    expect(t.height).toBeLessThanOrEqual(h + 1.5);
    expect(Math.min(w - t.width, h - t.height)).toBeLessThanOrEqual(3);
  });
}

/** The energy/Tesla card: inside its box at any size, side by side when flat, never above its text size. */
async function cardFacts(page: import("@playwright/test").Page, testId: string) {
  const box = page.getByTestId(testId);
  const card = box.locator("[data-fills-box]");
  const content = box.locator("[data-fitted-content]");
  await expect(content).toHaveCSS("visibility", "visible");
  const b = (await box.boundingBox())!;
  const c = (await content.boundingBox())!;
  const font = await content.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  return { b, c, font, wide: await card.getAttribute("data-wide") };
}

test("the energy card fits a flat box of one line, side by side", async ({ page }) => {
  const { b, c, font, wide } = await cardFacts(page, "card-flat");
  expect(wide).toBe("true");
  expect(font).toBeLessThanOrEqual(16);
  expect(font).toBeGreaterThan(4);
  expect(c.x).toBeGreaterThanOrEqual(b.x - 0.5);
  expect(c.y).toBeGreaterThanOrEqual(b.y - 0.5);
  expect(c.x + c.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
  expect(c.y + c.height).toBeLessThanOrEqual(b.y + b.height + 0.5);
});

test("in a small square box the figures stack and shrink to fit", async ({ page }) => {
  const { b, c, font, wide } = await cardFacts(page, "card-small");
  expect(wide).toBe("false");
  expect(font).toBeLessThan(16);
  expect(c.y + c.height).toBeLessThanOrEqual(b.y + b.height + 0.5);
  expect(c.x + c.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
});

test("in a large box the figures keep the box's text size instead of growing", async ({ page }) => {
  const { font } = await cardFacts(page, "card-large");
  expect(font).toBe(16);
});
