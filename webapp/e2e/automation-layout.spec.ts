import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { establishSession } from "./session";

/**
 * The automation page, as a household sees it. RFC-007 §5.
 *
 * Four properties that only a rendered page can settle, because each one is
 * a decision the page makes about data the API happily returns either way:
 *
 *   1. a room's devices appear *under that room* — the grouping is done in
 *      `grouped`, not by the query, so a correct `/api/rooms` and a correct
 *      `/api/catalogue` prove nothing about where a lamp is drawn;
 *   2. a device with no room is still on the page, in the last group — the
 *      one shape the grouping can silently drop, and a device that vanishes
 *      because nobody gave it a room is a device somebody has lost;
 *   3. an install with no Home Assistant says so, over a page that still
 *      shows the house — the state every fresh install is in, and the one
 *      most likely to ship broken because nobody developing this has it;
 *   4. a tile that says it has no reading does not offer a control that
 *      pretends otherwise — the two halves of one tile disagreeing is not a
 *      shape any API response can be wrong about, only the rendering.
 *
 * Everything is seeded through the app's own API with names carrying the
 * project and a timestamp: both Playwright projects run against one family on
 * one database at the same time, so a fixed name would have the desktop and
 * WebKit runs writing over each other, and a bare `getByText("Kitchen")`
 * would pass on the other run's row.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

/** The family this session belongs to, read back out of the store cookie. */
function familyIdOn(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = decodeURIComponent(
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("family-calendar-storage="))!
        .split("=")[1],
    );
    return JSON.parse(raw).state.family.id as string;
  });
}

/** Everything this test made, so the `finally` can put the family back. */
type Seeded = { rooms: string[]; items: string[] };

async function addRoom(
  page: Page,
  familyId: string,
  seeded: Seeded,
  name: string,
): Promise<string> {
  const result = await page.evaluate(
    async ({ familyId, name }) => {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: familyId, name }),
      });
      if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
      return { id: ((await res.json()) as { room: { id: string } }).room.id };
    },
    { familyId, name },
  );
  if ("error" in result) throw new Error(`addRoom(${name}): ${result.error}`);
  seeded.rooms.push(result.id);
  return result.id;
}

/**
 * A catalogue device, in `roomId` or in no room at all.
 *
 * `kind: "ha_entity"` rather than `builtin` on purpose: it is the row shape
 * this page exists for, and it is the one that also puts the device into the
 * entity-state poll, so a tile that renders here is one that has been through
 * the whole path rather than a decorative row.
 */
async function addDevice(
  page: Page,
  familyId: string,
  seeded: Seeded,
  name: string,
  entityId: string,
  roomId: string | null,
): Promise<string> {
  const result = await page.evaluate(
    async ({ familyId, name, entityId, roomId }) => {
      const res = await fetch("/api/catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: familyId,
          kind: "ha_entity",
          entity_id: entityId,
          name,
          room_id: roomId,
        }),
      });
      if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
      return { id: ((await res.json()) as { item: { id: string } }).item.id };
    },
    { familyId, name, entityId, roomId },
  );
  if ("error" in result) throw new Error(`addDevice(${name}): ${result.error}`);
  seeded.items.push(result.id);
  return result.id;
}

/**
 * Take the seeded rows back out.
 *
 * Devices first: the FK is ON DELETE SET NULL, so deleting a room while its
 * devices are still there does not fail — it quietly leaves them behind in
 * the "No room" group, where the *next* run's unroomed assertion would find
 * them.
 *
 * `familyId` and the ids are passed in rather than re-read from the page,
 * because the case cleanup exists for is the case where the page is in
 * trouble. An earlier version derived the family id from the store cookie
 * here, gave up when that read failed, and swallowed every response — so a
 * test that failed by crashing its page left its rooms and catalogue items
 * behind, silently, for ever.
 *
 * Still swallowed, so a cleanup failure never masks the real one, but never
 * silent: whatever could not be deleted is named on stderr, with the ids, so
 * drift on a shared database is visible.
 */
async function cleanUp(page: Page, familyId: string, seeded: Seeded): Promise<void> {
  const left = () =>
    `family=${familyId} rooms=${seeded.rooms.join(",") || "-"} ` +
    `catalogue_items=${seeded.items.join(",") || "-"}`;
  try {
    const failures = await page.evaluate(
      async ({ familyId, items, rooms }) => {
        const failed: string[] = [];
        for (const id of items) {
          const res = await fetch(`/api/catalogue/${id}?family_id=${familyId}`, {
            method: "DELETE",
          });
          if (!res.ok) failed.push(`catalogue_items ${id}: HTTP ${res.status}`);
        }
        for (const id of rooms) {
          const res = await fetch(`/api/rooms/${id}?family_id=${familyId}`, { method: "DELETE" });
          if (!res.ok) failed.push(`rooms ${id}: HTTP ${res.status}`);
        }
        return failed;
      },
      { familyId, items: seeded.items, rooms: seeded.rooms },
    );
    if (failures.length > 0) {
      console.warn(`[automation-layout] cleanup left rows behind — ${failures.join("; ")}`);
    }
  } catch (error) {
    console.warn(
      `[automation-layout] cleanup could not run (${(error as Error).message}); left behind ${left()}`,
    );
  }
}

/**
 * A family of its own, with nothing configured on it.
 *
 * Two tests here need a household whose settings are known rather than
 * inherited: the "not connected" guard needs one with no Home Assistant at
 * all, and the reading guard needs one whose Home Assistant is exactly the
 * one it seeded. Neither family this suite could otherwise reach qualifies —
 * the CI demo family has a `home_assistant` row pointing at the mock
 * container and a developer's family has a real instance — and writing to
 * either would be a destructive edit to state every other spec on this
 * database shares.
 *
 * `POST /api/session/create` is the same call the welcome screen makes; the
 * cookies it leaves behind are the two `AuthGuard` gates on. Deleting the
 * family afterwards cascades its rooms, catalogue rows, settings and stored
 * secrets with it.
 *
 * The page must already be on the origin — `/join` — so `fetch` and
 * `document.cookie` have somewhere to run.
 */
async function createThrowawayFamily(page: Page, familyName: string): Promise<string> {
  /*
    The route limits family creation to 5 per minute per IP — "nobody
    legitimately creates families in a loop", says the comment there, and it is
    right about households. This file is the exception: every test that needs a
    known settings row makes its own, and once there were more than five of them
    the sixth started failing with a 429 that looked exactly like a broken
    seeding helper. So the limiter's own `Retry-After` is honoured rather than
    the limit relaxed — the rule is right and the test is the unusual caller.
  */
  for (let attempt = 0; ; attempt++) {
    const created: { id: string } | { error: string } | { retryAfterMs: number } =
      await page.evaluate(
      async ({ familyName, hardwareId }) => {
        const res = await fetch("/api/session/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ familyName, hardwareId, deviceName: familyName }),
        });
        if (res.status === 429) {
          return { retryAfterMs: (Number(res.headers.get("Retry-After")) || 10) * 1000 + 500 };
        }
        if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
        const data = await res.json();
        // The same two cookies a real join leaves behind: the session, set by
        // the route itself, and the client store `AuthGuard` gates on.
        const state = { state: { family: data.family, device: data.device }, version: 0 };
        document.cookie =
          "family-calendar-storage=" +
          encodeURIComponent(JSON.stringify(state)) +
          "; path=/; max-age=86400";
        return { id: data.family.id as string };
      },
      { familyName, hardwareId: `e2e-${familyName}` }
      );
    if ("id" in created) return created.id;
    if ("error" in created) throw new Error(`create family: ${created.error}`);
    if (attempt >= 2) throw new Error("create family: rate limited three times over");
    await page.waitForTimeout(created.retryAfterMs);
  }
}

/**
 * Take the throwaway family back out.
 *
 * Swallowed so it cannot mask a real failure, but never silent — a family
 * left behind here is a family left behind for ever.
 */
async function deleteThrowawayFamily(
  page: Page,
  familyId: string,
  familyName: string
): Promise<void> {
  try {
    const status = await page.evaluate(
      async ({ familyId, familyName }) => {
        const res = await fetch("/api/family", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ family_id: familyId, confirm_name: familyName }),
        });
        return res.status;
      },
      { familyId, familyName }
    );
    if (status !== 200) {
      console.warn(
        `[automation-layout] could not delete throwaway family ${familyId} ` +
          `(${familyName}): HTTP ${status}`
      );
    }
  } catch (error) {
    console.warn(
      `[automation-layout] could not delete throwaway family ${familyId} ` +
        `(${familyName}): ${(error as Error).message}`
    );
  }
}

/**
 * Leave `/join`, which does not stay put once a family exists.
 *
 * `AuthGuard` moves `/join` on as soon as the app notices a session — into
 * `/setup` for a family that has not finished onboarding, which a
 * freshly-created one has not. It notices at an unpredictable moment after
 * `POST /api/session/create`, and if that lands while a `page.goto` is in
 * flight the goto fails outright:
 *
 *   page.goto: Navigation to "http://localhost:3000/home-automation" is
 *   interrupted by another navigation to "http://localhost:3000/setup"
 *
 * — seen once in WebKit here, and nothing to do with what either test is
 * guarding. One retry settles it: by the second attempt the redirect has
 * already happened and the page is on a path nothing wants to move.
 */
async function gotoAfterJoin(page: Page, path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      const interrupted = (error as Error).message.includes(
        "interrupted by another navigation"
      );
      if (!interrupted || attempt >= 2) throw error;
    }
  }
}

/**
 * Give a family a Home Assistant, so the page believes one is configured.
 *
 * `isConnected` on the page is `!!settings?.url && !!settings?.access_token`
 * and nothing more — it means "somebody set this up", not "it is answering".
 * A real settings row is written rather than the settings request faked,
 * because faking it does not survive WebKit: it serves
 * `/api/settings?...&key=home_assistant` out of its own cache, which
 * Playwright's routing never sees.
 *
 * The URL is deliberately unreachable. Nothing should dial it — the entity
 * states are answered by `page.route` — and if anything ever does, `.invalid`
 * fails immediately instead of hanging the test for the connect timeout.
 * The token is stored in `integration_secrets` and comes back as a sentinel,
 * which is all `isConnected` needs.
 */
async function connectHomeAssistant(page: Page, familyId: string): Promise<void> {
  const failure = await page.evaluate(
    async ({ familyId }) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: familyId,
          key: "home_assistant",
          value: { url: "http://home-assistant.invalid:8123", access_token: "e2e-not-a-real-token" },
        }),
      });
      if (!res.ok) return `${res.status} ${(await res.text()).slice(0, 200)}`;
      return null;
    },
    { familyId }
  );
  if (failure) throw new Error(`connectHomeAssistant: ${failure}`);
}

/**
 * One device's card, inside the group it is drawn in.
 *
 * Scoped to the card rather than to the page because the claim being made is
 * about a single tile: that what it *says* and what it *offers* agree. A
 * page-wide `getByRole("button", { name: "Lock" })` would still pass if the
 * state line and the buttons belonged to different devices.
 *
 * The card is the nearest ancestor carrying `rounded-2xl` — the class every
 * `Card` has and nothing inside a tile does (the picture is `rounded-xl`).
 * Device names here are generated from `[a-z0-9-]`, so they need no quoting.
 */
function tileIn(group: Locator, deviceName: string): Locator {
  return group.locator(
    `xpath=.//p[normalize-space(.)="${deviceName}"]/ancestor::div[contains(@class,"rounded-2xl")][1]`
  );
}

/**
 * A session on the automation page, in English.
 *
 * The locale is pinned rather than left to the browser: `src/i18n/request.ts`
 * negotiates it from `Accept-Language`, so every string this file asserts —
 * "No room", "Not connected" — is only English by default, and a runner with
 * a German locale would fail the guard for a page that is perfectly correct.
 *
 * `domcontentloaded`, never `networkidle`: the app holds a realtime socket
 * open, so networkidle does not fire on any page of it.
 */
async function openAutomation(
  page: Page,
  baseURL: string | undefined,
  testInfo: TestInfo,
): Promise<void> {
  await establishSession(page, FAMILY_CODE, `Automation ${testInfo.project.name}`);
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" },
  ]);
  await page.goto("/home-automation", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Home automation" })).toBeVisible({
    timeout: 30_000,
  });
}

/** The room sections, in the order the page draws them. */
function groups(page: Page) {
  return page.locator("#main-content section");
}

/** The section headed `name` — a room's own name, or "No room". */
function groupNamed(page: Page, name: string) {
  return groups(page).filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) });
}

test.describe("the automation page, room by room", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE to reach the automation page");

  test("a room renders with the devices in it", async ({ page, baseURL }, testInfo) => {
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const roomName = `probe-room-${stamp}`;
    const deviceName = `probe-lamp-${stamp}`;
    const seeded: Seeded = { rooms: [], items: [] };

    await openAutomation(page, baseURL, testInfo);
    // Read once, while the page is certainly healthy: the `finally` must not
    // depend on being able to read anything back out of it.
    const familyId = await familyIdOn(page);
    try {
      const roomId = await addRoom(page, familyId, seeded, roomName);
      await addDevice(page, familyId, seeded, deviceName, `light.probe_${Date.now()}`, roomId);

      await page.reload({ waitUntil: "domcontentloaded" });

      // Both halves, and the device located *inside* the room's own section
      // rather than anywhere on the page: "the page mentions the lamp
      // somewhere" is exactly what a build that had lost the grouping would
      // also satisfy — it would render every device in one flat list.
      const room = groupNamed(page, roomName);
      await expect(room).toBeVisible({ timeout: 20_000 });
      await expect(room.getByText(deviceName, { exact: true })).toBeVisible();
    } finally {
      await cleanUp(page, familyId, seeded);
    }
  });

  test("a device with no room is still on the page, in the last group", async ({
    page,
    baseURL,
  }, testInfo) => {
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const roomName = `probe-room-${stamp}`;
    const roomedName = `probe-roomed-${stamp}`;
    const looseName = `probe-loose-${stamp}`;
    const seeded: Seeded = { rooms: [], items: [] };

    await openAutomation(page, baseURL, testInfo);
    const familyId = await familyIdOn(page);
    try {
      // A room with something in it as well, so "last" is a claim about
      // ordering and not a page that only has one group on it.
      const roomId = await addRoom(page, familyId, seeded, roomName);
      await addDevice(page, familyId, seeded, roomedName, `light.probe_in_${Date.now()}`, roomId);
      await addDevice(page, familyId, seeded, looseName, `light.probe_loose_${Date.now()}`, null);

      await page.reload({ waitUntil: "domcontentloaded" });

      await expect(groupNamed(page, roomName)).toBeVisible({ timeout: 20_000 });

      const unroomed = groupNamed(page, "No room");
      await expect(unroomed).toBeVisible();
      await expect(unroomed.getByText(looseName, { exact: true })).toBeVisible();
      // Last, not merely present: the unroomed group is the one that must
      // stay at the bottom of the house, under every real room.
      await expect(
        groups(page).last().getByRole("heading", { level: 2, name: "No room", exact: true }),
      ).toBeVisible();
    } finally {
      await cleanUp(page, familyId, seeded);
    }
  });

  test("it says Home Assistant is not connected, over a page that still shows the house", async ({
    page,
    baseURL,
  }, testInfo) => {
    /*
      A brand-new family, not the one the other two tests use.

      "Not configured" is a property of a household that has never connected
      Home Assistant, and neither family this suite could otherwise reach is
      one: the CI demo family is seeded with a `home_assistant` settings row
      pointing at the mock container, and a developer's family has a real
      instance in it. Clearing that row would be a destructive edit to state
      every other spec on this database shares.

      The obvious alternative — answer the settings request with `page.route`
      and let the rest of the family stand — was written first and does not
      survive WebKit. Instrumented, the first page load is intercepted and the
      `page.reload()` after seeding is not: WebKit serves
      `/api/settings?...&key=home_assistant` out of its own cache, which
      Playwright's routing never sees, so the page got the real settings back
      and the banner correctly did not appear. It passed anyway while this
      dev box happened to have no Home Assistant configured — a guard that
      only passed because the state it was faking was already true. With a row
      seeded to match CI it failed 4 runs out of 4, and only in WebKit.

      So the state is real rather than simulated: `POST /api/session/create` is
      the same call the welcome screen makes, and the family it returns has no
      settings of any kind. The `finally` deletes it, which cascades the room,
      the device and the catalogue row with it.
    */
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const familyName = `probe-family-${stamp}`;
    const roomName = `probe-room-${stamp}`;
    const deviceName = `probe-lamp-${stamp}`;
    const seeded: Seeded = { rooms: [], items: [] };

    await page.context().addCookies([
      { name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });

    const familyId = await createThrowawayFamily(page, familyName);

    try {
      const roomId = await addRoom(page, familyId, seeded, roomName);
      await addDevice(page, familyId, seeded, deviceName, `light.probe_nc_${Date.now()}`, roomId);

      await gotoAfterJoin(page, "/home-automation");
      await expect(page.getByRole("heading", { level: 1, name: "Home automation" })).toBeVisible({
        timeout: 30_000,
      });

      // It says so, in the banner that carries the live-region role — not in
      // an alert, which is the *other* state ("we could not read your
      // settings"), and not nowhere.
      const banner = page.getByRole("status").filter({ hasText: "Not connected" });
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await expect(banner).toContainText("Connect your Home Assistant instance in settings first.");

      // And it is a banner, not a takeover: the rooms and the names are ours,
      // they are still true, and a wall panel showing the house with the
      // states greyed out beats a page of nothing behind a settings button.
      // 20s rather than the 5s default: the settings answer that decides the
      // banner is one small row and lands first, with the rooms and catalogue
      // queries behind the house still in flight.
      await expect(groupNamed(page, roomName).getByText(deviceName, { exact: true })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      // Deleting the family cascades the room, the device and the catalogue
      // row with it.
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});

/*
  Service workers off for this group, because it fakes a network answer.

  The app registers a PWA service worker, and a page it controls fetches
  through it rather than down the wire — where `page.route` never sees the
  request. The engines disagree about *when* that starts: Chromium's fresh
  registration does not control the page until the next navigation, WebKit's
  does. So the same routed test intercepted everything in Chromium and nothing
  in WebKit — the counter below read 0, the real endpoint answered 500 for a
  Home Assistant at `.invalid`, and the page quite correctly said it was
  unreachable. That asymmetry is very likely what the note in the previous
  test is describing as WebKit's "own cache".

  Blocking registration costs this guard nothing: it is about what a tile
  offers, not about offline caching.
*/
test.describe("the automation page, control by control", () => {
  // Not because the test needs the code — it makes its own family — but
  // because FAMILY_CODE is how this suite knows there is a stack to talk to
  // at all. Unset means the source-reading CI job, where nothing is serving.
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block" });

  test("a control is live only where there is a reading behind it", async ({
    page,
    baseURL,
  }, testInfo) => {
    /*
      The state line and the control on one tile, checked against each other.

      `hasReading` (page.tsx) is the rule: `unavailable`, `unknown`, empty and
      "not in the poll at all" all mean Home Assistant is not telling us what
      this device is doing, and a control offered in that state is a trap. The
      service call still returns 200 — Home Assistant accepts a call for an
      entity it cannot reach — so nothing throws, nothing reverts, and the
      optimistic guess sits on the tile for its full settle. A wall panel
      reading "Locked" about a door whose lock has a dead battery is the exact
      lie this guards.

      The rule was always right; what shipped wrong was where it was applied.
      The toggle had it, the lock and cover pairs had only "Home Assistant is
      configured" — so a unit test of `hasReading` would have passed against
      the broken build. Only the rendered control settles it.

      Three devices, because one string is not a rule: `unavailable` on the
      lock and `unknown` on the cover, so a fix that special-cases one of them
      in one domain cannot pass. The light with a real `off` is the control
      case in both senses — it proves the disabling is not simply everything
      being dead, and it is the assertion that proves the stub was used at all
      (see the route below).

      Soft assertions for the three claims: they are independent readings of
      one page, and a regression in the lock tile should say so rather than
      hiding whether the light and cover still hold.
    */
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    // Entity ids are `[a-z0-9_.]` — the project name carries a hyphen, which
    // is not something Home Assistant would ever put in one.
    const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "")}_${Date.now()}`.toLowerCase();
    const familyName = `probe-family-${stamp}`;
    const roomName = `probe-room-${stamp}`;
    const lightName = `probe-light-${stamp}`;
    const lockName = `probe-lock-${stamp}`;
    const coverName = `probe-cover-${stamp}`;
    const lightEntity = `light.probe_reading_${suffix}`;
    const lockEntity = `lock.probe_unavailable_${suffix}`;
    const coverEntity = `cover.probe_unknown_${suffix}`;
    const seeded: Seeded = { rooms: [], items: [] };

    const stubbed = new Map(
      [
        [lightEntity, "off"],
        [lockEntity, "unavailable"],
        [coverEntity, "unknown"],
      ].map(([entityId, state]) => [
        entityId,
        {
          entity_id: entityId,
          domain: entityId.split(".")[0],
          name: entityId,
          state,
          attributes: {},
          last_changed: new Date().toISOString(),
        },
      ])
    );

    /*
      The states poll, answered here instead of by a Home Assistant.

      Only the entities actually asked for are returned, so the page gets the
      same shape a real answer has — and an entity it did not ask about cannot
      accidentally satisfy an assertion. `no-store` because this response is
      polled every POLL_MS and WebKit is willing to cache an API GET it was
      not told not to.

      `stateRequests` is counted so a route that silently never fires is
      distinguishable from one that fired and was ignored; the light reading
      "Off" is the other half of that proof, since nothing but this payload
      can produce it — the seeded Home Assistant URL is `.invalid`.
    */
    let stateRequests = 0;
    await page.route(/\/api\/homeassistant\/states/, async (route) => {
      stateRequests += 1;
      const asked =
        new URL(route.request().url()).searchParams.get("entity_ids")?.split(",") ?? [];
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({
          entities: asked.filter((id) => stubbed.has(id)).map((id) => stubbed.get(id)),
        }),
      });
    });

    await page.context().addCookies([
      { name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });

    const familyId = await createThrowawayFamily(page, familyName);

    try {
      // Off /join before seeding, and seeded from the page itself: an
      // `AuthGuard` redirect landing mid-`page.evaluate` destroys the
      // execution context the seeding `fetch` is running in. This is the
      // shape the first two tests use for the same reason.
      await gotoAfterJoin(page, "/home-automation");

      await connectHomeAssistant(page, familyId);
      const roomId = await addRoom(page, familyId, seeded, roomName);
      await addDevice(page, familyId, seeded, lightName, lightEntity, roomId);
      await addDevice(page, familyId, seeded, lockName, lockEntity, roomId);
      await addDevice(page, familyId, seeded, coverName, coverEntity, roomId);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1, name: "Home automation" })).toBeVisible({
        timeout: 30_000,
      });

      const room = groupNamed(page, roomName);
      const light = tileIn(room, lightName);
      const lock = tileIn(room, lockName);
      const cover = tileIn(room, coverName);

      // The stub is in use. "Off" is a word this page can only say about this
      // entity if it read this payload: the family's Home Assistant URL does
      // not resolve, so an un-intercepted poll fails and every tile falls back
      // to "Not reachable". Hard, not soft — every claim below is about a page
      // that got these states, so there is nothing to learn from them if it
      // did not.
      await expect(light.getByText("Off", { exact: true })).toBeVisible({ timeout: 20_000 });
      expect(stateRequests, "the states poll was never intercepted").toBeGreaterThan(0);

      // A reading, so the control is live.
      await expect.soft(light.getByRole("switch", { name: lightName })).toBeEnabled();

      // `unavailable`: the tile says so, and offers nothing to press. Both
      // halves, on the same tile — a page-wide "some Lock button is disabled"
      // would pass just as happily with the state line and the buttons
      // belonging to different devices.
      await expect.soft(lock.getByText("Not reachable", { exact: true })).toBeVisible();
      await expect.soft(lock.getByRole("button", { name: "Lock", exact: true })).toBeDisabled();
      await expect.soft(lock.getByRole("button", { name: "Unlock", exact: true })).toBeDisabled();

      // `unknown`, in a different domain: the same rule, not a special case
      // for one string.
      await expect.soft(cover.getByText("Not reachable", { exact: true })).toBeVisible();
      await expect.soft(cover.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
      await expect.soft(cover.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
   The detail sheet, opened from a real tile — RFC-008.

   These are the guards the earlier steps of this branch could not commit.
   Every one of them was written, run and proved red against a scratch route
   that mounted `EntityDetailSheet` directly, and every one of them was then
   deleted with the route, because nothing in the app rendered the sheet: the
   automation page had a thin sheet of its own, reachable from three domains.
   Now that a tile opens the real one, they land here.

   Here rather than in `entity-detail-fallback.spec.ts` because they need a
   rendered, authenticated page with rooms and devices behind it, and this file
   already has all of that — the throwaway family, the seeding helpers, the
   stubbed Home Assistant and the cleanup. The fallback spec reads source and
   message files and needs no stack; giving it a second copy of this machinery
   to host four tests would be the more expensive half of the choice. It is
   also the half CI runs: this file is in both the desktop and the WebKit lists
   of `.github/workflows/e2e.yml`, so these run on every push, on two engines.

   What each one is for, and why the obvious cheaper version of it is worse:

   1. **A real pointer drag commits.** A fully-controlled Radix slider with no
      `onValueChange` never fires `onValueCommit` — `handleSlideEnd` compares
      the value against the one captured at slide start and both reads come
      from the same unchanged prop. The keyboard path still works, so
      `slider.press("ArrowRight")` passes against completely inert drag: a
      keyboard assertion here would have *certified* the bug. So: a pointer.
   2. **A refused call puts the thumb back on the reading.** With the poll
      stubbed to keep returning the old brightness, "wait for the source to
      move" can never fire — the lamp never moved. Without the failure exit the
      slider sits on a number nobody achieved for as long as the panel is on.
   3. **A 200 that does nothing settles.** The same defect through the success
      branch: Home Assistant accepts the call for a bulb out of radio range and
      returns 200, the reading never moves, and only the settle can clear it.
   4. **A dangerous action asks first**, and a harmless one does not.

   `serviceWorkers: "block"` and counted interceptions throughout, for the
   reason the group above gives: the PWA service worker answers `page.route`-ed
   fetches before Playwright sees them, and the engines disagree about when it
   starts controlling the page.
   ──────────────────────────────────────────────────────────────────────── */

/** A Home Assistant entity in the shape `/api/homeassistant/states` returns. */
type StubEntity = {
  entity_id: string;
  domain: string;
  name: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
};

function stubEntity(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): StubEntity {
  return {
    entity_id: entityId,
    domain: entityId.split(".")[0],
    name: entityId,
    state,
    attributes,
    last_changed: new Date(Date.now() - 3_600_000).toISOString(),
  };
}

/** What the stubbed house hands back to the test that asked for it. */
type StubbedHouse = {
  familyId: string;
  familyName: string;
  roomName: string;
  roomId: string;
  seeded: Seeded;
  /** Mutable: a test may change a reading and let the next poll deliver it. */
  states: Map<string, StubEntity>;
  /** Every `POST /api/homeassistant/services` body, in order. */
  serviceCalls: Record<string, unknown>[];
  /** How many state polls were actually intercepted. */
  stateRequests: () => number;
};

/**
 * A household of its own, with a Home Assistant answered from this file.
 *
 * The same shape as the reading-gate test above and for the same reasons: a
 * real family created through `POST /api/session/create` rather than a faked
 * settings response (WebKit serves `/api/settings` from its own cache, which
 * `page.route` never sees), a Home Assistant URL at `.invalid` so nothing can
 * quietly reach a real instance, and every seeded row deleted by the caller's
 * `finally`.
 *
 * `serviceStatus` is what `POST /api/homeassistant/services` answers. 200 is
 * "Home Assistant accepted it" — which says nothing about the device having
 * done anything, and that gap is the whole subject of test 3.
 */
async function stubbedHouse(
  page: Page,
  baseURL: string | undefined,
  testInfo: TestInfo,
  devices: { label: string; entity: StubEntity }[],
  options: { serviceStatus?: number; history?: { timestamp: string; state: number }[] } = {},
): Promise<StubbedHouse> {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const familyName = `probe-family-${stamp}`;
  const roomName = `probe-room-${stamp}`;
  const seeded: Seeded = { rooms: [], items: [] };
  const states = new Map(devices.map(({ entity }) => [entity.entity_id, entity]));
  const serviceCalls: Record<string, unknown>[] = [];
  let stateRequests = 0;

  await page.route(/\/api\/homeassistant\/states/, async (route) => {
    stateRequests += 1;
    const asked = new URL(route.request().url()).searchParams.get("entity_ids")?.split(",") ?? [];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({
        entities: asked.filter((id) => states.has(id)).map((id) => states.get(id)),
      }),
    });
  });

  await page.route(/\/api\/homeassistant\/history/, async (route) => {
    const asked = new URL(route.request().url()).searchParams.get("entity_ids") ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({
        histories: [{ entity_id: asked, history: options.history ?? [] }],
      }),
    });
  });

  await page.route(/\/api\/homeassistant\/services/, async (route) => {
    serviceCalls.push(JSON.parse(route.request().postData() ?? "{}"));
    const status = options.serviceStatus ?? 200;
    await route.fulfill({
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify(
        status >= 400 ? { error: "the stub refused it" } : { success: true, affected_entities: [] },
      ),
    });
  });

  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" },
  ]);
  await page.goto("/join", { waitUntil: "domcontentloaded" });

  const familyId = await createThrowawayFamily(page, familyName);
  // Off /join before seeding: an `AuthGuard` redirect landing mid-evaluate
  // destroys the execution context the seeding `fetch` runs in.
  await gotoAfterJoin(page, "/home-automation");
  await connectHomeAssistant(page, familyId);

  const roomId = await addRoom(page, familyId, seeded, roomName);
  for (const { label, entity } of devices) {
    await addDevice(page, familyId, seeded, label, entity.entity_id, roomId);
  }

  await reloadUntilRendered(page);

  return {
    familyId, familyName, roomName, roomId, seeded, states, serviceCalls,
    stateRequests: () => stateRequests,
  };
}

/**
 * Reload, and insist the app actually rendered.
 *
 * Once, on WebKit with both browser projects running in parallel on this box,
 * the reloaded document came back as the raw gzip stream: the page snapshot was
 * compressed bytes rendered as text, with no app on it at all. Application code
 * cannot make a browser paint gzip bytes as text — that needs `Content-Encoding`
 * to be mishandled below the app, and `serviceWorkers: "block"` rules out the
 * one product-side candidate — so it is a harness artefact, and a fresh
 * navigation clears it. Retried rather than waited out, because there is nothing
 * to wait for: the document that arrived is never going to become HTML.
 *
 * **Retried only on that condition.** A blanket retry on "the heading did not
 * appear" would paper over a product bug that broke the first render one time in
 * three, and do it with CI green. A Next.js document always carries its own
 * `/_next/` bundle tags; a gzip stream painted as text carries no `<script>` at
 * all. So if the document is ours, the failure is ours, and it is rethrown on
 * the first attempt.
 */
async function reloadUntilRendered(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { level: 1, name: "Home automation" });
  for (let attempt = 0; ; attempt++) {
    await page.reload({ waitUntil: "domcontentloaded" });
    try {
      await expect(heading).toBeVisible({ timeout: 30_000 });
      return;
    } catch (error) {
      const ourDocument = await page
        .evaluate(() => document.querySelector('script[src*="/_next/"]') !== null)
        .catch(() => true);
      if (ourDocument || attempt >= 2) throw error;
      console.warn(
        "[automation-layout] the reloaded document was not HTML; navigating again",
      );
    }
  }
}

/**
 * One device's card, found without a role query.
 *
 * `tileIn` scopes through `getByRole("heading", …)` to name the room, and role
 * queries respect `aria-hidden` — which Radix stamps on everything outside an
 * open dialog. So while a confirmation is on screen `tileIn` resolves to
 * nothing, and an assertion about what the tile says *at that moment* fails with
 * "element(s) not found" about a tile that is on screen and correct. Device
 * names carry the project and a timestamp, so page-wide scoping is unambiguous.
 */
function tileAnywhere(page: Page, deviceName: string): Locator {
  return page.locator(
    `xpath=//p[normalize-space(.)="${deviceName}"]/ancestor::div[contains(@class,"rounded-2xl")][1]`,
  );
}

/** Open one tile's detail sheet and return the dialog. */
async function openSheet(page: Page, group: Locator, deviceName: string): Promise<Locator> {
  await tileIn(group, deviceName).getByRole("button", { name: deviceName, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  return sheet;
}

/**
 * Drag a slider's thumb to the far end with a real pointer.
 *
 * Past the right edge on purpose: Radix maps the pointer's x across the track,
 * so a drag to an interior point lands on a value that depends on the engine's
 * sub-pixel layout. Dragging beyond the end clamps to `max`, which is the same
 * number in every engine — and a clamped drag is still a drag.
 *
 * The geometry comes from the slider *root*, not from the thumb's parent: Radix
 * wraps the thumb in a positioning span of the thumb's own width, so measuring
 * that gives a "track" 16px wide and a drag across it moves the value by one
 * step. That mistake reads exactly like a slider that barely responds, which is
 * the bug this guard is for — so the width is asserted rather than assumed.
 */
async function dragToMax(page: Page, sheet: Locator): Promise<void> {
  // Root before Track before Thumb in document order; all three carry
  // `data-orientation`.
  const root = sheet.locator('span[data-orientation="horizontal"]').first();
  const thumb = sheet.getByRole("slider");
  const rootBox = (await root.boundingBox())!;
  const thumbBox = (await thumb.boundingBox())!;
  expect(rootBox.width, "measured the thumb wrapper instead of the track").toBeGreaterThan(
    thumbBox.width * 4,
  );

  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
  await page.mouse.down();
  // More than one move: a single jump can be delivered as a click by some
  // engines, and a click is not the gesture this is about.
  for (const fraction of [0.4, 0.7, 1.2]) {
    await page.mouse.move(
      rootBox.x + rootBox.width * fraction,
      thumbBox.y + thumbBox.height / 2,
      { steps: 6 },
    );
  }
  await page.mouse.up();
}

test.describe("the detail sheet a tile opens", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block" });
  /*
    Twice the file default of 60s, for two reasons that both bite hardest when
    the engines run side by side. The settle is one poll interval plus headroom
    by design, so watching a pending value expire costs 20s of real time and
    nothing can shorten it without making the product worse. And every test here
    creates a household of its own, which `POST /api/session/create` rate-limits
    to five a minute per IP — waiting that out is correct behaviour and must not
    read as a hung test. Measured worst case on this box under both projects:
    52.7s.
  */
  test.describe.configure({ timeout: 120_000 });

  test("every tile with an entity behind it opens the rich sheet; one without opens nothing", async ({
    page,
    baseURL,
  }, testInfo) => {
    /*
      The regression this whole branch is about. Before RFC-007 every tile
      opened the rich sheet; after it, only `media_player`, `climate` and
      `vacuum` were tappable and they opened a thin one that dumped
      `Object.entries(attributes)` raw. A light was not tappable at all.

      Four things are asserted about one lamp, because the sheet is only worth
      opening if all four arrive: the household's own name for it (from the
      catalogue, not from Home Assistant), its history drawn as a chart, its
      attributes under their translated labels, and a domain control that only
      the rich sheet has ever had. And one thing about the bicycle: a catalogue
      row with no `entity_id` is not a smart device, so it keeps its name and
      opens nothing.
    */
    const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "")}_${Date.now()}`.toLowerCase();
    const lampEntity = `light.probe_sheet_${suffix}`;
    const lampName = `probe-lamp-${Date.now()}`;
    const bikeName = `probe-bike-${Date.now()}`;
    const sceneEntity = `scene.probe_movie_${suffix}`;
    const sceneName = `probe-scene-${Date.now()}`;
    const day = Array.from({ length: 12 }, (_, i) => ({
      timestamp: new Date(Date.now() - (12 - i) * 3_600_000).toISOString(),
      state: i % 2,
    }));

    const house = await stubbedHouse(
      page,
      baseURL,
      testInfo,
      [
        {
          label: lampName,
          entity: stubEntity(lampEntity, "on", {
            friendly_name: "Reading lamp",
            supported_color_modes: ["brightness"],
            brightness: 51,
          }),
        },
        /*
          RFC-008 R1. A scene's state is the timestamp it was last activated and
          Home Assistant does not restore it, so after every restart this is what
          every scene in the house looks like. It is not unreachable; nobody has
          run it yet.
        */
        { label: sceneName, entity: stubEntity(sceneEntity, "unknown") },
      ],
      { history: day },
    );

    try {
      // A row that is not a smart device at all, added after the house so the
      // helper's device loop stays about entities.
      const bike = await page.evaluate(
        async ({ familyId, name, roomId }) => {
          const res = await fetch("/api/catalogue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              family_id: familyId,
              kind: "builtin",
              builtin_key: "bike",
              name,
              room_id: roomId,
            }),
          });
          if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
          return { id: ((await res.json()) as { item: { id: string } }).item.id };
        },
        { familyId: house.familyId, name: bikeName, roomId: house.roomId },
      );
      if ("error" in bike) throw new Error(`addBuiltin: ${bike.error}`);
      house.seeded.items.push(bike.id);

      await reloadUntilRendered(page);
      const room = groupNamed(page, house.roomName);
      await expect(room).toBeVisible({ timeout: 20_000 });

      // The stub is in use — the seeded Home Assistant URL does not resolve,
      // so "On" is a word this page can only say from this payload.
      await expect(tileIn(room, lampName).getByText("On", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      expect(house.stateRequests(), "the states poll was never intercepted").toBeGreaterThan(0);

      // The lamp keeps its inline switch. The sheet is what a tap on the tile
      // itself opens — the two are not alternatives.
      await expect(tileIn(room, lampName).getByRole("switch", { name: lampName })).toBeEnabled();

      // The bicycle is a name and a picture, and nothing to press.
      await expect(tileIn(room, bikeName).getByText(bikeName, { exact: true })).toBeVisible();
      await expect(
        tileIn(room, bikeName).getByRole("button", { name: bikeName, exact: true }),
      ).toHaveCount(0);

      /*
        The tile and the sheet must say the same thing about the same scene.
        They did not: the tile called it "Not reachable" and the sheet, one tap
        away, "Not activated yet".
      */
      const scene = tileIn(room, sceneName);
      await expect(scene.getByText("Not activated yet", { exact: true })).toBeVisible();
      await expect(scene.getByText("Not reachable", { exact: true })).toHaveCount(0);
      const sceneSheet = await openSheet(page, room, sceneName);
      await expect(sceneSheet.getByText("Not activated yet", { exact: true })).toBeVisible();
      // And the control is live, which is the whole point of the exception.
      await expect(sceneSheet.getByRole("button", { name: "Activate", exact: true })).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(sceneSheet).toBeHidden();

      const sheet = await openSheet(page, room, lampName);

      // Headed with the household's name for it, not Home Assistant's.
      await expect(sheet.getByRole("heading", { name: lampName })).toBeVisible();
      await expect(sheet.getByText(lampEntity, { exact: true })).toBeVisible();
      await expect(sheet.getByText("Current state")).toBeVisible();

      // A real per-domain control, which the thin sheet never had for a light.
      await expect(sheet.getByRole("button", { name: "Turn off", exact: true })).toBeVisible();
      await expect(sheet.getByText("Brightness", { exact: true }).first()).toBeVisible();
      await expect(sheet.getByRole("slider")).toHaveAttribute("aria-valuenow", "20");

      // History as a chart, not as a "no data" apology.
      await expect(sheet.getByRole("heading", { name: "History (24h)" })).toBeVisible();
      await expect(sheet.locator(".recharts-wrapper")).toBeVisible({ timeout: 10_000 });

      // Attributes under translated labels rather than raw keys, and without
      // the plumbing the thin sheet printed.
      await expect(sheet.getByRole("heading", { name: "Attributes" })).toBeVisible();
      await expect(sheet.getByText("friendly_name")).toHaveCount(0);
    } finally {
      await deleteThrowawayFamily(page, house.familyId, house.familyName);
    }
  });

  test("a real pointer drag on a slider sends the value it was dragged to", async ({
    page,
    baseURL,
  }, testInfo) => {
    /*
      Deliberately a pointer and not a keyboard. `onValueCommit` on a
      fully-controlled Radix slider with no `onValueChange` fires for
      `ArrowRight` and never for a thumb, so a keyboard assertion here would
      pass against a slider that is inert to every household that has ever
      touched one.
    */
    const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "")}_${Date.now()}`.toLowerCase();
    const lampEntity = `light.probe_drag_${suffix}`;
    const lampName = `probe-lamp-${Date.now()}`;

    const house = await stubbedHouse(page, baseURL, testInfo, [
      {
        label: lampName,
        entity: stubEntity(lampEntity, "on", {
          supported_color_modes: ["brightness"],
          brightness: 51,
        }),
      },
    ]);

    try {
      const room = groupNamed(page, house.roomName);
      await expect(tileIn(room, lampName).getByText("On", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      const sheet = await openSheet(page, room, lampName);

      const thumb = sheet.getByRole("slider");
      await expect(thumb).toHaveAttribute("aria-valuenow", "20");

      await dragToMax(page, sheet);

      // The thumb moved and stayed where it was dropped.
      await expect(thumb).toHaveAttribute("aria-valuenow", "100");
      await expect(sheet.getByText("100%", { exact: true })).toBeVisible();

      // And it sent exactly one call, carrying the value it was dragged to.
      // `brightness` rather than a percentage because that is what
      // `light.turn_on` takes: 100% of 255.
      await expect
        .poll(() => house.serviceCalls.length, { timeout: 10_000, message: "service calls" })
        .toBe(1);
      expect(house.serviceCalls[0]).toMatchObject({
        domain: "light",
        service: "turn_on",
        entity_id: lampEntity,
        service_data: { brightness: 255 },
      });
    } finally {
      await deleteThrowawayFamily(page, house.familyId, house.familyName);
    }
  });

  test("a refused call puts the thumb back on the reading", async ({
    page,
    baseURL,
  }, testInfo) => {
    /*
      The poll keeps returning the reading the lamp actually has, which is what
      a refused call leaves behind: nothing moved, so "clear the guess when the
      source changes" can never fire. The revert must therefore come from the
      failure itself — and quickly. The 6s window below is a third of
      OPTIMISTIC_SETTLE_MS, so a build that only cleared on the settle cannot
      satisfy it.
    */
    const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "")}_${Date.now()}`.toLowerCase();
    const lampEntity = `light.probe_refused_${suffix}`;
    const lampName = `probe-lamp-${Date.now()}`;

    const house = await stubbedHouse(
      page,
      baseURL,
      testInfo,
      [
        {
          label: lampName,
          entity: stubEntity(lampEntity, "on", {
            supported_color_modes: ["brightness"],
            brightness: 51,
          }),
        },
      ],
      { serviceStatus: 502 },
    );

    try {
      const room = groupNamed(page, house.roomName);
      await expect(tileIn(room, lampName).getByText("On", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      const sheet = await openSheet(page, room, lampName);
      const thumb = sheet.getByRole("slider");
      await expect(thumb).toHaveAttribute("aria-valuenow", "20");

      await dragToMax(page, sheet);
      await expect
        .poll(() => house.serviceCalls.length, { timeout: 10_000, message: "service calls" })
        .toBe(1);

      // The household is told, rather than the thumb silently moving back.
      await expect(page.getByText("That did not go through")).toBeVisible({ timeout: 10_000 });
      // And the reading — the truth as far as we know it — is what is on screen.
      await expect(thumb).toHaveAttribute("aria-valuenow", "20", { timeout: 6_000 });
      await expect(sheet.getByText("20%", { exact: true })).toBeVisible();
      // Nothing was retried behind the toast.
      expect(house.serviceCalls.length).toBe(1);
    } finally {
      await deleteThrowawayFamily(page, house.familyId, house.familyName);
    }
  });

  test("a 200 that does nothing does not strand the thumb", async ({
    page,
    baseURL,
  }, testInfo) => {
    /*
      The Zigbee bulb out of radio range. Home Assistant accepts the call and
      returns 200 — so the call resolves *true* and the failure exit never runs
      — and the bulb never lights, so every poll returns the same brightness
      and the source never moves either. Only the settle can clear it, and a
      surface with two exits instead of three reads 100% for a lamp at 20% for
      as long as the panel is on.

      Slow on purpose: the settle is one poll plus headroom, and a shorter one
      would snap a merely-slow device back before the truth could arrive.
    */
    const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "")}_${Date.now()}`.toLowerCase();
    const lampEntity = `light.probe_settle_${suffix}`;
    const lampName = `probe-lamp-${Date.now()}`;

    const house = await stubbedHouse(page, baseURL, testInfo, [
      {
        label: lampName,
        entity: stubEntity(lampEntity, "on", {
          supported_color_modes: ["brightness"],
          brightness: 51,
        }),
      },
    ]);

    try {
      const room = groupNamed(page, house.roomName);
      await expect(tileIn(room, lampName).getByText("On", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      const sheet = await openSheet(page, room, lampName);
      const thumb = sheet.getByRole("slider");
      await expect(thumb).toHaveAttribute("aria-valuenow", "20");

      const pollsBefore = house.stateRequests();
      await dragToMax(page, sheet);
      await expect
        .poll(() => house.serviceCalls.length, { timeout: 10_000, message: "service calls" })
        .toBe(1);

      // Held first: a merely-slow device must still be able to reconcile
      // normally, so the value is not dropped the moment the call returns.
      await expect(thumb).toHaveAttribute("aria-valuenow", "100");
      const draggedAt = Date.now();

      /*
        Still holding most of the way through the first settle — a settle
        shorter than a poll would snap every merely-slow device back before the
        truth could arrive.
      */
      await page.waitForTimeout(12_000);
      await expect(thumb).toHaveAttribute("aria-valuenow", "100");

      /*
        Now nudge it, and the settle must start again from here.

        Deliberately the keyboard for *this* step: the claim is about the timer,
        not about the gesture, and the drag above has already settled that a
        pointer commits. What it is guarding is a household that keeps adjusting
        — without a re-arm, the timer armed at the first release fires on
        schedule and snaps the thumb back under their finger, twelve seconds
        into a fresh adjustment they made eight seconds ago.
      */
      await thumb.press("ArrowLeft");
      await expect(thumb).toHaveAttribute("aria-valuenow", "95");
      await expect
        .poll(() => house.serviceCalls.length, { timeout: 10_000, message: "service calls" })
        .toBe(2);

      // Past the moment the *first* settle would have fired, and still holding
      // what the second gesture asked for.
      await page.waitForTimeout(Math.max(0, draggedAt + 25_000 - Date.now()));
      await expect(thumb).toHaveAttribute("aria-valuenow", "95");

      // Then let go of, without the reading ever having moved.
      await expect(thumb).toHaveAttribute("aria-valuenow", "20", { timeout: 40_000 });
      await expect(sheet.getByText("20%", { exact: true })).toBeVisible();
      // The poll really did keep answering, with the unchanged reading — so
      // "it went back" is the settle and not a lost connection.
      expect(house.stateRequests()).toBeGreaterThan(pollsBefore);
      expect(house.states.get(lampEntity)!.attributes.brightness).toBe(51);
      // The drag and the nudge, and nothing else.
      expect(house.serviceCalls.length).toBe(2);
    } finally {
      await deleteThrowawayFamily(page, house.familyId, house.familyName);
    }
  });

  test("the tile's Unlock asks too, and its guess does not outlive the truth", async ({
    page,
    baseURL,
  }, testInfo) => {
    /*
      Two claims about the same tile, because they are the same mistake seen
      twice: the room screen behaving as though the detail sheet were the only
      surface that drives anything.

      **It asks.** §6 chose seven confirmations and the sheet's Unlock has one.
      The tile's Unlock is the same service one layer out and half an inch to the
      left, and it called `lock.unlock` straight through — so a child on the wall
      panel opened the front door on one tap while the identical action inside
      asked first. A confirmation that only guards the longer route is not one.

      **Its guess ends when the truth moves.** A tile flips optimistically and
      waits for the poll to agree. "Agree" was equality with the guess, which
      cannot see a device that moved and came back inside one poll interval —
      unlock from the tile, lock again from the sheet, and Home Assistant reports
      `locked` exactly as it did before. The tile then reads "Unlocked" about a
      shut door until the settle expires. The stub below reproduces that by
      moving `last_changed` while leaving the state alone, which is precisely
      what a device that went away and came back looks like on the wire.
    */
    const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "")}_${Date.now()}`.toLowerCase();
    const lockEntity = `lock.probe_tile_${suffix}`;
    const lockName = `probe-lock-${Date.now()}`;

    const house = await stubbedHouse(page, baseURL, testInfo, [
      { label: lockName, entity: stubEntity(lockEntity, "locked") },
    ]);

    try {
      const tile = tileAnywhere(page, lockName);
      await expect(tile.getByText("Locked", { exact: true })).toBeVisible({ timeout: 20_000 });

      // The tile's own Unlock, not the sheet's — the sheet is not open.
      await tile.getByRole("button", { name: "Unlock", exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(`Unlock ${lockName}?`)).toBeVisible();

      /*
        And the tile has not answered the question on the household's behalf.

        The optimistic flip happens the moment a control is tapped, which for a
        confirmed action put "Unlocked" on the tile under a dialog still asking
        whether to unlock — a wall panel stating an outcome nobody has agreed to,
        for as long as somebody stands there thinking about it. Caught in a
        screenshot of this exact moment.
      */
      await expect(tile.getByText("Locked", { exact: true })).toBeVisible();
      await expect(tile.getByText("Unlocked", { exact: true })).toHaveCount(0);

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await page.waitForTimeout(1_000);
      expect(house.serviceCalls, "the tile sent something on dismissal").toEqual([]);
      // And the tile did not flip to a state nobody agreed to.
      await expect(tile.getByText("Locked", { exact: true })).toBeVisible();

      /*
        Ask again and answer it — but first make the next reading the one the
        equality rule cannot see: the same state it already had, with the
        timestamp moved. `useCallService` invalidates the states query on
        success, so that reading arrives seconds after the confirm rather than
        at the next poll, and well inside the settle.
      */
      await tile.getByRole("button", { name: "Unlock", exact: true }).click();
      await expect(dialog).toBeVisible();
      house.states.set(lockEntity, {
        ...house.states.get(lockEntity)!,
        last_changed: new Date().toISOString(),
      });
      await dialog.getByRole("button", { name: "Unlock", exact: true }).click();

      await expect
        .poll(() => house.serviceCalls.length, { timeout: 10_000, message: "service calls" })
        .toBe(1);
      expect(house.serviceCalls[0]).toMatchObject({
        domain: "lock",
        service: "unlock",
        entity_id: lockEntity,
      });

      /*
        Ten seconds is under the settle and under a poll interval, so nothing but
        the reconciliation can put "Locked" back on this tile.
      */
      await expect(tile.getByText("Locked", { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(tile.getByText("Unlocked", { exact: true })).toHaveCount(0);
    } finally {
      await deleteThrowawayFamily(page, house.familyId, house.familyName);
    }
  });

  test("unlocking asks first and locking does not", async ({ page, baseURL }, testInfo) => {
    /*
      RFC-008 §6. The two buttons sit side by side and are written identically;
      the only difference is the service each declares, which is exactly the
      property being demonstrated. Dismissal must send *nothing* — not "send it
      and undo", which for a front door is not a thing that exists.
    */
    const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "")}_${Date.now()}`.toLowerCase();
    const lockEntity = `lock.probe_door_${suffix}`;
    const lockName = `probe-lock-${Date.now()}`;

    const house = await stubbedHouse(page, baseURL, testInfo, [
      { label: lockName, entity: stubEntity(lockEntity, "locked") },
    ]);

    try {
      const room = groupNamed(page, house.roomName);
      await expect(tileIn(room, lockName).getByText("Locked", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      const sheet = await openSheet(page, room, lockName);

      await sheet.getByRole("button", { name: "Unlock", exact: true }).click();

      // It asks, and it names the door in the household's own words for it.
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(`Unlock ${lockName}?`)).toBeVisible();

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      // A late fire would still be a door opening, so wait before believing it.
      await page.waitForTimeout(1_000);
      expect(house.serviceCalls, "dismissal sent something").toEqual([]);

      // Ask again, and answer it this time.
      await sheet.getByRole("button", { name: "Unlock", exact: true }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
      await expect
        .poll(() => house.serviceCalls.length, { timeout: 10_000, message: "service calls" })
        .toBe(1);
      expect(house.serviceCalls[0]).toMatchObject({
        domain: "lock",
        service: "unlock",
        entity_id: lockEntity,
      });

      // Locking is one tap. Confirming your way to a locked door every time is
      // friction with no safety behind it, and §6 says so.
      await sheet.getByRole("button", { name: "Lock", exact: true }).click();
      await expect
        .poll(() => house.serviceCalls.length, { timeout: 10_000, message: "service calls" })
        .toBe(2);
      expect(house.serviceCalls[1]).toMatchObject({
        domain: "lock",
        service: "lock",
        entity_id: lockEntity,
      });
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
    } finally {
      await deleteThrowawayFamily(page, house.familyId, house.familyName);
    }
  });
});
