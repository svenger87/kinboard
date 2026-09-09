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
  const created = await page.evaluate(
    async ({ familyName, hardwareId }) => {
      const res = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyName, hardwareId, deviceName: familyName }),
      });
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
  if ("error" in created) throw new Error(`create family: ${created.error}`);
  return created.id;
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
