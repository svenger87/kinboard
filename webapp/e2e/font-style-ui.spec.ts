import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";
import { dbContainer } from "./whole-database";

/**
 * Settings → Design → Font style (lib/font-style.ts): the picker offers the
 * four pairings, each card previewed in its own faces; picking one writes
 * the `font_style` family setting, and the choice restyles the whole app —
 * the board included — by remapping --font-display / --font-sans off
 * <body data-font-style>. Only visible on a rendered page, so a stack test
 * in a family of its own.
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

test("the picker offers four styles and the choice restyles the board", async ({ page }) => {
  test.setTimeout(120_000);
  await withFamily(page, "fontstyle", async (familyId) => {
    await gotoAfterJoin(page, "/settings/theme");

    const section = page.locator('[data-setting="font-style"]');
    await expect(section).toBeVisible({ timeout: 20_000 });

    // All four styles are offered, and classic — the default — is pressed.
    for (const id of ["classic", "rounded", "clean", "serif"]) {
      await expect(section.locator(`[data-font-style-option="${id}"]`)).toBeVisible();
    }
    await expect(section.locator('[data-font-style-option="classic"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Each card's name is set in its own display face, before anything is
    // picked: the classic card computes to Bricolage, the rounded to Fredoka.
    const classicName = section.locator('[data-font-style-option="classic"] span').first();
    const roundedName = section.locator('[data-font-style-option="rounded"] span').first();
    await expect.poll(() => fontFamilyOf(classicName)).toContain("bricolage");
    await expect.poll(() => fontFamilyOf(roundedName)).toContain("fredoka");

    // Pick rounded: the family setting lands in the database…
    await section.locator('[data-font-style-option="rounded"]').click();
    await expect
      .poll(() =>
        psql(
          `SELECT value::text FROM settings WHERE family_id='${familyId}' AND key='font_style'`,
        ),
      )
      .toContain("rounded");
    await expect(section.locator('[data-font-style-option="rounded"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // …the settings page itself picks the pair up (body attribute set, the
    // page's display type — the preview clock — now Fredoka)…
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.fontStyle ?? ""))
      .toBe("rounded");
    await expect.poll(() => fontFamilyOf(page.locator(".font-display").first())).toContain(
      "fredoka",
    );
    // …and the classic card still previews in Bricolage, not in Fredoka.
    await expect.poll(() => fontFamilyOf(classicName)).toContain("bricolage");
    await expect.poll(() => fontFamilyOf(classicName)).not.toContain("fredoka");

    // The board wears it too: the body text face is Quicksand and the
    // display variable resolves to Fredoka there.
    await gotoAfterJoin(page, "/");
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.fontStyle ?? ""))
      .toBe("rounded");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily.toLowerCase()))
      .toContain("quicksand");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.body).getPropertyValue("--font-display").toLowerCase(),
        ),
      )
      .toContain("fredoka");

    // Back to classic: the row holds classic and the attribute goes away.
    await gotoAfterJoin(page, "/settings/theme");
    await section.locator('[data-font-style-option="classic"]').click();
    await expect
      .poll(() =>
        psql(
          `SELECT value::text FROM settings WHERE family_id='${familyId}' AND key='font_style'`,
        ),
      )
      .toContain("classic");
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.fontStyle ?? ""))
      .toBe("");
  });
});
