import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";
import { dbContainer } from "./whole-database";

/**
 * Settings → Design → Font style in a Chinese UI (lib/font-style-cjk.ts):
 * the one picker swaps its Latin pairings for the Chinese typefaces and
 * edits the `font_style_cjk` setting instead; the picked face heads the
 * display and text stacks on Settings and the board alike via
 * <body data-font-style-cjk>. The Latin choice is a setting of its own:
 * it survives untouched, and back in an English UI the picker and the
 * stacks are exactly the Latin ones. Only visible on a rendered page, so
 * a stack test in a family of its own, like font-style-ui.spec.ts.
 */

const FAMILY_CODE = process.env.FAMILY_CODE;
test.skip(!FAMILY_CODE, "needs a running stack (FAMILY_CODE)");

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

async function withFamily(page: Page, label: string, body: (familyId: string) => Promise<void>) {
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const name = `claude-${label}-${test.info().project.name}-${Date.now()}`;
  const familyId = await createThrowawayFamily(page, name);
  try {
    await body(familyId);
  } finally {
    await deleteThrowawayFamily(page, familyId, name);
  }
}

/** The computed font-family of a locator's first element, lower-cased. */
async function fontFamilyOf(locator: ReturnType<Page["locator"]>): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
}

/** The device's UI language is the NEXT_LOCALE cookie — set it like a device would. */
async function setLocale(page: Page, locale: string) {
  const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
}

test("in a Chinese UI the picker offers the Chinese faces and restyles the board", async ({ page }) => {
  test.setTimeout(180_000);
  await withFamily(page, "fontcjk", async (familyId) => {
    const setting = (key: string) =>
      psql(`SELECT value::text FROM settings WHERE family_id='${familyId}' AND key='${key}'`);

    // English first: the picker is the Latin one, as it has always been.
    await gotoAfterJoin(page, "/settings/theme");
    const section = page.locator('[data-setting="font-style"]');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.locator('[data-font-style-option="classic"]')).toBeVisible();
    await expect(section.locator("[data-font-style-cjk-option]")).toHaveCount(0);

    // Flip the device to Chinese: the same section now offers the Chinese
    // faces instead, system (the device's own fonts) pressed by default.
    await setLocale(page, "zh");
    await gotoAfterJoin(page, "/settings/theme");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh");
    await expect(section.locator("[data-font-style-option]")).toHaveCount(0);
    for (const id of ["system", "noto-sans", "noto-serif", "zcool-kuaile"]) {
      await expect(section.locator(`[data-font-style-cjk-option="${id}"]`)).toBeVisible();
    }
    await expect(section.locator('[data-font-style-cjk-option="system"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Each card's name is set in its own face before anything is picked.
    const sansName = section.locator('[data-font-style-cjk-option="noto-sans"] span').first();
    const serifName = section.locator('[data-font-style-cjk-option="noto-serif"] span').first();
    const zcoolName = section.locator('[data-font-style-cjk-option="zcool-kuaile"] span').first();
    await expect.poll(() => fontFamilyOf(sansName)).toContain("notosanssc");
    await expect.poll(() => fontFamilyOf(serifName)).toContain("notoserifsc");
    await expect.poll(() => fontFamilyOf(zcoolName)).toContain("zcoolkuaile");

    // Pick 思源宋体： the CJK setting lands in the database, the Latin one
    // is never written…
    await section.locator('[data-font-style-cjk-option="noto-serif"]').click();
    await expect.poll(() => setting("font_style_cjk")).toContain("noto-serif");
    expect(setting("font_style")).toBe("");
    await expect(section.locator('[data-font-style-cjk-option="noto-serif"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // …the body carries the choice, and the serif face LEADS the stack —
    // ahead of the Latin text face it falls through to for Latin glyphs.
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.fontStyleCjk ?? ""))
      .toBe("noto-serif");
    const leadsWithSerif = (ff: string) =>
      ff.includes("notoserifsc") && ff.indexOf("notoserifsc") < ff.indexOf("hanken");
    await expect
      .poll(async () => leadsWithSerif(await fontFamilyOf(page.locator("body"))))
      .toBe(true);
    // A Chinese heading wears it too (its glyphs come from the serif face).
    await expect.poll(() => fontFamilyOf(section.locator("h2"))).toContain("notoserifsc");

    // The board wears it as well.
    await gotoAfterJoin(page, "/");
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.fontStyleCjk ?? ""))
      .toBe("noto-serif");
    await expect
      .poll(async () => leadsWithSerif(await fontFamilyOf(page.locator("body"))))
      .toBe(true);

    // Back to English: the Latin picker returns with its choice intact
    // (classic, never written), the Chinese attribute is gone even though
    // the CJK setting still says noto-serif — application is per-locale.
    await setLocale(page, "en");
    await gotoAfterJoin(page, "/settings/theme");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(section.locator("[data-font-style-cjk-option]")).toHaveCount(0);
    await expect(section.locator('[data-font-style-option="classic"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.fontStyleCjk ?? ""))
      .toBe("");
    expect(setting("font_style_cjk")).toContain("noto-serif");

    // And back to Chinese: the serif choice is still there, still applied.
    await setLocale(page, "zh");
    await gotoAfterJoin(page, "/settings/theme");
    await expect(section.locator('[data-font-style-cjk-option="noto-serif"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.fontStyleCjk ?? ""))
      .toBe("noto-serif");

    // System default clears the attribute; the stacks are the device's again.
    await section.locator('[data-font-style-cjk-option="system"]').click();
    await expect.poll(() => setting("font_style_cjk")).toContain("system");
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.fontStyleCjk ?? ""))
      .toBe("");
  });
});
