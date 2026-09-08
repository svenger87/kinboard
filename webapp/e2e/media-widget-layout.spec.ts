import { test, expect, type Page } from "@playwright/test";
import { establishSession } from "./session";
import { DEFAULT_WIDGET_VISIBILITY } from "../src/types/widgets";
import type { WidgetVisibility } from "../src/types/widgets";

/**
 * Two claims that only a rendered page can settle.
 *
 * The widget must be absent when nothing is playing — that is what earns it
 * dashboard space (RFC-003 §7) — and controls must appear only for declared
 * capabilities, which is the guard that stops the capability system rotting
 * into "draw everything and hope" (§2.4).
 *
 * Home Assistant is stubbed at the proxy so the test does not need one.
 *
 * The `media` widget flag defaults OFF (`DEFAULT_WIDGET_VISIBILITY.media` —
 * it needs a media player configured before it can show anything, same as
 * photos). Asserting the widget is absent against a family that never
 * switched it on would pass for the wrong reason: it is absent because it is
 * disabled, not because nothing is playing. So `beforeAll` below turns it on
 * for the test family (merging onto whatever is already saved, so sibling
 * widgets' flags survive) and `afterAll` restores exactly what was there —
 * the row's previous value, or no row at all if none existed.
 *
 * The widget's accessible name is `t("title")`, which is locale-dependent
 * ("Media" in English, "Medien" in German). `test.use({ locale: "en-US" })`
 * below pins the browser's Accept-Language so that resolves to English
 * deterministically — not merely because CI happens to run English — in
 * both Chromium and WebKit.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
const DEVICE_NAME = process.env.PLAYWRIGHT_DEVICE_NAME ?? "Media Widget Test";

const entity = (state: string, supported: number) => ({
  entities: [
    {
      entity_id: "media_player.test",
      state,
      attributes: {
        friendly_name: "Test Speaker",
        media_title: "A Song",
        media_artist: "An Artist",
        supported_features: supported,
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
  ],
});

async function familyIdOf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const raw = cookies.find((c) => c.name === "family-calendar-storage")?.value;
  if (!raw) throw new Error("familyIdOf: no family-calendar-storage cookie yet");
  const parsed = JSON.parse(decodeURIComponent(raw));
  const id = parsed?.state?.family?.id;
  if (!id) throw new Error("familyIdOf: session cookie had no family id");
  return id as string;
}

async function getWidgetVisibility(page: Page, familyId: string): Promise<WidgetVisibility | null> {
  const res = await page.request.get(
    `/api/settings?family_id=${familyId}&key=widget_visibility`,
  );
  if (!res.ok()) throw new Error(`GET widget_visibility: ${res.status()}`);
  const json = await res.json();
  return json.value ?? null;
}

async function putWidgetVisibility(page: Page, familyId: string, value: WidgetVisibility) {
  const res = await page.request.put("/api/settings", {
    data: { family_id: familyId, key: "widget_visibility", value },
  });
  if (!res.ok()) throw new Error(`PUT widget_visibility: ${res.status()}`);
}

async function deleteWidgetVisibility(page: Page, familyId: string) {
  const res = await page.request.delete("/api/settings", {
    data: { family_id: familyId, key: "widget_visibility" },
  });
  if (!res.ok()) throw new Error(`DELETE widget_visibility: ${res.status()}`);
}

async function seedMediaPlayer(page: Page, familyId: string): Promise<string> {
  const res = await page.request.post("/api/media-players", {
    data: {
      family_id: familyId,
      driver: "home_assistant",
      nickname: "Test Speaker",
      position: 0,
      config: { entity_id: "media_player.test" },
    },
  });
  if (!res.ok()) throw new Error(`seed media_players row: ${res.status()}`);
  const json = await res.json();
  return json.player.id as string;
}

async function deleteMediaPlayer(page: Page, familyId: string, id: string) {
  await page.request.delete(`/api/media-players/${id}?family_id=${familyId}`);
}

test.describe("the media widget", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE to reach the dashboard");
  // Pin the accessible-name assertion below to a deterministic locale rather
  // than whatever Accept-Language the container/engine happens to negotiate.
  test.use({ locale: "en-US" });
  // Both tests share one seeded media_players row and one widget_visibility
  // override; running them concurrently would race the setup/teardown.
  test.describe.configure({ mode: "serial" });

  let setupPage: Page;
  let familyId: string;
  let playerId: string;
  let originalWidgetVisibility: WidgetVisibility | null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    setupPage = await context.newPage();
    await establishSession(setupPage, FAMILY_CODE, DEVICE_NAME);
    familyId = await familyIdOf(setupPage);

    originalWidgetVisibility = await getWidgetVisibility(setupPage, familyId);
    await putWidgetVisibility(setupPage, familyId, {
      ...DEFAULT_WIDGET_VISIBILITY,
      ...(originalWidgetVisibility ?? {}),
      media: true,
    });

    playerId = await seedMediaPlayer(setupPage, familyId);
  });

  test.afterAll(async () => {
    if (playerId) await deleteMediaPlayer(setupPage, familyId, playerId);
    if (originalWidgetVisibility) {
      await putWidgetVisibility(setupPage, familyId, originalWidgetVisibility);
    } else {
      await deleteWidgetVisibility(setupPage, familyId);
    }
    await setupPage?.context().close();
  });

  test("is absent when nothing is playing", async ({ page }) => {
    await establishSession(page, FAMILY_CODE, DEVICE_NAME);
    await page.route((u) => u.pathname === "/api/homeassistant/states", (r) =>
      r.fulfill({ json: entity("idle", 16385) }),
    );
    await page.goto("/");
    await page.waitForTimeout(3000);
    await expect(page.getByRole("region", { name: "Media" })).toHaveCount(0);
  });

  // The positive control for the test above: without it, deleting the
  // `{w.media && <MediaPlayerWidget />}` line from page.tsx (the exact gap
  // this task found — the widget declared, never mounted) leaves both tests
  // green, because "absent" alone can't distinguish "correctly hidden" from
  // "never wired up at all".
  test("is present when something is playing", async ({ page }) => {
    await establishSession(page, FAMILY_CODE, DEVICE_NAME);
    await page.route((u) => u.pathname === "/api/homeassistant/states", (r) =>
      r.fulfill({ json: entity("playing", 16385) }),
    );
    await page.goto("/");
    await page.waitForTimeout(3000);
    await expect(page.getByRole("region", { name: "Media" })).toHaveCount(1);
  });

  test("draws only the controls the device claims", async ({ page }) => {
    await establishSession(page, FAMILY_CODE, DEVICE_NAME);
    // PLAY|PAUSE only: transport, but no next, no volume, no sources.
    await page.route((u) => u.pathname === "/api/homeassistant/states", (r) =>
      r.fulfill({ json: entity("playing", 16385) }),
    );
    await page.goto("/media");
    await page.waitForTimeout(3000);

    await expect(page.getByRole("button", { name: "Play or pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next track" })).toHaveCount(0);
    // Not `getByRole("slider", ...)`: player-card.tsx puts the accessible
    // name on the wrapping `role="group"` div, not on the Radix thumb itself
    // (a bare Slider carries no accessible name of its own, and nothing here
    // passes Radix the prop that would give the thumb one) — so a slider
    // query named "Volume" matches zero elements whether or not the control
    // renders, and the assertion below would never fail either way.
    await expect(page.getByRole("group", { name: "Volume" })).toHaveCount(0);
  });
});
