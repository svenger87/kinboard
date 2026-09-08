import type { Page } from "@playwright/test";

/**
 * Give a page a family session without going through the join screen.
 *
 * `joinFamilyViaUI` drives the real welcome flow, which is right for the smoke
 * suite — joining is one of the things smoke is there to check. It is wrong for
 * a layout guard: it makes a test about where a dialog is drawn depend on the
 * timing of a six-cell code input, and when that flow is slow the layout test
 * is what goes red. That is not hypothetical; it is why the WebKit dialog
 * ceiling check failed once in CI and once in six locally, both times inside a
 * `locator.click`, never in the measurement.
 *
 * So layout specs take a session directly: the same POST the join screen makes,
 * plus the client store cookie `AuthGuard` reads. Two things are needed because
 * the session cookie alone is not enough — the guard gates on the persisted
 * store, and a route with only the session cookie bounces back to the welcome
 * screen.
 */
/**
 * Cookies from the first join in this worker, replayed for every later test.
 *
 * Joining once per test does not scale: `/api/session/join` allows ten attempts
 * a minute per IP and per hardware id, and it is right to — it is the endpoint
 * that guards the family code. Forty tests in a run means forty joins and a
 * wall of 429s that reads like a broken app. Even a normal CI run is close to
 * the cap once the smoke suite's own joins are counted.
 *
 * So the session is established once and the cookies re-applied. Each test
 * still gets a clean context; it just does not re-authenticate to get one.
 *
 * Keyed by device name, not one shared slot: a spec that opens two contexts
 * to check a broadcast — one screen sends, the other must not be the one
 * that sent it — needs those contexts to be two different devices. A single
 * cache replayed regardless of the name asked for would hand both contexts
 * the first join's cookies, making them the same device, and the guard would
 * pass just as happily against a build that broadcast to everybody.
 */
const cachedCookiesByDevice = new Map<
  string,
  Parameters<ReturnType<Page["context"]>["addCookies"]>[0]
>();

export async function establishSession(
  page: Page,
  familyCode: string,
  deviceName: string,
): Promise<void> {
  const cachedCookies = cachedCookiesByDevice.get(deviceName);
  if (cachedCookies) {
    await page.context().addCookies(cachedCookies);
    return;
  }

  /*
    Land on /join, not /.

    Any page on the origin will do — this exists only so `fetch` and
    `document.cookie` have somewhere to run — but "/" is the one page that
    cannot be used: with no session yet, the app redirects to the welcome
    screen, and `page.goto` throws when its navigation is interrupted by
    another one. That is a race with itself, and it fails about half the time:

      page.goto: Navigation to "http://localhost:3000/" is interrupted by
      another navigation to "http://localhost:3000/join?next=%2F"

    /join is where an unauthenticated visitor is supposed to be, so it stays
    put.
  */
  await page.goto("/join", { waitUntil: "domcontentloaded" });

  const failure = await page.evaluate(
    async ({ code, name }) => {
      const res = await fetch("/api/session/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          joinCode: code,
          hardwareId: `e2e-${name}`,
          deviceName: name,
        }),
      });
      if (!res.ok) return `join failed: ${res.status} ${(await res.text()).slice(0, 200)}`;
      const data = await res.json();
      const state = { state: { family: data.family, device: data.device }, version: 0 };
      document.cookie =
        "family-calendar-storage=" +
        encodeURIComponent(JSON.stringify(state)) +
        "; path=/; max-age=86400";
      return null;
    },
    { code: familyCode, name: deviceName },
  );

  if (failure) throw new Error(`establishSession: ${failure}`);

  cachedCookiesByDevice.set(deviceName, await page.context().cookies());
}
