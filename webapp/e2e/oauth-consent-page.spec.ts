import { test, expect, type Page } from "@playwright/test";
import { establishSession } from "./session";
import { MCP_SCOPES } from "../src/lib/oauth/config";

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

/*
  The consent page offers what the assistant did not ask for.

  ChatGPT replays the scope list it cached when the connector was created, so
  a reconnect after Kinboard added vehicles:read still asked for the old 11
  scopes, and its token could not read the car's charge level. The page now
  lists every other assistant scope below the requested ones, unticked; the
  family ticks what it wants and the PIN still decides.

  The consent API is stubbed (the decision itself is covered by
  oauth-consent.spec.ts and, end to end, mcp-oauth-flow.spec.ts), so this is
  about what the page shows and what it posts. Service workers are blocked
  and the stubs counted: a route the PWA worker answered first would leave
  the page talking to the real API and the test green for nothing.

  The skip is on the describe so the stack-free Specs job, which installs no
  browsers, never reaches the `page` fixture.
*/

// ChatGPT's list from prod, in MCP_SCOPES order.
const CHATGPT = [
  "family:read", "notes:read", "calendar:write", "tasks:write", "shopping:write", "notes:write",
  "energy:read", "meals:write", "announcements:write", "home:read", "home:control",
];
const NEW_SINCE = MCP_SCOPES.filter((s) => !CHATGPT.includes(s));
const REQUEST_ID = "00000000-0000-4000-8000-0000000000c5";

const box = (page: Page, scope: string) => page.locator(`input[type="checkbox"][id="scope-${scope}"]`);
// The native input is sr-only under a styled box; tick it the way a person
// does, by tapping the permission's text (a forced click on the hidden input
// does nothing in WebKit).
const tick = (page: Page, scope: string) => page.locator(`label[for="scope-${scope}"]`).last().click();

async function stubConsent(page: Page, details: Record<string, unknown>) {
  const hits = { get: 0, post: 0 };
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/oauth/consent**", async (route) => {
    if (route.request().method() === "GET") {
      hits.get++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(details) });
    }
    hits.post++;
    posted.push(route.request().postDataJSON() as Record<string, unknown>);
    // Refused, so the page stays put instead of following a redirect.
    return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "pin_invalid" }) });
  });
  return { hits, posted };
}

const DETAILS = {
  clientName: "ChatGPT", verified: true, clientHost: "chatgpt.com", redirectHost: "chatgpt.com",
  loopbackOnly: false, pinSet: true,
};

test.describe("the consent page", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE and a running stack");
  test.use({ serviceWorkers: "block" });

  test("lists the scopes nobody asked for, unticked, and posts the ones ticked", async ({ page }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `claude-consent-${testInfo.project.name}`);
    const { hits, posted } = await stubConsent(page, { ...DETAILS, scopes: CHATGPT, available: NEW_SINCE });
    await page.goto(`/oauth/consent/${REQUEST_ID}`, { waitUntil: "domcontentloaded" });

    // A cold dev server compiles the page on first visit.
    await expect(box(page, "family:read")).toBeVisible({ timeout: 60_000 });
    for (const scope of CHATGPT) await expect(box(page, scope), scope).toBeChecked();
    const extra = page.getByTestId("consent-available-scopes");
    await expect(extra).toBeVisible();
    await expect(extra.locator('input[type="checkbox"]')).toHaveCount(NEW_SINCE.length);
    for (const scope of NEW_SINCE) {
      await expect(extra.locator(`input[id="scope-${scope}"]`), scope).not.toBeChecked();
    }
    // Every requested scope is in the first list, not repeated in the second.
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(MCP_SCOPES.length);

    await tick(page, "vehicles:read");
    await expect(box(page, "vehicles:read")).toBeChecked();
    await page.locator("#consent-pin").fill("1234");
    await page.locator("main button").last().click();
    await expect.poll(() => hits.post).toBe(1);
    expect(hits.get).toBeGreaterThan(0);
    expect(posted[0].scopes).toEqual([...CHATGPT, "vehicles:read"]);
  });

  test("leaves the extra section out when the assistant asked for everything", async ({ page }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `claude-consent-${testInfo.project.name}`);
    const { hits, posted } = await stubConsent(page, { ...DETAILS, scopes: [...MCP_SCOPES], available: [] });
    await page.goto(`/oauth/consent/${REQUEST_ID}`, { waitUntil: "domcontentloaded" });

    await expect(box(page, "family:read")).toBeChecked({ timeout: 60_000 });
    await expect(page.getByTestId("consent-available-scopes")).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(MCP_SCOPES.length);

    // The requested-only path posts exactly what it did before: the
    // requested scopes as ticked.
    await tick(page, "home:control");
    await expect(box(page, "home:control")).not.toBeChecked();
    await page.locator("#consent-pin").fill("1234");
    await page.locator("main button").last().click();
    await expect.poll(() => hits.post).toBe(1);
    expect(hits.get).toBeGreaterThan(0);
    expect(posted[0].scopes).toEqual(MCP_SCOPES.filter((s) => s !== "home:control"));
  });
});
