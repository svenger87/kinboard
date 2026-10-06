import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * Settings search, rendered against a running stack: a query finds a section
 * in the screen's language, Enter opens it with the section in view and
 * highlighted, a query that matches nothing says so, and Back comes back to
 * the query. Needs FAMILY_CODE; the source and ranking checks are in
 * settings-search.spec.ts.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// One device for the file, joined once (session.ts explains the join limit).
test.describe.configure({ mode: "serial" });
const DEVICE = "claude-settings-search-ui";

test.afterAll(() => {
  if (!familyCode) return;
  execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c",
      `DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE}%'`],
    { encoding: "utf8" },
  );
});

async function openSettings(page: Page) {
  await establishSession(page, familyCode!, DEVICE);
  const base = test.info().project.use.baseURL!;
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "de", url: base }]);
  // The query survives in sessionStorage; start every test from an empty box.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("settings-search-ui-seeded")) {
      sessionStorage.removeItem("kinboard_settings_search");
      sessionStorage.setItem("settings-search-ui-seeded", "1");
    }
  });
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  const input = page.getByTestId("settings-search-input");
  await expect(input).toBeVisible({ timeout: 30_000 });
  return input;
}

test("'ferien' finds the school holidays, and Enter opens them in view and highlighted", async ({ page }) => {
  const input = await openSettings(page);
  await input.fill("ferien");

  const first = page.getByTestId("settings-search-result").first();
  await expect(first).toHaveAttribute("href", /^\/settings\/holidays#/);
  const href = (await first.getAttribute("href"))!;
  const anchor = href.split("#")[1];

  await input.press("Enter");
  // A dev server compiles the page on first visit; give it time.
  await expect(page).toHaveURL(new RegExp(`/settings/holidays#${anchor}$`), { timeout: 30_000 });

  const section = page.locator(`[data-setting="${anchor}"]`);
  await expect(section).toHaveClass(/settings-anchor-highlight/, { timeout: 10_000 });
  await expect(section).toBeInViewport();
  // The highlight is brief.
  await expect(section).not.toHaveClass(/settings-anchor-highlight/, { timeout: 5_000 });
});

test("a query that matches nothing says so, naming the query", async ({ page }) => {
  const input = await openSettings(page);
  await input.fill("zzzz");
  const empty = page.getByTestId("settings-search-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("zzzz");
  await expect(page.getByTestId("settings-search-result")).toHaveCount(0);
  // Escape clears the query and the menu comes back.
  await input.press("Escape");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("link", { name: /Feiertage/ }).first()).toBeVisible();
});

test("Back from a result returns to the settings page with the query still there", async ({ page }) => {
  const input = await openSettings(page);
  await input.fill("zeitzone");
  const first = page.getByTestId("settings-search-result").first();
  await expect(first).toHaveAttribute("href", "/settings/language#time-zone");
  await first.click();
  await expect(page).toHaveURL(/\/settings\/language#time-zone$/, { timeout: 30_000 });
  await expect(page.locator('[data-setting="time-zone"]')).toBeInViewport({ timeout: 10_000 });

  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("settings-search-input")).toHaveValue("zeitzone");
  await expect(page.getByTestId("settings-search-result").first()).toHaveAttribute(
    "href",
    "/settings/language#time-zone",
  );
});

test("a section of the settings page itself opens in place", async ({ page }) => {
  // The PIN is on /settings already: no navigation, only a hash change.
  const input = await openSettings(page);
  await input.fill("pin");
  await expect(page.getByTestId("settings-search-result").first()).toHaveAttribute("href", "/settings#pin");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/settings#pin$/);
  await expect(input).toHaveValue("");
  const section = page.locator('[data-setting="pin"]');
  await expect(section).toHaveClass(/settings-anchor-highlight/);
  await expect(section).toBeInViewport();
});
