import { test, expect } from "@playwright/test";
import { establishSession } from "./session";

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

/*
  Reported from a real household: selecting a source on an LG soundbar turned
  the soundbar on, switched it, and then Kinboard said the command had failed.

  Home Assistant's REST `/api/services/...` blocks until the service finishes,
  so the route's timeout bounds the *device*, not the network. At 10s a
  soundbar waking up and changing inputs beat it, the fetch aborted, and the
  route returned 500 — telling the household a command had failed while they
  watched it work. That is the wall-panel lie this codebase keeps finding,
  inverted.

  The route now answers 202 for a timeout: delivered, outcome unknown. The
  optimistic value then stands until a poll agrees, disagrees, or the settle
  elapses — machinery that already exists for the 200-that-does-nothing case.

  The skip is on the describe, not in the test: ci.yml's stack-free Specs job
  installs no browsers, so a `page` fixture would fail at launch before a skip
  in the body could run.
*/
test.describe("a device that is slow to confirm", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE and a running stack");
  test.use({ serviceWorkers: "block" });

  test("is not reported to the household as a failure", async ({ page }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `claude-to-${testInfo.project.name}`);

    // Both projects share one family and one database, so names carry the
    // project and a timestamp or the two runs write over each other.
    const suffix = `${testInfo.project.name}${Date.now()}`.toLowerCase().replace(/[^a-z0-9]/g, "");
    const entityId = `media_player.slow_${suffix}`;
    const nickname = `probe-slow-${suffix}`;

    await page.route("**/api/homeassistant/states**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entities: [
            {
              entity_id: entityId,
              domain: "media_player",
              name: "Slow bar",
              // The soundbar's real mask: PAUSE|VOLUME_SET|VOLUME_MUTE|
              // TURN_ON|TURN_OFF|PLAY_MEDIA|STOP|PLAY|BROWSE.
              state: "off",
              attributes: { friendly_name: "Slow bar", supported_features: 152461 },
              last_changed: new Date().toISOString(),
            },
          ],
        }),
      }),
    );

    // Exactly what the route now sends when Home Assistant does not confirm
    // in time. Asserting against the contract rather than against a real slow
    // device, which cannot be arranged in CI.
    let serviceCalls = 0;
    await page.route("**/api/homeassistant/services**", (r) => {
      serviceCalls += 1;
      return r.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ success: true, timedOut: true }),
      });
    });

    const familyId = await page.evaluate(() => {
      const raw = decodeURIComponent(
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("family-calendar-storage="))!
          .split("=")[1],
      );
      return JSON.parse(raw).state.family.id as string;
    });

    const created = await page.evaluate(
      async ({ fid, eid, nick }) => {
        const res = await fetch("/api/media-players", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            family_id: fid,
            driver: "home_assistant",
            nickname: nick,
            config: { entity_id: eid },
          }),
        });
        return res.ok
          ? { id: ((await res.json()) as { player: { id: string } }).player.id }
          : { error: `${res.status}` };
      },
      { fid: familyId, eid: entityId, nick: nickname },
    );
    if ("error" in created) throw new Error(`create player: ${created.error}`);

    try {
      await page.goto("/media", { waitUntil: "domcontentloaded" });
      await expect(page.getByText(nickname)).toBeVisible({ timeout: 20_000 });

      await page.getByRole("button", { name: "Turn on" }).click();
      // Long enough for the mutation to settle and any error text to render.
      await page.waitForTimeout(2_000);

      expect(serviceCalls, "the service route was never called").toBeGreaterThan(0);
      await expect(page.getByText("That did not go through")).toHaveCount(0);
    } finally {
      await page.evaluate(
        async ({ fid, id }) => {
          await fetch(`/api/media-players/${id}?family_id=${fid}`, { method: "DELETE" }).catch(
            () => {},
          );
        },
        { fid: familyId, id: created.id },
      );
    }
  });
});
