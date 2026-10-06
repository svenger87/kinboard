import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * Settings → Widgets → Timers → Preset times, against a running stack: a time
 * added there is a button on Home that starts a timer that long, a removed one
 * goes, the last one stays, Reset brings back 3, 5, 10 and 15, and the
 * settings route refuses a list the widget could not use. Needs FAMILY_CODE.
 *
 * The family is shared with the other specs, and timer-widget-layout.spec.ts
 * may look for "3 min" on the same board at any moment, so 3 is never removed
 * here. Each test starts from the defaults and puts back what was there.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// One device for the file, joined once: joining is limited to 10 a minute per
// IP and the smoke run already comes close (see session.ts).
test.describe.configure({ mode: "serial" });
const DEVICE = "timer-presets-ui";

test.afterAll(() => {
  execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", `DELETE FROM devices WHERE hardware_id = 'e2e-${DEVICE}'`],
    { encoding: "utf8" },
  );
});

let familyId = "";
let saved: unknown = null;

async function stored(page: Page): Promise<unknown> {
  const res = await page.request.get(`/api/settings?family_id=${familyId}&key=timer_widget`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { value: unknown }).value;
}

async function clear(page: Page): Promise<void> {
  const res = await page.request.delete("/api/settings", { data: { family_id: familyId, key: "timer_widget" } });
  expect(res.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await establishSession(page, familyCode!, DEVICE);
  const store = (await page.context().cookies()).find((c) => c.name === "family-calendar-storage");
  familyId = JSON.parse(decodeURIComponent(store!.value)).state.family.id;
  saved = await stored(page);
  await clear(page);
});

test.afterEach(async ({ page }) => {
  if (saved === null) {
    await clear(page);
  } else {
    await page.request.put("/api/settings", { data: { family_id: familyId, key: "timer_widget", value: saved } });
  }
});

async function openEditor(page: Page) {
  await page.goto("/settings/widgets", { waitUntil: "domcontentloaded" });
  const editor = page.getByTestId("timer-presets");
  // The first paint waits on the PIN guard and the settings; a dev server
  // compiling on demand takes longer than the default 5 s.
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.scrollIntoViewIfNeeded();
  return editor;
}

const chips = (editor: ReturnType<Page["getByTestId"]>) => editor.getByRole("listitem");
const minutesBox = (editor: ReturnType<Page["getByTestId"]>) =>
  editor.getByRole("spinbutton", { name: "Preset time to add, in minutes" });

test("a time added in Settings is a button on Home that starts a timer that long, and a removed one goes", async ({ page }) => {
  const editor = await openEditor(page);
  await expect(chips(editor)).toHaveText(["3 min", "5 min", "10 min", "15 min"]);
  await expect(editor.getByRole("button", { name: "Reset to defaults" })).toHaveCount(0);

  await minutesBox(editor).fill("7");
  await editor.getByRole("button", { name: "Add", exact: true }).click();
  await expect(chips(editor)).toHaveText(["3 min", "5 min", "7 min", "10 min", "15 min"]);
  await expect(minutesBox(editor)).toHaveValue("");
  await editor.getByRole("button", { name: "Remove 15 min" }).click();
  await expect(chips(editor)).toHaveText(["3 min", "5 min", "7 min", "10 min"]);
  await expect.poll(() => stored(page)).toEqual({ presets: [3, 5, 7, 10] });

  await page.goto("/");
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  for (const name of ["3 min", "5 min", "7 min", "10 min"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "15 min", exact: true })).toHaveCount(0);

  // Other specs' timers may be on this board too; only a seven-minute one
  // reads 6:5x. Stopped straight away, which also cancels its push.
  await page.getByRole("button", { name: "7 min", exact: true }).click();
  const countdown = page.getByText(/^(7:00|6:[45]\d)$/);
  await expect(countdown).toBeVisible({ timeout: 10_000 });
  // The time sits in a column of its own, with "Paused" under it when it is
  // paused; the row is the first div around it.
  await countdown.locator("xpath=ancestor::div[1]").getByRole("button", { name: "Stop" }).click();
  await expect(countdown).toHaveCount(0, { timeout: 10_000 });
});

test("the last time can't be removed, and Reset brings back 3, 5, 10 and 15", async ({ page }) => {
  const editor = await openEditor(page);
  for (const minutes of [15, 10, 5]) {
    await editor.getByRole("button", { name: `Remove ${minutes} min` }).click();
  }
  await expect(chips(editor)).toHaveText(["3 min"]);
  await expect(editor.getByRole("button", { name: "Remove 3 min" })).toBeDisabled();
  await expect.poll(() => stored(page)).toEqual({ presets: [3] });

  await editor.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(chips(editor)).toHaveText(["3 min", "5 min", "10 min", "15 min"]);
  await expect(editor.getByRole("button", { name: "Reset to defaults" })).toHaveCount(0);
  // The defaults are no value: the setting is gone.
  await expect.poll(() => stored(page)).toBeNull();
});

test("the box takes whole minutes up to a day, no repeats, and eight at most, on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await openEditor(page);
  const add = editor.getByRole("button", { name: "Add", exact: true });

  for (const bad of ["0", "2.5", "1441", "-4"]) {
    await minutesBox(editor).fill(bad);
    await expect(editor.getByText("Enter whole minutes, from 1 to 1440."), bad).toBeVisible();
    await expect(add, bad).toBeDisabled();
  }
  await minutesBox(editor).fill("5");
  await expect(editor.getByText("5 min is already a preset.")).toBeVisible();
  await expect(add).toBeDisabled();

  for (const minutes of ["90", "1", "2"]) {
    await minutesBox(editor).fill(minutes);
    // Enter adds, as the button does.
    await minutesBox(editor).press("Enter");
    await expect(minutesBox(editor)).toHaveValue("");
  }
  // The eighth: the box makes way for a note.
  await minutesBox(editor).fill("1440");
  await minutesBox(editor).press("Enter");
  await expect(chips(editor)).toHaveText(["1 min", "2 min", "3 min", "5 min", "10 min", "15 min", "90 min", "1440 min"]);
  await expect(minutesBox(editor)).toHaveCount(0);
  await expect(editor.getByText("That's the most there can be (8). Remove one to add another.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await expect.poll(() => stored(page)).toEqual({ presets: [1, 2, 3, 5, 10, 15, 90, 1440] });
});

test("the settings route refuses a list the widget could not use", async ({ page }) => {
  for (const value of [
    [3, 5],
    { presets: [] },
    { presets: [0] },
    { presets: [2.5] },
    { presets: ["5"] },
    { presets: [1441] },
    { presets: [5, 5] },
    { presets: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { presets: "5" },
    { presets: [3, 5], extra: true },
  ]) {
    const res = await page.request.put("/api/settings", { data: { family_id: familyId, key: "timer_widget", value } });
    expect(res.status(), JSON.stringify(value)).toBe(400);
  }
  expect(await stored(page)).toBeNull();
  const ok = await page.request.put("/api/settings", { data: { family_id: familyId, key: "timer_widget", value: { presets: [3, 8] } } });
  expect(ok.status()).toBe(200);
  expect(await stored(page)).toEqual({ presets: [3, 8] });
});

test.describe("while the presets can't be read", () => {
  // The service worker would answer the settings read before page.route sees it.
  test.use({ serviceWorkers: "block" });

  for (const how of ["still loading", "failed"] as const) {
    test(`the widget shows 3, 5, 10 and 15 when the read has ${how === "failed" ? "failed" : "not come back"}`, async ({ page }) => {
      // The family's own, so the defaults on screen can only be the fallback.
      const put = await page.request.put("/api/settings", {
        data: { family_id: familyId, key: "timer_widget", value: { presets: [4, 7] } },
      });
      expect(put.ok()).toBe(true);
      let hits = 0;
      await page.route(/\/rest\/v1\/settings\?.*key=eq\.timer_widget/, (route) => {
        hits++;
        // Left unanswered, the read stays loading for the rest of the test.
        if (how === "failed") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".hero-block", { timeout: 20_000 });
      for (const name of ["3 min", "5 min", "10 min", "15 min"]) {
        await expect(page.getByRole("button", { name, exact: true })).toBeVisible({ timeout: 15_000 });
      }
      await expect(page.getByRole("button", { name: "7 min", exact: true })).toHaveCount(0);
      expect(hits).toBeGreaterThan(0);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });
  }
});
