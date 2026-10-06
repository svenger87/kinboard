import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * A wall display's timer alarm, against a running stack: until somebody
 * touches the screen it says the sound is off; the first touch turns it on
 * and still does what it was for; and a timer that runs out while the panel
 * shows another page rings there, again and again. Every tone the page schedules is counted (two oscillators each).
 * Needs FAMILY_CODE.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// One device for the file, joined once (see time-zone-ui.spec.ts).
test.describe.configure({ mode: "serial" });
const DEVICE = "timer-alarm-ui";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

test.beforeAll(() => {
  // A kiosk, as the wall tablet is: the join keeps a known device's row,
  // is_kiosk included.
  const familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
  psql(
    `INSERT INTO devices (family_id, name, hardware_id, is_kiosk)
     SELECT '${familyId}', '${DEVICE}', 'e2e-${DEVICE}', true
     WHERE NOT EXISTS (SELECT 1 FROM devices WHERE family_id = '${familyId}' AND hardware_id = 'e2e-${DEVICE}')`,
  );
  psql(`UPDATE devices SET is_kiosk = true WHERE family_id = '${familyId}' AND hardware_id = 'e2e-${DEVICE}'`);
});
test.afterAll(() => {
  psql(`DELETE FROM devices WHERE hardware_id = 'e2e-${DEVICE}'`);
});

async function startTimer(page: Page, label: string, seconds: number) {
  await page.evaluate(
    async ({ label, seconds }) => {
      const raw = decodeURIComponent(
        document.cookie.split("; ").find((c) => c.startsWith("family-calendar-storage="))!.split("=")[1],
      );
      const familyId = JSON.parse(raw).state.family.id;
      await fetch("/api/timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: familyId, label, duration_seconds: seconds }),
      });
    },
    { label, seconds },
  );
}

const tones = (page: Page) => page.evaluate(() => (window as unknown as { __oscillators: number }).__oscillators);

test("a kiosk says its sound is off until touched, keeps the first tap, then rings on any page, again and again", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __oscillators: number };
    w.__oscillators = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.__oscillators++;
      return create.call(this);
    };
  });
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/");
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-kiosk"))).toBe(true);

  // Two timers started elsewhere: nobody has touched this screen yet.
  const label = `alarm-${testInfo.project.name}-${Date.now()}`;
  await startTimer(page, `${label}-first`, 600);
  await startTimer(page, `${label}-long`, 600);
  // Reloaded rather than waiting on realtime (see timer-widget-layout.spec.ts);
  // nothing has been touched yet, so nothing is lost by it.
  await page.reload();
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  const note = page.getByText("Tap for sound");
  await expect(note).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`${label}-first`)).toBeVisible({ timeout: 15_000 });

  // The first touch is a tap on a timer's own button, as when somebody walks
  // up to answer it. It turns the sound on, and it still does what it says:
  // the note going away moves nothing under the finger.
  await page.getByText(`${label}-first`).locator("..").getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText(`${label}-first`)).toHaveCount(0, { timeout: 10_000 });
  await expect(note).toHaveCount(0);

  // Off to another page, as when the kitchen panel shows a recipe.
  await page.getByRole("link", { name: "Calendar", exact: true }).first().click();
  await page.waitForURL(/\/calendar/);
  await startTimer(page, `${label}-short`, 2);
  await expect.poll(() => tones(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  const first = await tones(page);
  // Rung again a few seconds later, still on the calendar.
  await expect.poll(() => tones(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(first + 2);

  // Back home, answered: both stopped, so nothing of this spec stays on the board.
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  for (const which of ["short", "long"]) {
    const row = page.getByText(`${label}-${which}`).locator("..");
    await row.getByRole("button", { name: which === "short" ? "Dismiss" : "Stop" }).click();
    await expect(page.getByText(`${label}-${which}`)).toHaveCount(0, { timeout: 10_000 });
  }
});
