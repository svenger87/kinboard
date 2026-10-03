import { expect, test, type Page, type Route } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { DB_CONTAINER } from "./whole-database";

/**
 * The doorbell field in Settings → Cameras: the Home Assistant entity whose
 * ring the Kinboard integration turns into `show_camera` for this camera.
 *
 * The dialog tests serve the camera list, the Home Assistant connection and
 * its entities to the page, and catch the save instead of letting it through,
 * so they touch no family's data. The last test is the server half: a real
 * save through /api/settings, read back, with the doubled and malformed bells
 * refused — it restores the family's cameras setting afterwards. The only
 * other row created is the join device, deleted afterwards.
 * Needs FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");

// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block" });

const DEVICE = (project: string) => `claude-camera-doorbell-${project}`;

test.afterAll(({}, testInfo) => {
  if (!DB_CONTAINER) return;
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c",
      `DELETE FROM devices WHERE hardware_id = 'e2e-${DEVICE(testInfo.project.name)}'`],
    { encoding: "utf8" },
  );
});

const CAMERAS = [
  {
    id: "cam-e2e-door",
    name: "E2E front door",
    stream_type: "mjpeg",
    stream_url: "http://127.0.0.1:9/never",
    enabled: true,
    position: 0,
    created_at: "2026-10-01T00:00:00.000Z",
    doorbell_entity_id: "binary_sensor.front_door_ding",
  },
  {
    id: "cam-e2e-garden",
    name: "E2E garden",
    stream_type: "mjpeg",
    stream_url: "http://127.0.0.1:9/never",
    enabled: true,
    position: 1,
    created_at: "2026-10-01T00:00:00.000Z",
  },
];

const entity = (entity_id: string, name: string) => ({
  entity_id,
  domain: entity_id.split(".")[0],
  name,
  state: "off",
  attributes: { friendly_name: name },
  last_changed: "2026-10-01T00:00:00.000Z",
});

const ENTITIES = [
  entity("binary_sensor.front_door_ding", "Front door ding"),
  entity("event.garden_gate_bell", "Garden gate bell"),
  entity("input_button.test_ring", "Test ring"),
  entity("light.kitchen", "Kitchen light"),
  entity("sensor.outdoor_temperature", "Outdoor temperature"),
];

/** Serves the cameras and Home Assistant to the page, and records camera saves instead of making them. */
async function serve(page: Page, { haConnected }: { haConnected: boolean }) {
  const saves: Array<{ cameras: Array<Record<string, unknown>> }> = [];
  let entityReads = 0;
  await page.route("**/api/settings?*", async (route: Route) => {
    const url = new URL(route.request().url());
    const key = url.searchParams.get("key");
    if (route.request().method() === "GET" && key === "cameras") {
      return route.fulfill({ json: { key, value: { cameras: CAMERAS } } });
    }
    if (route.request().method() === "GET" && key === "home_assistant") {
      return route.fulfill({
        json: { key, value: haConnected ? { url: "http://ha.e2e.invalid:8123", access_token: "__secret__" } : null },
      });
    }
    return route.fallback();
  });
  await page.route("**/api/settings", async (route: Route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    if (body.key !== "cameras") return route.fallback();
    saves.push(body.value);
    return route.fulfill({ json: { key: "cameras", value: body.value } });
  });
  await page.route("**/api/homeassistant/states?*", async (route: Route) => {
    entityReads++;
    return route.fulfill({ json: { entities: ENTITIES } });
  });
  return { saves, entityReads: () => entityReads };
}

async function openEdit(page: Page, name: string) {
  await page.goto("/settings/cameras", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click({ timeout: 60_000 });
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("the dialog offers only doorbells, greys out the one another camera has, and saves the pick", async ({ page }, testInfo) => {
  await establishSession(page, familyCode!, DEVICE(testInfo.project.name));
  const served = await serve(page, { haConnected: true });

  await page.goto("/settings/cameras", { waitUntil: "domcontentloaded" });
  // A dev server compiles the page on first visit; wait for the list itself.
  await expect(page.getByText("E2E garden", { exact: true })).toBeVisible({ timeout: 60_000 });
  // The bell in the list: on the camera that has one, not on the other.
  await expect(page.getByTestId("camera-doorbell-indicator")).toHaveCount(1);
  await expect(page.getByTestId("camera-doorbell-indicator")).toHaveAttribute(
    "aria-label",
    /binary_sensor\.front_door_ding/,
  );

  await openEdit(page, "E2E garden");
  const dialog = page.getByRole("dialog");
  const trigger = dialog.locator("#camera-doorbell");
  await expect(dialog.getByText("Show on the screens when this rings")).toBeVisible();
  await expect(trigger).toBeEnabled();
  await expect(dialog.getByRole("link", { name: "How to set it up" })).toHaveAttribute(
    "href",
    /wiki\/Home-Assistant#doorbell--camera$/,
  );
  await expect(dialog.getByTestId("camera-doorbell-not-connected")).toHaveCount(0);

  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  expect(served.entityReads()).toBeGreaterThan(0);
  // The four doorbell domains, and nothing else.
  await expect(listbox.getByRole("option", { name: /event\.garden_gate_bell/ })).toBeVisible();
  await expect(listbox.getByRole("option", { name: /input_button\.test_ring/ })).toBeVisible();
  await expect(listbox.getByRole("option", { name: /light\.kitchen/ })).toHaveCount(0);
  await expect(listbox.getByRole("option", { name: /sensor\.outdoor_temperature/ })).toHaveCount(0);
  // The front door's bell is listed, but taken, and says by whom.
  const taken = listbox.getByRole("option", { name: /binary_sensor\.front_door_ding/ });
  await expect(taken).toHaveAttribute("aria-disabled", "true");
  await expect(taken).toContainText("Already shows E2E front door");
  await page.screenshot({ path: testInfo.outputPath("doorbell-picker-open.png") });

  await listbox.getByRole("option", { name: /event\.garden_gate_bell/ }).click();
  await expect(trigger).toContainText("Garden gate bell");
  await page.screenshot({ path: testInfo.outputPath("doorbell-picked.png") });

  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(served.saves).toHaveLength(1);
  const saved = Object.fromEntries(served.saves[0].cameras.map((c) => [c.id, c.doorbell_entity_id]));
  expect(saved).toEqual({
    "cam-e2e-door": "binary_sensor.front_door_ding",
    "cam-e2e-garden": "event.garden_gate_bell",
  });
});

test("the camera that has a bell keeps it, and None clears it", async ({ page }, testInfo) => {
  await establishSession(page, familyCode!, DEVICE(testInfo.project.name));
  const served = await serve(page, { haConnected: true });

  await openEdit(page, "E2E front door");
  const dialog = page.getByRole("dialog");
  const trigger = dialog.locator("#camera-doorbell");
  // Its own bell is not "taken" from its own point of view.
  await expect(trigger).toContainText("Front door ding");
  await trigger.click();
  await expect(page.getByRole("option", { name: /binary_sensor\.front_door_ding/ })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("option", { name: "None" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(served.saves.at(-1)!.cameras.find((c) => c.id === "cam-e2e-door")?.doorbell_entity_id).toBeNull();
});

test("without Home Assistant the field is there, greyed out, and says why", async ({ page }, testInfo) => {
  await establishSession(page, familyCode!, DEVICE(testInfo.project.name));
  const served = await serve(page, { haConnected: false });

  await openEdit(page, "E2E front door");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Show on the screens when this rings")).toBeVisible();
  await expect(dialog.locator("#camera-doorbell")).toBeDisabled();
  await expect(dialog.getByTestId("camera-doorbell-not-connected")).toBeVisible();
  // The saved bell is still shown, by its id, rather than looking unset.
  await expect(dialog.locator("#camera-doorbell")).toContainText("binary_sensor.front_door_ding");
  expect(served.entityReads()).toBe(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("doorbell-not-connected.png") });

  // Saving an unrelated change keeps the bell.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(served.saves.at(-1)!.cameras.find((c) => c.id === "cam-e2e-door")?.doorbell_entity_id).toBe(
    "binary_sensor.front_door_ding",
  );
});

test("the server stores the bell with the camera and refuses a doubled or malformed one", async ({ page }, testInfo) => {
  await establishSession(page, familyCode!, DEVICE(testInfo.project.name));
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const cookie = (await page.context().cookies()).find((c) => c.name === "family-calendar-storage");
  const familyId = JSON.parse(decodeURIComponent(cookie!.value)).state.family.id as string;

  const result = await page.evaluate(async ({ familyId, cameras }) => {
    const get = async () =>
      (await (await fetch(`/api/settings?family_id=${familyId}&key=cameras`)).json()).value;
    const put = async (value: unknown) =>
      fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ family_id: familyId, key: "cameras", value }),
      });
    const original = await get();
    const out: Record<string, unknown> = {};
    try {
      const mine = (original?.cameras ?? []).filter((c: { id: string }) => !c.id.startsWith("cam-e2e-"));
      out.saved = (await put({ cameras: [...mine, ...cameras] })).status;
      out.readBack = (await get()).cameras
        .filter((c: { id: string }) => c.id.startsWith("cam-e2e-"))
        .map((c: { id: string; doorbell_entity_id?: unknown }) => [c.id, c.doorbell_entity_id ?? null]);
      const doubled = await put({
        cameras: [...mine, ...cameras.map((c) => ({ ...c, doorbell_entity_id: "binary_sensor.front_door_ding" }))],
      });
      out.doubled = [doubled.status, (await doubled.json()).error];
      const malformed = await put({ cameras: [{ ...cameras[0], doorbell_entity_id: "light.kitchen" }] });
      out.malformed = [malformed.status, (await malformed.json()).error];
      out.afterRefusals = (await get()).cameras.filter((c: { id: string }) => c.id.startsWith("cam-e2e-")).length;
    } finally {
      // Back as it was: the value as read, sentinels and all, which a save resolves.
      if (original === null) {
        await fetch("/api/settings", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ family_id: familyId, key: "cameras" }),
        });
      } else {
        await put(original);
      }
      out.restored = JSON.stringify(await get()) === JSON.stringify(original);
    }
    return out;
  }, { familyId, cameras: CAMERAS });

  expect(result.saved).toBe(200);
  expect(result.readBack).toEqual([
    ["cam-e2e-door", "binary_sensor.front_door_ding"],
    ["cam-e2e-garden", null],
  ]);
  expect(result.doubled).toEqual([400, expect.stringContaining('already shows "E2E front door"')]);
  expect(result.malformed).toEqual([400, expect.stringContaining("doorbell_entity_id must be")]);
  // A refused save wrote nothing: the two cameras from the good save are still there.
  expect(result.afterRefusals).toBe(2);
  expect(result.restored).toBe(true);
});
