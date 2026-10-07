import { test, expect, type Page, type Request } from "@playwright/test";
import { establishSession } from "./session";

/**
 * After a deploy, a page still running the previous build asks for JS chunks
 * that the new build no longer has. Turbopack's runtime turns the 404 into
 * `ChunkLoadError: Failed to load chunk /_next/static/chunks/… from module …`,
 * the App Router error boundary catches it, and the old recovery never saw it:
 * it matched webpack-era wording only, and a caught error never reaches the
 * window listeners anyway. An installed iOS app stayed on "Failed to load
 * chunk" until it was force-closed (#383).
 *
 * The deploy is simulated: once Home has loaded, every chunk it did not
 * already have answers 404 — what a page on the old build sees when it asks
 * the new server for one of its chunks. Every one, not just the first:
 * Turbopack retries a failed script once by itself, and a real deploy does
 * not come back on the retry either. A full document load is the deploy
 * "landing" for this page, so from then on chunks are served normally.
 *
 * Only a production build shows this — `next dev` compiles chunks on demand
 * and never produces the error. CI's smoke job runs one.
 */
const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
/** The Tasks page's own button: proof the page that was asked for rendered. */
const NEW_TASK = /^(New task|Neue Aufgabe|Nouvelle tâche)$/;
/** error.tsx's retry button. */
const RETRY = /^(Try again|Erneut versuchen|Réessayer)$/;
/** error.tsx's heading. */
const ERROR_TITLE = /^(Something went wrong|Etwas ist schiefgelaufen|Une erreur s'est produite)$/;

/*
  The service worker is blocked because it answers fetches before
  `page.route` sees them: it claims the page on first install and caches
  `_next/static`, so the stubbed 404 would silently be served from its cache
  instead and the test would pass or fail on cache state, not on the app.
*/
test.use({ serviceWorkers: "block" });

const isChunk = (url: string) => /\/_next\/static\/chunks\/[^?]+\.js(\?|$)/.test(url);

/**
 * Load Home, then make every chunk Home did not already have answer 404 until
 * the next full document load. Returns the Tasks link and live counters.
 */
async function homeOnTheOldBuild(page: Page) {
  const loaded = new Set<string>();
  const onRequest = (request: Request) => {
    if (isChunk(request.url())) loaded.add(new URL(request.url()).pathname);
  };
  page.on("request", onRequest);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const todosLink = page.locator('nav a[href="/todos"]:visible').first();
  await expect(todosLink).toBeVisible({ timeout: 20_000 });
  // The app replaces the URL with itself ~2 s after a load; WebKit fires it
  // late enough to collide with what the test does next. Let it happen.
  await page.waitForTimeout(3_000);
  page.off("request", onRequest);

  // A full document load after this point is the deploy landing.
  const counts = { documentLoads: 0, hits: 0 };
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) counts.documentLoads += 1;
  });
  await page.route((url) => isChunk(url.href), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (counts.documentLoads === 0 && !loaded.has(path)) {
      counts.hits += 1;
      await route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" });
      return;
    }
    await route.continue();
  });

  // Something that survives a client-side navigation but not a reload.
  await page.evaluate(() => {
    (window as unknown as { __beforeDeploy?: boolean }).__beforeDeploy = true;
  });
  return { todosLink, counts };
}

/**
 * Whether the window is a fresh one. Asked while the reload may still be in
 * flight, so a context torn down mid-question means "not yet", not a failure.
 */
const markerGone = (page: Page) =>
  page
    .evaluate(() => !(window as unknown as { __beforeDeploy?: boolean }).__beforeDeploy)
    .catch(() => false);

/** On the Tasks page, rendered, with no trace of the chunk error. */
async function expectTasksRendered(page: Page) {
  await expect(page).toHaveURL(/\/todos(\?|$)/);
  await expect(page.getByRole("button", { name: NEW_TASK }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Failed to load chunk/i)).toHaveCount(0);
  await expect(page.getByText(/ChunkLoadError/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: ERROR_TITLE })).toHaveCount(0);
}

test.describe("stale bundle after a deploy", () => {
  test.skip(!FAMILY_CODE, "needs a running production build");

  test("a missing route chunk reloads onto the new build instead of sticking on the error", async ({ page }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `Stale chunk ${testInfo.project.name}`);
    const { todosLink, counts } = await homeOnTheOldBuild(page);

    await todosLink.click();

    // The page reloaded itself: a fresh document, the marker gone...
    await expect.poll(() => counts.documentLoads, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(counts.hits).toBeGreaterThan(0);
    await page.waitForLoadState("domcontentloaded");
    await expect.poll(() => markerGone(page), { timeout: 20_000 }).toBe(true);

    // ...and it landed on the page that was asked for, rendered.
    await expectTasksRendered(page);
  });

  test("when a reload just happened, the error page's retry is still a full load", async ({ page }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `Stale chunk ${testInfo.project.name}`);
    const { todosLink, counts } = await homeOnTheOldBuild(page);
    // As if this tab had recovered a few seconds ago: the guard refuses a
    // second automatic reload, which is the "new build is broken" case.
    await page.evaluate(() => sessionStorage.setItem("kinboard-stale-bundle-recovered-at", String(Date.now())));

    await todosLink.click();

    await expect(page.getByRole("heading", { name: ERROR_TITLE })).toBeVisible({ timeout: 20_000 });
    expect(counts.hits).toBeGreaterThan(0);
    expect(counts.documentLoads).toBe(0);
    // A calm line, not the raw "Failed to load chunk /_next/…".
    await expect(page.getByText(/Failed to load chunk/i)).toHaveCount(0);

    // "Try again" reloads the document; reset() would ask the old bundle for
    // the same missing chunk and land right back here.
    await page.getByRole("button", { name: RETRY }).click();
    await expect.poll(() => counts.documentLoads, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForLoadState("domcontentloaded");
    await expect.poll(() => markerGone(page), { timeout: 20_000 }).toBe(true);
    await expectTasksRendered(page);
  });
});
