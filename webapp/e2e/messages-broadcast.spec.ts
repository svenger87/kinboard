import { test, expect, type Browser } from "@playwright/test";
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
});
