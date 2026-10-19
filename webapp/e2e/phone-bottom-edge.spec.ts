import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { establishSession } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";

/**
 * What sits on the phone's bottom edge.
 *
 * The navigation's height was 5rem in CSS (--mobile-nav-height) and ~45px on
 * screen, so everything placed by --nav-spacing floated ~35px above it.
 *
 * Settings -> Home Assistant has a bar with "Re-sync" above the navigation.
 * It was `sticky`, which holds only while the page scrolls past it: at the
 * end of the page it came to rest after the content, above the page's bottom
 * padding, and floated mid-screen. It has to sit right on the navigation at
 * the top of the page and at its end, with the last card clear of it.
 *
 * The add button (FAB) floats over the end of a list; scrolled to the end, the
 * last row has to be clear of it, or its delete button can't be tapped.
 *
 * In a family of its own, with a Home Assistant that does not exist (the bar
 * shows for a saved connection), removed afterwards. Needs a running stack.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");

const P = "claude-bottom-edge-";
let famId = "";
let code = "";

function purge(where: string) {
  for (const id of psql(`SELECT string_agg(id::text, ',') FROM families WHERE ${where}`).split(",").filter(Boolean)) {
    psql(`DELETE FROM todos WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM devices WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM settings WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM families WHERE id = ${sqlText(id)}`);
  }
}

test.beforeAll(() => {
  purge(`name LIKE '${P}%' AND created_at < now() - interval '10 minutes'`);
  code = `RB${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  psql(
    `INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'home_assistant', ` +
      `'{"url":"http://home-assistant.invalid:8123","access_token":"e2e-not-a-real-token"}')`,
  );
  // More tasks than a phone screen holds, so the list runs under the add button.
  for (let i = 1; i <= 14; i++) psql(`INSERT INTO todos (family_id, title) VALUES ('${famId}', 'Probe task ${i}')`);
});

test.afterAll(() => {
  purge(`id = ${sqlText(famId)}`);
});

/** Where the bar's bottom edge is against the navigation's top edge, and whether the last card clears the bar. */
function measure(page: Page) {
  return page.evaluate(() => {
    // The bar is the box with the top border around the Re-sync button, before and after the fix alike.
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Re-sync")!;
    let box: HTMLElement | null = button.parentElement;
    while (box && !box.className.toString().includes("border-t")) box = box.parentElement;
    const bar = box!.getBoundingClientRect();
    const navs = Array.from(document.querySelectorAll<HTMLElement>("nav")).filter((n) => {
      const cs = getComputedStyle(n);
      return cs.position === "fixed" && cs.display !== "none" && n.getBoundingClientRect().height > 0;
    });
    const navTop = Math.min(...navs.map((n) => n.getBoundingClientRect().top));
    // The page's cards (ui/card: rounded-2xl, elev-md); the bar is none of them.
    const cards = Array.from(document.querySelectorAll<HTMLElement>("#main-content .rounded-2xl.elev-md"));
    const lastCardBottom = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
    return { gap: Math.round(navTop - bar.bottom), lastCardClears: lastCardBottom <= bar.top + 0.5 };
  });
}

test("the Re-sync bar sits on the navigation at the top of the page and at its end", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await establishSession(page, code, `${P}device-${testInfo.project.name}`);
  await page.goto("/settings/homeassistant", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Re-sync", exact: true })).toBeVisible({ timeout: 30_000 });

  // On the navigation: its top edge, give or take the navigation's 1px border.
  expect(Math.abs((await measure(page)).gap)).toBeLessThanOrEqual(1);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => Math.abs((await measure(page)).gap)).toBeLessThanOrEqual(1);
  expect((await measure(page)).lastCardClears).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("page-end.png") });
});

test("scrolled to the end of a list, the last row is clear of the add button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the add button is the phone's");
  test.setTimeout(90_000);
  await establishSession(page, code, `${P}device-${testInfo.project.name}`);
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  const fab = page.getByRole("button", { name: "New task", exact: true }).last();
  await expect(page.getByText("Probe task 14", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(fab).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  const overlap = async () => {
    const button = await fab.boundingBox();
    // The lowest task row: the text's nearest box with a border, i.e. the row itself.
    const row = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("body *")).filter(
        (e) => e.childElementCount === 0 && /^Probe task \d+$/.test(e.textContent ?? ""),
      );
      const boxes = rows.map((e) => (e.closest("[class*='border']") ?? e).getBoundingClientRect());
      const last = boxes.sort((a, b) => b.bottom - a.bottom)[0];
      return { top: last.top, bottom: last.bottom, left: last.left, right: last.right };
    });
    if (!button) return "no button";
    const apart = row.bottom <= button.y || row.right <= button.x || row.left >= button.x + button.width;
    return apart ? "clear" : `row ${Math.round(row.top)}-${Math.round(row.bottom)} under button ${Math.round(button.y)}`;
  };
  await expect.poll(overlap, { timeout: 5_000 }).toBe("clear");
  await page.screenshot({ path: testInfo.outputPath("todos-end.png") });
});
