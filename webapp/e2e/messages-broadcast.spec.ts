import { test, expect, type Browser, type Page } from "@playwright/test";
import { establishSession } from "./session";

/**
 * The rule the whole feature rests on, and the only one that needs two
 * browsers: a message goes to every screen except the one that sent it, and
 * acknowledging it on any screen clears it from all of them.
 *
 * A single-page test cannot see either half. It would pass just as happily
 * against a build that broadcast to everybody including the sender.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

async function screenFor(browser: Browser, deviceName: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await establishSession(page, FAMILY_CODE, deviceName);
  await page.goto("/");
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  await page.waitForTimeout(2500);
  return { context, page };
}

function familyIdOn(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = decodeURIComponent(
      document.cookie.split("; ").find((c) => c.startsWith("family-calendar-storage="))!.split("=")[1],
    );
    return JSON.parse(raw).state.family.id as string;
  });
}

/** POSTs a message from `page`'s device and hands back the new row's id. */
async function sendMessage(page: Page, body: string): Promise<string> {
  const familyId = await familyIdOn(page);
  return page.evaluate(
    async ({ familyId, body }) => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: familyId, body }),
      });
      const data = (await res.json()) as { message: { id: string } };
      return data.message.id;
    },
    { familyId, body },
  );
}

/** "Got it" (or "Withdraw", on the sender's own screen) via the API directly. */
async function acknowledgeMessage(page: Page, id: string): Promise<void> {
  const familyId = await familyIdOn(page);
  await page.evaluate(
    async ({ familyId, id }) => {
      await fetch(`/api/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: familyId }),
      });
    },
    { familyId, id },
  );
}

test.describe("a message reaches the other screens", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE to reach the dashboard");

  test("goes everywhere but the sender, and clears everywhere at once", async ({
    browser,
  }, testInfo) => {
    // Two full dashboards, each polling on its own schedule, against one dev
    // server that both Playwright projects are also sharing: the default
    // 60s budget is sized for a single page and this test runs two, so it
    // measures contention rather than the guard. Solo this test finishes in
    // ~23s; run alongside the other project it has taken up to 70s+ with
    // nothing wrong on either side. 120s leaves headroom without hiding a
    // genuine hang.
    test.setTimeout(120_000);

    // Unique per project and run: both Playwright projects share one family, so
    // the desktop and WebKit runs see each other's messages on the same board.
    const body = `probe-${testInfo.project.name}-${Date.now()}`;

    const sender = await screenFor(browser, `Messages Sender ${testInfo.project.name}`);
    const other = await screenFor(browser, `Messages Other ${testInfo.project.name}`);

    try {
      await sender.page.evaluate(async (text) => {
        const raw = decodeURIComponent(
          document.cookie.split("; ").find((c) => c.startsWith("family-calendar-storage="))!.split("=")[1],
        );
        const familyId = JSON.parse(raw).state.family.id;
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ family_id: familyId, body: text }),
        });
      }, body);

      // The other screen is told. Within its first minute the message lives in
      // the takeover, not in the widget — the widget deliberately hides the one
      // holding the board so it is not on screen twice.
      //
      // 15s is not enough here: two contexts subscribed to the same realtime
      // channel at once reliably trips Supabase's own per-channel budget —
      // confirmed in the realtime container's log during this exact test,
      // "MessagePerSecondRateLimitReached: Too many postgres changes messages
      // per second" — and useMessages() falls back to its 30s poll (the
      // interval used while the list is still empty) when that happens. The
      // wait has to clear that backstop, not just the happy path.
      await expect(other.page.getByText(body)).toBeVisible({ timeout: 35_000 });
      const otherCard = other.page
        .locator("[data-message-takeover], [data-message-row]")
        .filter({ hasText: body });
      await expect(otherCard.getByRole("button", { name: "Got it" })).toBeVisible();

      // The sender is not shouted at: it sees its own message waiting, with
      // "Withdraw" and no "Got it".
      await sender.page.reload();
      await sender.page.waitForSelector(".hero-block", { timeout: 20_000 });
      await expect(sender.page.getByText(body)).toBeVisible({ timeout: 15_000 });
      const senderRow = sender.page.locator("[data-message-row]").filter({ hasText: body });
      await expect(senderRow.getByRole("button", { name: "Withdraw" })).toBeVisible();
      await expect(senderRow.getByRole("button", { name: "Got it" })).toHaveCount(0);
      // And no takeover for *this* message on the sender's own screen. Not
      // "no takeover at all": both projects run against the same family at
      // the same time, so the other project's own still-pending message can
      // legitimately be sitting in takeover here too — that is a different
      // message and not this guard's business.
      await expect(
        sender.page.locator("[data-message-takeover]").filter({ hasText: body }),
      ).toHaveCount(0);

      // One tap ends it for the household. The other screen loses it locally
      // the moment its own mutation resolves; the sender only learns of it
      // through realtime or, if that channel is shedding load as above, the
      // 10s poll that runs while a message is still pending — so the same
      // margin applies here.
      await otherCard.getByRole("button", { name: "Got it" }).click();
      await expect(other.page.getByText(body)).toHaveCount(0, { timeout: 15_000 });
      await expect(sender.page.getByText(body)).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await sender.context.close();
      await other.context.close();
    }
  });

  test("a deep link to an already-seen message says so, and offers Close", async ({
    browser,
  }, testInfo) => {
    // RFC-005 §3.3, step 3 of the RFC's own walkthrough — the one step of the
    // three this feature was never actually tested against. `useBoardMessage`,
    // the by-id query and `GET /api/messages/[id]` are all only exercised here.
    test.setTimeout(60_000);

    const body = `probe-seen-${testInfo.project.name}-${Date.now()}`;

    const sender = await screenFor(browser, `Messages DeepLink Sender ${testInfo.project.name}`);
    const other = await screenFor(browser, `Messages DeepLink Other ${testInfo.project.name}`);

    try {
      const id = await sendMessage(sender.page, body);
      await expect(other.page.getByText(body)).toBeVisible({ timeout: 35_000 });
      await acknowledgeMessage(other.page, id);
      await expect(other.page.getByText(body)).toHaveCount(0, { timeout: 15_000 });

      // A notification click for a message somebody has already dealt with
      // says so, not who — Kinboard has no per-person login, and "seen by
      // Kitchen Panel" tells nobody anything they came to find out.
      await other.page.goto(`/?message=${id}`, { waitUntil: "domcontentloaded" });
      await other.page.waitForSelector(".hero-block", { timeout: 20_000 });

      const takeover = other.page.locator("[data-message-takeover]").filter({ hasText: body });
      await expect(takeover).toBeVisible({ timeout: 15_000 });
      await expect(takeover.getByRole("button", { name: "Close" })).toBeVisible();
      await expect(takeover.getByRole("button", { name: "Got it" })).toHaveCount(0);

      await takeover.getByRole("button", { name: "Close" }).click();
      await expect(other.page.locator("[data-message-takeover]")).toHaveCount(0);
    } finally {
      await sender.context.close();
      await other.context.close();
    }
  });

  test("a fresh message still takes the board on a screen already sitting on a deep link", async ({
    browser,
  }, testInfo) => {
    // The regression guard for finding 1: `?message=<id>` used to win
    // unconditionally and never let go, so a screen parked on a stale deep
    // link never raised another takeover for the rest of its life — a brand
    // new message, well inside its 60-second window, arrived as a small
    // widget row and nothing else. A live takeover must outrank a requested
    // id.
    test.setTimeout(60_000);

    const seenBody = `probe-stale-${testInfo.project.name}-${Date.now()}`;
    const freshBody = `probe-fresh-${testInfo.project.name}-${Date.now()}`;

    const sender = await screenFor(browser, `Messages Regression Sender ${testInfo.project.name}`);
    const watcher = await screenFor(browser, `Messages Regression Watcher ${testInfo.project.name}`);

    try {
      // An already-acknowledged message to deep-link to — "Withdraw" on the
      // sender's own screen, same endpoint as "Got it".
      const seenId = await sendMessage(sender.page, seenBody);
      await acknowledgeMessage(sender.page, seenId);

      // The watcher lands on that deep link and stays there, exactly the
      // screen finding 1 described: parked on `/?message=<id>` indefinitely.
      await watcher.page.goto(`/?message=${seenId}`, { waitUntil: "domcontentloaded" });
      await watcher.page.waitForSelector(".hero-block", { timeout: 20_000 });
      await expect(
        watcher.page.locator("[data-message-takeover]").filter({ hasText: seenBody }),
      ).toBeVisible({ timeout: 15_000 });

      // A brand-new message from a different device, well inside its minute.
      await sendMessage(sender.page, freshBody);

      // It must take the board here too, replacing the stale deep link.
      await expect(
        watcher.page.locator("[data-message-takeover]").filter({ hasText: freshBody }),
      ).toBeVisible({ timeout: 35_000 });
      await expect(watcher.page.locator("[data-message-takeover]")).toHaveCount(1);

      const freshCard = watcher.page
        .locator("[data-message-takeover]")
        .filter({ hasText: freshBody });
      await freshCard.getByRole("button", { name: "Got it" }).click();
      await expect(watcher.page.getByText(freshBody)).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await sender.context.close();
      await watcher.context.close();
    }
  });
});
