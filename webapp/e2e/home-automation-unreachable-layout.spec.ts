import { expect, test } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
test.skip(!FAMILY_CODE, "needs a running stack");
// The PWA service worker answers fetches before page.route sees them, so a
// stubbed endpoint would silently serve the real response; `requests` below
// proves the stub is the one answering.
test.use({ serviceWorkers: "block" });

test("an unreachable smart home keeps its message readable and its actions usable", async ({ page, baseURL }, testInfo) => {
  const familyName = `unreachable-layout-${testInfo.project.name}-${Date.now()}`;
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const familyId = await createThrowawayFamily(page, familyName);
  let requests = 0;
  let recovered = false;
  try {
    await gotoAfterJoin(page, "/home-automation");
    const seeded = await page.evaluate(async (familyId) => {
      const headers = { "Content-Type": "application/json" };
      const settings = await fetch("/api/settings", {
        method: "PUT", headers,
        body: JSON.stringify({ family_id: familyId, key: "home_assistant", value: {
          url: "http://home-assistant.invalid:8123", access_token: "e2e-not-a-real-token",
        } }),
      });
      const device = await fetch("/api/catalogue", {
        method: "POST", headers,
        body: JSON.stringify({ family_id: familyId, kind: "ha_entity", entity_id: "light.unreachable_layout", name: "Test light" }),
      });
      return { settings: settings.status, device: device.status };
    }, familyId);
    expect(seeded.settings).toBe(200);
    expect(seeded.device).toBe(201);

    await page.route(/\/api\/homeassistant\/states\?/, async (route) => {
      requests++;
      await route.fulfill({
        status: recovered ? 200 : 503,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: recovered ? JSON.stringify({ entities: [] }) : JSON.stringify({ error: "unreachable" }),
      });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    const alert = page.getByRole("alert").filter({ hasText: "Nothing here can be controlled" });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    expect(requests).toBeGreaterThan(0);
    const body = alert.getByText("Nothing here can be controlled until the connection is back.");
    const retry = alert.getByRole("button", { name: "Try again" });
    const settings = alert.getByRole("link", { name: "Check connection" });
    await expect(settings).toHaveAttribute("href", "/settings/homeassistant");
    const [bannerBox, bodyBox, retryBox, settingsBox] = await Promise.all([
      alert.boundingBox(), body.boundingBox(), retry.boundingBox(), settings.boundingBox(),
    ]);
    expect(bannerBox && bodyBox && retryBox && settingsBox).toBeTruthy();
    if (!bannerBox || !bodyBox || !retryBox || !settingsBox) return;
    if (testInfo.project.name === "mobile") {
      expect(bodyBox.width).toBeGreaterThan(230);
      expect(bannerBox.height).toBeLessThan(190);
      expect(retryBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height);
      expect(settingsBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height);
      expect(retryBox.height).toBeGreaterThanOrEqual(40);
      expect(settingsBox.height).toBeGreaterThanOrEqual(40);
    } else {
      expect(bodyBox.width).toBeGreaterThan(300);
      expect(retryBox.y).toBeLessThan(bodyBox.y + bodyBox.height);
      expect(settingsBox.y).toBeLessThan(bodyBox.y + bodyBox.height);
    }
    recovered = true;
    await retry.click();
    await expect(alert).toBeHidden();
    expect(requests).toBeGreaterThan(1);
  } finally {
    await deleteThrowawayFamily(page, familyId, familyName);
  }
});
