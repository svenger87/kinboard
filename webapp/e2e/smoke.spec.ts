/**
 * Smoke suite for the Kinboard webapp — behavior assertions, not screenshots.
 * (For PNG capture, see e2e/visual-audit.spec.ts.)
 *
 * Two layers:
 *   1. Anonymous smoke — `/join` renders, no console errors. No family required.
 *   2. Authenticated smoke — main routes load + no console errors. Requires
 *      FAMILY_CODE pointing at a join code on the target stack.
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test e2e/smoke.spec.ts
 *   FAMILY_CODE=ABC123 PLAYWRIGHT_BASE_URL=https://demo.kinboard.app \
 *     npx playwright test e2e/smoke.spec.ts
 *
 * Catches regressions like:
 *   - meal-plan UNIQUE-constraint upsert failures (HTTP 400 spam in console)
 *   - route 500s after redeploy
 *   - missing static assets (icons, manifest)
 */

import { test, expect, Page, ConsoleMessage } from "@playwright/test";

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
const DEVICE_NAME = process.env.PLAYWRIGHT_DEVICE_NAME ?? "Smoke Test Device";

// Console messages that are noisy but not regressions. Keep this list short
// and audited — every entry is a thing we've explicitly chosen to tolerate.
const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  // Service worker registration in dev mode
  /\[next-pwa\]/,
  // React DevTools install hint
  /Download the React DevTools/,
  // HMR connection chatter
  /\[HMR\]/,
  /\[Fast Refresh\]/,
];

type ConsoleEntry = { type: string; text: string; location?: string };

function attachConsoleCapture(page: Page): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    if (IGNORED_CONSOLE_PATTERNS.some((p) => p.test(text))) return;
    const loc = msg.location();
    entries.push({
      type: msg.type(),
      text,
      location: loc.url ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : undefined,
    });
  });
  page.on("pageerror", (err) => {
    entries.push({ type: "pageerror", text: err.message });
  });
  return entries;
}

function describeConsoleErrors(entries: ConsoleEntry[]): string {
  const errs = entries.filter((e) => e.type === "error" || e.type === "pageerror");
  if (errs.length === 0) return "";
  return errs
    .map((e) => `  [${e.type}] ${e.text}${e.location ? ` (${e.location})` : ""}`)
    .join("\n");
}

test.describe("Anonymous smoke", () => {
  test("/join renders the join form", async ({ page }) => {
    const errors = attachConsoleCapture(page);

    const response = await page.goto("/join");
    expect(response?.status(), "GET /join").toBeLessThan(400);

    // Form must be reachable — locator covers EN + DE wording.
    const codeInput = page.locator('input[placeholder*="ABC123"], input[placeholder*="123ABC"]');
    await expect(codeInput).toBeVisible({ timeout: 10_000 });

    expect(
      describeConsoleErrors(errors),
      `Console errors on /join:\n${describeConsoleErrors(errors)}`,
    ).toBe("");
  });

  test("PWA manifest + key icons resolve", async ({ request }) => {
    const manifest = await request.get("/manifest.json");
    expect(manifest.status(), "GET /manifest.json").toBe(200);
    const json = await manifest.json();
    expect(json.icons?.length, "manifest.icons populated").toBeGreaterThan(0);

    const icon = await request.get("/icons/icon-192.png");
    expect(icon.status(), "GET /icons/icon-192.png").toBe(200);

    const badge = await request.get("/icons/badge-72.png");
    expect(badge.status(), "GET /icons/badge-72.png").toBe(200);
  });
});

test.describe("Authenticated smoke", () => {
  test.skip(!FAMILY_CODE, "FAMILY_CODE env var not set — skipping authenticated suite");
  test.describe.configure({ mode: "serial" });

  let authedPage: Page;
  let consoleErrors: ConsoleEntry[];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    authedPage = await context.newPage();
    consoleErrors = attachConsoleCapture(authedPage);

    await authedPage.goto("/join");

    if (authedPage.url().includes("/join")) {
      const codeInput = authedPage.locator(
        'input[placeholder*="ABC123"], input[placeholder*="123ABC"]',
      );
      await codeInput.fill(FAMILY_CODE);

      const deviceInput = authedPage.locator(
        'input[placeholder*="Wohnzimmer"], input[placeholder*="Living"]',
      );
      if (await deviceInput.isVisible()) {
        await deviceInput.fill(DEVICE_NAME);
      }

      // Locale-tolerant exact match — page also has a "Join family" *tab*
      // whose label contains "Join", so a non-anchored regex would click
      // the (already-active) tab instead of the submit button.
      const submit = authedPage.getByRole("button", {
        name: /^(beitreten|join)$/i,
      });
      await submit.click();
      await authedPage.waitForURL((url) => !url.pathname.startsWith("/join"), {
        timeout: 15_000,
      });
    }
  });

  test.afterAll(async () => {
    await authedPage?.context().close();
  });

  for (const route of [
    "/",
    "/calendar",
    "/shopping",
    "/recipes",
    "/meals",
    "/todos",
    "/settings",
  ]) {
    test(`${route} loads + no console errors`, async () => {
      const before = consoleErrors.length;
      const response = await authedPage.goto(route);
      expect(response?.status(), `GET ${route}`).toBeLessThan(400);
      // `networkidle` is unreliable here — Supabase Realtime keeps a
      // WebSocket open per subscription, so on pages like /meals that
      // sync state across devices, the network never goes idle. Use a
      // fixed settle for hydration + initial fetches instead. `goto()`
      // already waited for the `load` event before returning.
      await authedPage.waitForTimeout(1500);

      const newErrors = consoleErrors.slice(before);
      const summary = describeConsoleErrors(newErrors);
      expect(summary, `Console errors on ${route}:\n${summary}`).toBe("");
    });
  }
});
