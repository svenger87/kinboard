import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { establishSession } from "./session";

/**
 * The version line at the foot of Settings links to Kinboard's source code,
 * in a new tab, in every language the app ships. Needs FAMILY_CODE (a running
 * stack) for the page itself.
 */
const familyCode = process.env.FAMILY_CODE;
const DEVICE = "settings-source-link";
const REPO = "https://github.com/svenger87/kinboard";

test("the link has a name in every language, in the same words as the rest of the page", () => {
  const expected = { en: "Source code", de: "Quellcode", fr: "Code source", zh: "源代码" };
  for (const [locale, text] of Object.entries(expected)) {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
    expect(messages.settings.sourceCode, locale).toBe(text);
  }
});

// The skip sits on the describe, not inside the test: the `page` fixture
// launches a browser before a test body runs, so a skip in the body still
// fails on a runner without one (CI's stack-free Specs job).
test.describe("against a running stack", () => {
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

test("Settings links to the source code beside the version, in a new tab", async ({ page }) => {
  // A dev server compiles /settings on its first visit, which alone can take most of a minute.
  test.setTimeout(150_000);
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });

  const link = page.getByTestId("settings-source-code");
  await expect(link).toBeVisible({ timeout: 120_000 });
  await expect(link).toHaveText("Source code");
  await expect(link).toHaveAttribute("href", REPO);
  await expect(link).toHaveAttribute("target", "_blank");
  expect((await link.getAttribute("rel"))?.split(/\s+/)).toContain("noopener");

  // On the same line as the version, not somewhere else on the page.
  const line = link.locator("xpath=..");
  await expect(line).toContainText("Kinboard v");
});
});
