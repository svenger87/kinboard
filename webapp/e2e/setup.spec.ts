/**
 * Wizard happy-path E2E. Requires a stack with no families yet —
 * create one inline rather than depending on FAMILY_CODE. Set
 * SETUP_E2E_FRESH_STACK=1 to opt-in (else the test skips, since
 * running this against a stack with data would create extra families).
 */

import { test, expect } from "@playwright/test";

const FRESH = process.env.SETUP_E2E_FRESH_STACK === "1";

test.describe("Setup wizard happy path", () => {
  test.skip(!FRESH, "SETUP_E2E_FRESH_STACK=1 not set — skipping (would mutate data)");
  test.describe.configure({ mode: "serial" });

  test("/join → create family → land on /setup/people", async ({ page }) => {
    await page.goto("/join");
    // Fresh-install mode: tabs are hidden, create form is the only one visible.
    await page.locator('input[id="create-family-name"]').fill("Smoke Family");
    await page.locator('input[id="create-device-name"]').fill("Smoke Device");
    await page.getByRole("button", { name: /erstellen|create/i }).click();
    await expect(page).toHaveURL(/\/setup\/people$/, { timeout: 15_000 });
  });

  test("add a person, continue → /setup/homeassistant", async ({ page }) => {
    await page.goto("/setup/people");
    await page.locator('input[placeholder="Name"]').first().fill("Alex");
    await page.getByRole("button", { name: /weiter|continue/i }).click();
    await expect(page).toHaveURL(/\/setup\/homeassistant$/, { timeout: 10_000 });
  });

  test("skip HA → /setup/weather", async ({ page }) => {
    await page.goto("/setup/homeassistant");
    await page.getByRole("button", { name: /vorerst überspringen|skip for now/i }).click();
    await expect(page).toHaveURL(/\/setup\/weather$/, { timeout: 10_000 });
  });

  test("set city, continue → /setup/done", async ({ page }) => {
    await page.goto("/setup/weather");
    await page.locator('input[id="setup-city"]').fill("Hamburg");
    await page.getByRole("button", { name: /weiter|continue/i }).click();
    await expect(page).toHaveURL(/\/setup\/done$/, { timeout: 10_000 });
  });

  test("done → dashboard, banner is gone", async ({ page }) => {
    await page.goto("/setup/done");
    // The done page CTA is a button-styled link to /. Match by accessible name.
    await page.getByRole("link", { name: /zum dashboard|go to dashboard/i }).click();
    await expect(page).toHaveURL("/", { timeout: 10_000 });
    // Dashboard banner should NOT be visible (setup_completed flipped).
    await expect(page.getByText(/finish setting up|einrichtung abschließen/i)).toHaveCount(0);
  });
});
