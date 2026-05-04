import { test, expect } from "@playwright/test";
import { getDemoJoinCode } from "./helpers";

/**
 * One-shot spec: visits /join, enters the demo family code, and writes
 * storageState.json so every subsequent spec is already-joined. Runs in
 * the bootstrap project; other projects load this storage state.
 */
test("join the demo family and persist storage state", async ({ page }) => {
  const code = getDemoJoinCode();
  console.log(`  using join code: ${code}`);

  // Surface browser console + page errors + failed network requests so
  // we can debug bootstrap failures.
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`  [browser ${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.log(`  [page error] ${err.message}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().includes("/_next/")) {
      console.log(`  [http ${res.status()}] ${res.request().method()} ${res.url()}`);
    }
  });

  // Hard-navigate to /join — that's deterministic regardless of whether
  // a stale cookie says we're already authed.
  await page.goto("/join");
  await page.waitForLoadState("domcontentloaded");

  // Wait for the join-code input to mount.
  const joinInput = page.locator("#join-code");
  await joinInput.waitFor({ state: "visible", timeout: 15000 });
  await joinInput.fill(code);

  // Optional device name — leave empty to use the i18n default.

  // Submit the form. Use type=submit selector so we don't have to chase
  // locale-specific button text.
  const submitBtn = page.locator('form button[type="submit"]').first();
  await submitBtn.click();

  // Wait until we're off /join and on a real route (typically /).
  await page.waitForURL((url) => !url.pathname.startsWith("/join"), {
    timeout: 20000,
  });
  await page.waitForLoadState("domcontentloaded");

  // Sanity check — the URL is the dashboard (or another in-app route).
  console.log(`  joined; now at ${page.url()}`);

  // Persist cookies + localStorage
  await page.context().storageState({ path: "./playwright/storageState.json" });
  console.log("  wrote playwright/storageState.json");

  // And verify by inspecting the saved file's cookies for our family link.
  const ss = await page.context().storageState();
  const deviceCookie = ss.cookies.find((c) => c.name === "family-calendar-device-id");
  if (!deviceCookie) {
    throw new Error("No family-calendar-device-id cookie after join — flow didn't take.");
  }
  console.log(`  device-id cookie persisted: ${deviceCookie.value.slice(0, 12)}…`);
});
