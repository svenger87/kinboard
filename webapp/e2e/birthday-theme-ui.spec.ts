import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";
import { dbContainer } from "./whole-database";

/**
 * Two things from discussion #445, each only visible on a rendered page:
 *
 *   1. Today's birthday sits in the card at the top of /birthdays, and the
 *      list below starts after it, so it had no edit button anywhere.
 *   2. In dark mode the theme button in the navigation showed no icon. The
 *      moon is absolutely positioned and the button wasn't `relative`, so its
 *      containing block lay outside the sideways-scrolling bar: scroll the bar
 *      and the button moves while the moon stays put (260px apart on a family
 *      with a full bar).
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

test("today's birthday at the top of the page can be edited", async ({ page }) => {
  test.setTimeout(90_000);
  await withFamily(page, "bday", async (familyId) => {
    // Born today, eight years ago: the top card, with nothing in the list for it.
    psql(
      `INSERT INTO birthdays (family_id, name, date) VALUES ('${familyId}', 'Mira', (CURRENT_DATE - INTERVAL '8 years')::date)`,
    );
    await gotoAfterJoin(page, "/birthdays");

    const edit = page.getByTestId("birthday-hero-edit");
    await expect(edit).toBeVisible({ timeout: 20_000 });
    await edit.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("textbox").first()).toHaveValue("Mira");
  });
});

test("the theme button shows its icon in dark mode", async ({ page }) => {
  test.setTimeout(90_000);
  // The phone's toggle is in the More sheet, not in a scrolling bar.
  test.skip(test.info().project.name === "mobile", "desktop navigation only");
  await withFamily(page, "theme", async () => {
    await gotoAfterJoin(page, "/todos");
    await page.evaluate(() => {
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
    });
    const button = page.locator('button[aria-label="Toggle theme"]:visible').first();
    await expect(button).toBeVisible({ timeout: 20_000 });
    // The toggle is the last thing in a bar that scrolls sideways; at this
    // width it is past the edge. Scrolling the bar to it is what left the
    // moon behind, so this has to happen before the measurement.
    await button.scrollIntoViewIfNeeded();
    // Past the 300ms scale transition.
    await page.waitForTimeout(500);

    const shown = await button.evaluate((b) => {
      const box = b.getBoundingClientRect();
      return [...b.querySelectorAll("svg")]
        .map((svg) => svg.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom);
    });
    expect(shown, "exactly one icon drawn, and inside the button").toEqual([true]);
  });
});
