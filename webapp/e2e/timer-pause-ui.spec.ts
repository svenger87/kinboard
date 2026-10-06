import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * Pausing a timer on a running stack: a paused timer's time stands still, on
 * a reload as on the screen that paused it; its push is gone while it is
 * paused and back, later, once it is resumed; and a stopped timer can't be
 * paused. Needs FAMILY_CODE.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// One device for the file, joined once (see time-zone-ui.spec.ts).
test.describe.configure({ mode: "serial" });
const DEVICE = "timer-pause-ui";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

test.afterAll(() => {
  psql(`DELETE FROM devices WHERE hardware_id = 'e2e-${DEVICE}'`);
});

async function familyId(page: Page): Promise<string> {
  const store = (await page.context().cookies()).find((c) => c.name === "family-calendar-storage");
  return JSON.parse(decodeURIComponent(store!.value)).state.family.id;
}

test("a paused timer stands still everywhere, its push waits, and it resumes where it stopped", async ({ page }, testInfo) => {
  await establishSession(page, familyCode!, DEVICE);
  const family = await familyId(page);
  // Other specs' timers may be on this board too; the label marks this one.
  const label = `pause-${testInfo.project.name}-${Date.now()}`;
  const start = await page.request.post("/api/timers", { data: { family_id: family, label, duration_seconds: 300 } });
  expect(start.ok()).toBe(true);
  const id = ((await start.json()) as { timer: { id: string } }).timer.id;
  const pushes = () => psql(`SELECT count(*) FROM scheduled_notifications WHERE related_entity_type = 'timer' AND related_entity_id = '${id}'`);
  expect(pushes()).toBe("1");

  await page.goto("/");
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  const row = page.getByText(label).locator("..");
  const time = row.locator(".font-mono");
  await expect(row.getByRole("button", { name: "Pause" })).toBeVisible({ timeout: 15_000 });

  await row.getByRole("button", { name: "Pause" }).click();
  await expect(row.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(row.getByText("Paused", { exact: true })).toBeVisible();
  const frozen = await time.textContent();
  await page.waitForTimeout(2500);
  expect(await time.textContent()).toBe(frozen);
  expect(pushes()).toBe("0");

  // Any other screen sees the same: a reload reads it from the server.
  await page.reload();
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  await expect(row.getByRole("button", { name: "Resume" })).toBeVisible({ timeout: 15_000 });
  expect(await time.textContent()).toBe(frozen);

  // Paused a while longer, so a pause left out of the end would show.
  await page.waitForTimeout(3000);
  expect(await time.textContent()).toBe(frozen);

  await row.getByRole("button", { name: "Resume" }).click();
  await expect(row.getByRole("button", { name: "Pause" })).toBeVisible();
  // At once, it reads about the time it stood at. The widget's clock stood
  // still while nothing ran, and used to show the time plus the whole pause
  // until its first tick. A second up is the screen's clock, which it knows
  // to the second from a Date header; a paused timer is shown from the
  // server's own stamps.
  const seconds = (mmss: string | null) => Number(mmss!.split(":")[0]) * 60 + Number(mmss!.split(":")[1]);
  expect(seconds(await time.textContent())).toBeLessThanOrEqual(seconds(frozen) + 2);
  await expect.poll(() => time.textContent(), { timeout: 5_000 }).not.toBe(frozen);
  // The pause, held for over five seconds above, is in its end.
  expect(Number(psql(`SELECT paused_seconds FROM timers WHERE id = '${id}'`))).toBeGreaterThanOrEqual(5);
  // The push is queued again, for an end later than the one it had.
  expect(pushes()).toBe("1");
  expect(
    psql(`SELECT n.scheduled_for > t.started_at + make_interval(secs => t.duration_seconds)
            FROM scheduled_notifications n JOIN timers t ON t.id = n.related_entity_id
           WHERE n.related_entity_type = 'timer' AND n.related_entity_id = '${id}'`),
  ).toBe("t");

  await row.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText(label)).toHaveCount(0, { timeout: 10_000 });
  const late = await page.request.post(`/api/timers/${id}/pause`, { data: { family_id: family } });
  expect(late.status()).toBe(409);
});
