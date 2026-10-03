import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { DB_CONTAINER } from "./whole-database";

/**
 * A camera takeover (#335) that runs out while its full-screen view is open.
 *
 * The overlay is the camera viewer's own dialog, opened with nothing behind
 * it, and the time running out unmounts it while the dialog is still open --
 * there is no close animation, no onOpenChange(false), the component is just
 * gone. A modal dialog locks the page while it is up: pointer-events: none
 * on <body>, a scroll lock, an overlay over everything. If any of that
 * outlived the unmount, the wall display would look normal and ignore every
 * tap until somebody reloaded it.
 *
 * The takeover and the camera list are served to the page rather than
 * written to the database, so this touches no family's data: the only row
 * it creates is the join device, deleted afterwards. Run with
 * --project=webkit as well as Chromium. Needs FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block" });

const DEVICE = (project: string) => `claude-camera-takeover-${project}`;

test.afterAll(({}, testInfo) => {
  if (!DB_CONTAINER) return;
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c",
      `DELETE FROM devices WHERE hardware_id = 'e2e-${DEVICE(testInfo.project.name)}'`],
    { encoding: "utf8" },
  );
});

async function deviceIdOf(page: Page): Promise<{ familyId: string; deviceId: string }> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "family-calendar-storage");
  expect(cookie, "no family-calendar-storage cookie").toBeTruthy();
  const state = JSON.parse(decodeURIComponent(cookie!.value)).state;
  return { familyId: state.family.id, deviceId: state.device.id };
}

test("the page is tappable again after a takeover ends with its dialog open", async ({ page }, testInfo) => {
  await establishSession(page, familyCode!, DEVICE(testInfo.project.name));
  const { familyId, deviceId } = await deviceIdOf(page);

  const camera = {
    id: "cam-e2e-door",
    name: "E2E front door",
    stream_type: "mjpeg",
    // Nothing answers here: the view shows its loading or error state, which is all this needs.
    stream_url: "http://127.0.0.1:9/never",
    enabled: true,
    position: 0,
    created_at: "2026-10-01T00:00:00.000Z",
  };
  // The clock starts when the screen first asks, not when the test does: a
  // dev server compiling the page can take longer than the takeover lasts.
  let ends = 0;
  let takeover: Record<string, unknown> | null = null;
  let takeoverHits = 0;
  let cameraHits = 0;
  await page.route("**/api/camera-takeover**", (route) => {
    takeoverHits++;
    if (!takeover) {
      const started = Date.now();
      ends = started + 12_000;
      takeover = {
        family_id: familyId,
        camera_id: camera.id,
        device_ids: [deviceId],
        started_at: new Date(started).toISOString(),
        ends_at: new Date(ends).toISOString(),
      };
    }
    return route.fulfill({ json: { takeover } });
  });
  await page.route(/\/api\/settings\?.*key=cameras/, (route) => {
    cameraHits++;
    return route.fulfill({ json: { value: { cameras: [camera] } } });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const dialog = page.getByRole("dialog");
  // Generous: a dev server compiles the page on first visit.
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText(camera.name);
  expect(takeoverHits).toBeGreaterThan(0);
  expect(cameraHits).toBeGreaterThan(0);
  // While it is up, the page underneath is locked, as a modal should be.
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe("none");

  // The time runs out with the dialog still open: the overlay unmounts.
  await expect(dialog).toHaveCount(0, { timeout: Math.max(0, ends - Date.now()) + 10_000 });

  const after = await page.evaluate(() => ({
    bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
    bodyStyle: document.body.getAttribute("style") ?? "",
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    scrollLocked: document.body.hasAttribute("data-scroll-locked"),
    ariaHiddenSiblings: Array.from(document.body.children).filter((el) => el.getAttribute("aria-hidden") === "true")
      .map((el) => el.tagName + (el.id ? `#${el.id}` : "")),
    overlays: document.querySelectorAll("[data-radix-portal], [role=dialog], [data-state=open][class*=fixed]").length,
  }));
  testInfo.annotations.push({ type: "after-unmount", description: JSON.stringify(after) });
  expect(after.bodyPointerEvents).not.toBe("none");
  expect(after.bodyStyle).not.toMatch(/pointer-events:\s*none/);
  expect(after.scrollLocked).toBe(false);
  expect(after.bodyOverflow).not.toBe("hidden");
  expect(after.htmlOverflow).not.toBe("hidden");
  expect(after.ariaHiddenSiblings).toEqual([]);
  expect(after.overlays).toBe(0);

  // And a real tap reaches the page: the element at the centre of the screen
  // is the page's own, not something left over on top, and clicking a nav
  // link navigates.
  const topmost = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return el ? { tag: el.tagName, inDialog: !!el.closest("[role=dialog]") } : null;
  });
  expect(topmost?.inDialog).toBe(false);
  const link = page.locator('nav a[href^="/"]:not([href="/"]):visible').first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  await link.click({ timeout: 30_000 });
  // The nav marks the page it went to. (The wide layout can change page
  // without changing the URL, so the URL is not the thing to check.)
  // Generous again: the dev server compiles the next page on first visit.
  await expect(page.locator(`nav a[href="${href}"]:visible`).first()).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
});
