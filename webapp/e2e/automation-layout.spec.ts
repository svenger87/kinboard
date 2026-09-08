import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { establishSession } from "./session";

/**
 * The automation page, as a household sees it. RFC-007 §5.
 *
 * Three properties that only a rendered page can settle, because each one is
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
 *      most likely to ship broken because nobody developing this has it.
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

async function addRoom(page: Page, seeded: Seeded, name: string): Promise<string> {
  const familyId = await familyIdOn(page);
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
  seeded: Seeded,
  name: string,
  entityId: string,
  roomId: string | null,
): Promise<string> {
  const familyId = await familyIdOn(page);
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
 * them. Best-effort by design; a failed cleanup must not turn a passing guard
 * red, and the leftovers are named `probe-` for the sweep in the task notes.
 */
async function cleanUp(page: Page, seeded: Seeded): Promise<void> {
  const familyId = await familyIdOn(page).catch(() => null);
  if (!familyId) return;
  await page
    .evaluate(
      async ({ familyId, items, rooms }) => {
        for (const id of items) {
          await fetch(`/api/catalogue/${id}?family_id=${familyId}`, { method: "DELETE" });
        }
        for (const id of rooms) {
          await fetch(`/api/rooms/${id}?family_id=${familyId}`, { method: "DELETE" });
        }
      },
      { familyId, items: seeded.items, rooms: seeded.rooms },
    )
    .catch(() => {});
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
    try {
      const roomId = await addRoom(page, seeded, roomName);
      await addDevice(page, seeded, deviceName, `light.probe_${Date.now()}`, roomId);

      await page.reload({ waitUntil: "domcontentloaded" });

      // Both halves, and the device located *inside* the room's own section
      // rather than anywhere on the page: "the page mentions the lamp
      // somewhere" is exactly what a build that had lost the grouping would
      // also satisfy — it would render every device in one flat list.
      const room = groupNamed(page, roomName);
      await expect(room).toBeVisible({ timeout: 20_000 });
      await expect(room.getByText(deviceName, { exact: true })).toBeVisible();
    } finally {
      await cleanUp(page, seeded);
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
    try {
      // A room with something in it as well, so "last" is a claim about
      // ordering and not a page that only has one group on it.
      const roomId = await addRoom(page, seeded, roomName);
      await addDevice(page, seeded, roomedName, `light.probe_in_${Date.now()}`, roomId);
      await addDevice(page, seeded, looseName, `light.probe_loose_${Date.now()}`, null);

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
      await cleanUp(page, seeded);
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
      { familyName, hardwareId: `e2e-${familyName}` },
    );
    if ("error" in created) throw new Error(`create family: ${created.error}`);

    try {
      const roomId = await addRoom(page, seeded, roomName);
      await addDevice(page, seeded, deviceName, `light.probe_nc_${Date.now()}`, roomId);

      await page.goto("/home-automation", { waitUntil: "domcontentloaded" });
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
      await page
        .evaluate(
          async ({ familyId, familyName }) => {
            await fetch("/api/family", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ family_id: familyId, confirm_name: familyName }),
            });
          },
          { familyId: created.id, familyName },
        )
        .catch(() => {});
    }
  });
});
