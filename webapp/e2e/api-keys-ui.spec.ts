import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * RFC-023 §4.4 on the screens, in a family of its own: Settings -> Weather,
 * Google Calendar and Devices set a family's own key, show it masked, and
 * remove it again, back to the server's (or to none).
 *
 * Runs against a dev server whose environment has an OpenWeatherMap key and
 * a presence token but no Google client — the state the assertions name:
 *
 *   OPENWEATHERMAP_API_KEY=… PRESENCE_SENSOR_TOKEN=… GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET=
 *
 * (KEYS_UI_ENV=1 says the server was started that way; FAMILY_CODE that a
 * stack is there.) The family has no PIN, so it is unlocked; the PIN itself is
 * covered by api-keys-live.spec.ts.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
const PREPARED = process.env.KEYS_UI_ENV === "1";

async function status(page: Page, name: string) {
  return page.getByTestId(`api-key-${name}-status`);
}

async function open(page: Page, path: string, name: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(`api-key-${name}`)).toBeVisible({ timeout: 45_000 });
  await expect(await status(page, name)).toBeVisible({ timeout: 30_000 });
}

async function save(page: Page, name: string) {
  const done = page.waitForResponse((r) => r.url().endsWith("/api/settings/keys") && r.request().method() === "PUT");
  await page.getByTestId(`api-key-${name}-save`).click();
  const res = await done;
  expect(res.status()).toBe(200);
  return res;
}

test.describe("keys in Settings", () => {
  test.skip(!FAMILY_CODE || !PREPARED, "needs a running stack and a dev server started with KEYS_UI_ENV's environment");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  test.describe.configure({ timeout: 240_000 });

  test("set, show masked, remove: weather, Google and the presence token", async ({ page, baseURL }) => {
    const familyName = `claude-keys-ui-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await gotoAfterJoin(page, "/");

      // ── Weather: the server's key, then the family's, then the server's again.
      await open(page, "/settings/weather", "openweathermap");
      await expect(await status(page, "openweathermap")).toHaveAttribute("data-source", "environment");
      await expect(page.getByTestId("api-key-openweathermap-note")).toContainText("server");
      await page.locator("#api-key-openweathermap-api_key").fill("claude-ui-weather-key-wxyz");
      const saved = await save(page, "openweathermap");
      expect(await saved.text()).not.toContain("claude-ui-weather-key-wxyz");
      await expect(await status(page, "openweathermap")).toHaveAttribute("data-source", "family");
      await expect(page.getByTestId("api-key-openweathermap-note")).toContainText("…wxyz");
      // The field is emptied: the value is not kept on the page.
      await expect(page.locator("#api-key-openweathermap-api_key")).toHaveValue("");
      // After a reload, still the family's, still masked.
      await open(page, "/settings/weather", "openweathermap");
      await expect(await status(page, "openweathermap")).toHaveAttribute("data-source", "family");
      expect(await page.content()).not.toContain("claude-ui-weather-key-wxyz");
      await page.getByTestId("api-key-openweathermap-clear").click();
      await expect(await status(page, "openweathermap")).toHaveAttribute("data-source", "environment");

      // ── Google: no client on the server, so the card leads the page.
      await open(page, "/settings/google", "google_oauth_client");
      await expect(await status(page, "google_oauth_client")).toHaveAttribute("data-source", "none");
      await page.locator("#api-key-google_oauth_client-client_id").fill("claude-ui.apps.googleusercontent.com");
      // Half a client cannot be saved.
      await expect(page.getByTestId("api-key-google_oauth_client-save")).toBeDisabled();
      await page.locator("#api-key-google_oauth_client-client_secret").fill("GOCSPX-claude-ui-secret-9z8y");
      await save(page, "google_oauth_client");
      await expect(await status(page, "google_oauth_client")).toHaveAttribute("data-source", "family");
      await expect(page.getByTestId("api-key-google_oauth_client-note")).toContainText("…9z8y");
      // Connect is offered now, and the redirect address to register is shown.
      await expect(page.getByTestId("google-redirect-uri")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("api-key-google_oauth_client-clear").click();
      await expect(await status(page, "google_oauth_client")).toHaveAttribute("data-source", "none");

      // ── Presence: the card appears once a screen has a sensor.
      await page.evaluate(async () => {
        const { token, device } = await (await fetch("/api/session/token", { cache: "no-store" })).json();
        const id = device?.id ?? JSON.parse(decodeURIComponent(document.cookie.split("family-calendar-storage=")[1].split(";")[0])).state.device.id;
        const r = await fetch(`/rest/v1/devices?id=eq.${id}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ has_presence_sensor: true }),
        });
        if (!r.ok) throw new Error(`device: ${r.status} ${await r.text()}`);
      });
      await open(page, "/settings/devices", "presence_sensor");
      await expect(await status(page, "presence_sensor")).toHaveAttribute("data-source", "environment");
      const generated = page.waitForResponse((r) => r.url().endsWith("/api/settings/keys") && r.request().method() === "POST");
      await page.getByTestId("api-key-presence_sensor-generate").click();
      // A token already in force (the server's): asked first.
      await page.getByTestId("api-key-presence_sensor-generate-confirm").click();
      expect((await generated).status()).toBe(200);
      const token = await page.getByTestId("presence-token-value").inputValue();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      await expect(await status(page, "presence_sensor")).toHaveAttribute("data-source", "family");
      await expect(page.getByTestId("api-key-presence_sensor-note")).toContainText(`…${token.slice(-4)}`);

      // The sensor's report with it is taken; with the server's token, no longer.
      const deviceId = await page.evaluate(
        () => JSON.parse(decodeURIComponent(document.cookie.split("family-calendar-storage=")[1].split(";")[0])).state.device.id as string,
      );
      const report = (bearer: string) =>
        page.request.post("/api/presence", {
          headers: { authorization: `Bearer ${bearer}` },
          data: { device_id: deviceId, presence: true },
        });
      expect((await report(token)).status()).toBe(200);
      expect((await report("not-the-token-0000000000")).status()).toBe(401);

      // Shown once: gone after a reload.
      await open(page, "/settings/devices", "presence_sensor");
      await expect(page.getByTestId("presence-token-value")).toHaveCount(0);
      await page.getByTestId("api-key-presence_sensor-clear").click();
      await expect(await status(page, "presence_sensor")).toHaveAttribute("data-source", "environment");
      expect((await report(token)).status()).toBe(401);
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});
