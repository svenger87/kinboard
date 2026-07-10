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
import { joinFamilyViaUI, JOIN_CTA_RE, REJOIN_RE } from "./helpers";

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

    // Join must be reachable — either the welcome screen's "Join with a
    // code" CTA (fresh device) or a "Sign back in" quick-rejoin offer
    // (device fingerprint recognized from a prior run). Locators cover
    // EN + DE wording.
    const joinCta = page.getByRole("button", { name: JOIN_CTA_RE });
    const rejoinButton = page.getByRole("button", { name: REJOIN_RE });
    await expect(joinCta.or(rejoinButton)).toBeVisible({ timeout: 10_000 });

    // When the welcome screen shows the join CTA, follow it and confirm
    // the six-cell code input actually renders behind it.
    if (await joinCta.isVisible().catch(() => false)) {
      await joinCta.click();
      const firstCell = page.getByRole("textbox", { name: "Character 1" });
      await expect(firstCell).toBeVisible();
    }

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

    await joinFamilyViaUI(authedPage, FAMILY_CODE, DEVICE_NAME);
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
