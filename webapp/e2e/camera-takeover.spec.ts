import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICES, SERVICE_HANDLERS, serviceAdmission } from "../src/app/api/integration/v1/services/[service]/route";
import {
  DEFAULT_TAKEOVER_SECONDS,
  SHOW_CAMERA_RATE_LIMIT,
  SHOW_CAMERA_RATE_WINDOW_MS,
  MAX_TAKEOVER_SECONDS,
  activeTakeover,
  cameraPushEnded,
  endedCameraPushes,
  listableCameras,
  parseTakeoverDuration,
  readCameraListing,
  readCameraRefs,
  checkCameraDoorbells,
  doorbellEntityId,
  takenDoorbells,
  DOORBELL_DOMAINS,
  resolveCamera,
  resolveTargetDevices,
  takeoverCamera,
  takeoverRemainingMs,
  type CameraTakeoverRow,
} from "../src/lib/camera-takeover";
import { screensaverAllowed } from "../src/lib/screensaver-gate";
import { splitSecrets } from "../src/lib/integration-secrets";

/**
 * show_camera (#335): Home Assistant puts a camera on the wall displays for a
 * minute when the doorbell rings, and every phone gets a push that opens it.
 *
 * The rules that decide something are pure and driven here directly: how a
 * call names its camera and its screens, how long it stays, and what a given
 * screen should show at a given moment of the server's clock. The service
 * itself runs against a stand-in database seeded with what a real install
 * holds — cameras whose stream URLs carry a password, and another family --
 * so a handler that leaked a URL or crossed a family would show it here.
 */

const FAMILY = "11111111-1111-4111-8111-111111111111";
const OTHER_FAMILY = "22222222-2222-4222-8222-222222222222";
const WALL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HALL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_WALL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Row = Record<string, unknown>;

const SEED: Record<string, Row[]> = {
  settings: [
    {
      family_id: FAMILY,
      key: "cameras",
      value: {
        cameras: [
          { id: "cam-garden", name: "Garden", stream_type: "rtsp", stream_url: "rtsp://user:secret@10.0.0.5/garden", enabled: true, position: 2, doorbell_entity_id: "light.garden_path" },
          { id: "cam-door", name: "Front door", stream_type: "rtsp", stream_url: "rtsp://user:secret@10.0.0.5/door", auth: { username: "u", password: "p", type: "basic" }, enabled: true, position: 1, doorbell_entity_id: "binary_sensor.front_door_ding" },
          { id: "cam-old", name: "Old", stream_type: "mjpeg", stream_url: "http://10.0.0.9/old", enabled: false, position: 0, doorbell_entity_id: "event.back_door" },
        ],
      },
    },
    {
      family_id: OTHER_FAMILY,
      key: "cameras",
      value: { cameras: [{ id: "cam-theirs", name: "Theirs", stream_type: "rtsp", stream_url: "rtsp://x", enabled: true, position: 0 }] },
    },
  ],
  devices: [
    { id: WALL, family_id: FAMILY, name: "Kitchen wall", is_kiosk: true },
    { id: HALL, family_id: FAMILY, name: "Hall", is_kiosk: true },
    { id: PHONE, family_id: FAMILY, name: "Phone", is_kiosk: false },
    { id: OTHER_WALL, family_id: OTHER_FAMILY, name: "Kitchen wall", is_kiosk: true },
  ],
};

/** Applies the filters it is given, records every write, and is awaitable like the real query builder. */
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const writes: Array<{ table: string; op: "insert" | "upsert"; row: Row; options?: unknown }> = [];
  function from(table: string) {
    const preds: Array<(row: Row) => boolean> = [];
    const rows = () => (tables[table] ?? []).filter((row) => preds.every((p) => p(row)));
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => (preds.push((r) => r[column] === value), chain),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      upsert: async (row: Row, options?: unknown) => (writes.push({ table, op: "upsert", row, options }), { error: null }),
      insert: async (row: Row) => (writes.push({ table, op: "insert", row }), { error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return chain;
  }
  return { db: { from }, writes };
}

type Admit = NonNullable<Parameters<(typeof SERVICE_HANDLERS)["show_camera"]>[0]["admit"]>;

async function call(body: Row, seed = SEED, admit?: Admit) {
  const { db, writes } = fakeDb(seed);
  const result = await SERVICE_HANDLERS.show_camera({ familyId: FAMILY, body, assistant: false, db, admit });
  return { ...result, writes };
}

test.describe("show_camera: the rules", () => {
  test("duration is a minute unless the call says otherwise, and stays in range", () => {
    expect(parseTakeoverDuration(undefined)).toEqual({ ok: true, seconds: DEFAULT_TAKEOVER_SECONDS });
    expect(DEFAULT_TAKEOVER_SECONDS).toBe(60);
    expect(parseTakeoverDuration(90)).toEqual({ ok: true, seconds: 90 });
    // What a Home Assistant template renders a number as.
    expect(parseTakeoverDuration("120")).toEqual({ ok: true, seconds: 120 });
    for (const bad of [4, 301, 30.5, -1, "1m", true, {}]) {
      expect(parseTakeoverDuration(bad).ok, String(bad)).toBe(false);
    }
  });

  test("a camera is named by its id or its exact name, never a guess", () => {
    const cameras = [
      { id: "cam-door", name: "Front door" },
      { id: "cam-garden", name: "Garden" },
      { id: "cam-2", name: "Garden" },
      { id: "Front door", name: "Porch" },
    ];
    expect(resolveCamera(cameras, "cam-door")).toEqual({ ok: true, camera: cameras[0] });
    // An id wins over another camera's name.
    expect(resolveCamera(cameras, "Front door")).toEqual({ ok: true, camera: cameras[3] });
    expect(resolveCamera(cameras.slice(0, 2), "Front door")).toEqual({ ok: true, camera: cameras[0] });
    expect(resolveCamera(cameras, "  cam-door ")).toEqual({ ok: true, camera: cameras[0] });

    const ambiguous = resolveCamera(cameras, "Garden");
    expect(ambiguous.ok).toBe(false);
    expect(!ambiguous.ok && ambiguous.error).toContain("use the id");
    for (const miss of ["front door", "Front doo", "", "   ", undefined, 3]) {
      expect(resolveCamera(cameras.slice(0, 2), miss).ok, String(miss)).toBe(false);
    }
  });

  test("the screens are the kiosk devices unless the call names others", () => {
    const devices = [
      { id: WALL, name: "Kitchen wall", is_kiosk: true },
      { id: HALL, name: "Hall", is_kiosk: true },
      { id: PHONE, name: "Phone", is_kiosk: false },
      { id: "e", name: "Twin", is_kiosk: false },
      { id: "f", name: "Twin", is_kiosk: null },
    ];
    expect(resolveTargetDevices(devices, undefined)).toEqual({ ok: true, deviceIds: [WALL, HALL] });
    expect(resolveTargetDevices(devices, [PHONE, "Hall"])).toEqual({ ok: true, deviceIds: [PHONE, HALL] });
    expect(resolveTargetDevices(devices, "Kitchen wall")).toEqual({ ok: true, deviceIds: [WALL] });
    expect(resolveTargetDevices(devices, ["Hall", HALL])).toEqual({ ok: true, deviceIds: [HALL] });

    const unknown = resolveTargetDevices(devices, ["Hall", "Garage", "Attic"]);
    expect(!unknown.ok && unknown.error).toBe('no device "Garage", "Attic"');
    expect(resolveTargetDevices(devices, ["Twin"]).ok).toBe(false);
    for (const bad of [[], [""], [3], {}, 7]) {
      expect(resolveTargetDevices(devices, bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("the camera list is enabled cameras in settings order, id, name and doorbell only", () => {
    const listed = listableCameras((SEED.settings[0].value as { cameras: never[] }).cameras);
    expect(listed).toEqual([
      { id: "cam-door", name: "Front door", doorbell_entity_id: "binary_sensor.front_door_ding" },
      // A light is not a doorbell: whatever is stored, it leaves as null.
      { id: "cam-garden", name: "Garden", doorbell_entity_id: null },
    ]);
    expect(JSON.stringify(listed)).not.toContain("rtsp");
    expect(listableCameras(undefined)).toEqual([]);
  });

  test("a screen shows it only if it is a target, until the server's clock reaches the end", () => {
    const row: CameraTakeoverRow = {
      family_id: FAMILY,
      camera_id: "cam-door",
      device_ids: [WALL],
      started_at: "2026-10-02T18:00:00.000Z",
      ends_at: "2026-10-02T18:01:00.000Z",
    };
    const at = (iso: string) => new Date(iso);
    expect(activeTakeover(row, WALL, at("2026-10-02T18:00:30Z"))).toBe(row);
    expect(activeTakeover(row, PHONE, at("2026-10-02T18:00:30Z"))).toBeNull();
    expect(activeTakeover(row, null, at("2026-10-02T18:00:30Z"))).toBeNull();
    expect(activeTakeover(row, WALL, at("2026-10-02T18:01:00Z"))).toBeNull();
    expect(activeTakeover(null, WALL, at("2026-10-02T18:00:30Z"))).toBeNull();
    expect(takeoverRemainingMs(row, at("2026-10-02T18:00:45Z"))).toBe(15_000);
    expect(takeoverRemainingMs(row, at("2026-10-02T18:02:00Z"))).toBe(0);
  });

  test("a takeover shows a camera only while that camera is still set up and enabled", () => {
    const row = { camera_id: "cam-door" };
    const door = { id: "cam-door", name: "Front door", enabled: true };
    const garden = { id: "cam-garden", name: "Garden", enabled: true };
    expect(takeoverCamera(row, [garden, door])).toBe(door);
    // Removed since the call, or switched off: nothing to show, so nothing to hold the screensaver for.
    expect(takeoverCamera(row, [garden])).toBeNull();
    expect(takeoverCamera(row, [{ ...door, enabled: false }])).toBeNull();
    expect(takeoverCamera(row, [])).toBeNull();
    expect(takeoverCamera(null, [door])).toBeNull();
  });

  test("a camera push is dropped once the takeover it announces has ended", () => {
    const at = (iso: string) => new Date(iso);
    const push = { scheduled_for: "2026-10-02T18:00:00.000Z", data: { ends_at: "2026-10-02T18:01:00.000Z" } };
    expect(cameraPushEnded(push, at("2026-10-02T18:00:30Z"))).toBe(false);
    expect(cameraPushEnded(push, at("2026-10-02T18:01:00Z"))).toBe(true);
    expect(cameraPushEnded(push, at("2026-10-02T18:05:00Z"))).toBe(true);
    // No ends_at recorded: the longest takeover there can be, from when it was queued.
    const bare = { scheduled_for: "2026-10-02T18:00:00.000Z", data: { camera_id: "cam-door" } };
    expect(cameraPushEnded(bare, at("2026-10-02T18:04:59Z"))).toBe(false);
    expect(cameraPushEnded(bare, new Date(Date.parse(bare.scheduled_for) + MAX_TAKEOVER_SECONDS * 1000))).toBe(true);
    expect(cameraPushEnded({ scheduled_for: "garbage", data: null }, at("2026-10-02T18:00:00Z"))).toBe(true);
  });

  test("a family's newest call decides whether its queued camera pushes are stale", () => {
    const row = (id: string, family: string, scheduled: string, ends: string, type = "camera_live") => ({
      id, family_id: family, notification_type: type, scheduled_for: scheduled, data: { ends_at: ends },
    });
    const pending = [
      // A five-minute call, then a five-second one that replaced it on the screens.
      row("long", FAMILY, "2026-10-02T18:00:00Z", "2026-10-02T18:05:00Z"),
      row("short", FAMILY, "2026-10-02T18:00:10Z", "2026-10-02T18:00:15Z"),
      // Another family's camera is still up.
      row("theirs", OTHER_FAMILY, "2026-10-02T18:00:05Z", "2026-10-02T18:01:05Z"),
      // Not a camera push, however old its data looks.
      row("todo", FAMILY, "2026-10-02T17:00:00Z", "2026-10-02T17:00:01Z", "todo_created"),
    ];
    expect(endedCameraPushes(pending, new Date("2026-10-02T18:00:12Z"))).toEqual([]);
    // The long one's own end is minutes away, but the screens went back with the short one.
    expect(endedCameraPushes(pending, new Date("2026-10-02T18:00:20Z"))).toEqual(["long", "short"]);
    expect(endedCameraPushes(pending, new Date("2026-10-02T18:02:00Z"))).toEqual(["long", "short", "theirs"]);
  });

  test("a camera on the screen keeps the screensaver off", () => {
    const idle = { isIdle: true, skipPath: false, handheld: false, ringingTimer: false, takeoverMessage: false, pendingAssistantActions: 0 };
    expect(screensaverAllowed(idle)).toBe(true);
    expect(screensaverAllowed({ ...idle, cameraTakeover: false })).toBe(true);
    expect(screensaverAllowed({ ...idle, cameraTakeover: true })).toBe(false);
  });
});

test.describe("show_camera: the service", () => {
  test("is an announcement, with a budget of its own like messages", () => {
    expect(SERVICES.show_camera.scope).toBe("announcements:write");
    expect(SERVICES.show_camera.rateLimit).toEqual({ limit: SHOW_CAMERA_RATE_LIMIT, windowMs: SHOW_CAMERA_RATE_WINDOW_MS });
    expect(SHOW_CAMERA_RATE_LIMIT).toBe(5);
  });

  test("puts the camera on this family's kiosk screens for a minute and queues the push", async () => {
    const before = Date.now();
    const { status, response, writes } = await call({ camera: "Front door" });
    expect(status).toBe(200);
    expect(response).toMatchObject({ camera: { id: "cam-door", name: "Front door" }, screens: 2 });
    expect(JSON.stringify(response)).not.toContain("rtsp");

    const takeover = writes.find((w) => w.table === "camera_takeovers");
    expect(takeover?.op).toBe("upsert");
    expect(takeover?.options).toEqual({ onConflict: "family_id" });
    expect(takeover?.row).toMatchObject({ family_id: FAMILY, camera_id: "cam-door", device_ids: [WALL, HALL] });
    const started = Date.parse(takeover!.row.started_at as string);
    expect(started).toBeGreaterThanOrEqual(before);
    expect(Date.parse(takeover!.row.ends_at as string) - started).toBe(60_000);
    expect(response.ends_at).toBe(takeover!.row.ends_at);

    const push = writes.find((w) => w.table === "scheduled_notifications");
    expect(push?.row).toMatchObject({
      family_id: FAMILY,
      notification_type: "camera_live",
      scheduled_for: takeover!.row.started_at,
      // Its end travels with it, so a late processor knows the camera has gone.
      data: { camera_id: "cam-door", camera_name: "Front door", ends_at: takeover!.row.ends_at },
    });
  });

  test("named screens replace the kiosks, and the push still goes out", async () => {
    const { status, response, writes } = await call({ camera: "cam-garden", duration: 30, target_devices: ["Phone"] });
    expect(status).toBe(200);
    expect(response.screens).toBe(1);
    const takeover = writes.find((w) => w.table === "camera_takeovers")!;
    expect(takeover.row.device_ids).toEqual([PHONE]);
    expect(Date.parse(takeover.row.ends_at as string) - Date.parse(takeover.row.started_at as string)).toBe(30_000);
    expect(writes.some((w) => w.table === "scheduled_notifications")).toBe(true);
  });

  test("a bad call writes nothing", async () => {
    for (const body of [
      { camera: "Nope" },
      { camera: "cam-theirs" },
      { camera: "Old" },
      { camera: "Front door", duration: 0 },
      { camera: "Front door", target_devices: ["Garage"] },
      {},
    ]) {
      const { status, response, writes } = await call(body);
      expect(status, JSON.stringify(body)).toBe(400);
      expect(response.code).toBe("invalid_request");
      expect(writes, JSON.stringify(body)).toEqual([]);
    }
  });

  test("only a call that will run spends the budget", async () => {
    let spent = 0;
    const admit: Admit = () => (spent++, null);
    // A misspelt camera, an unknown screen, a bad duration: answered 400 without touching the budget.
    for (const body of [{ camera: "Front dor" }, { camera: "Front door", target_devices: ["Garage"] }, { camera: "Front door", duration: 3 }]) {
      expect((await call(body, SEED, admit)).status).toBe(400);
    }
    expect(spent).toBe(0);
    expect((await call({ camera: "Front door" }, SEED, admit)).status).toBe(200);
    expect(spent).toBe(1);
  });

  test("a call over the budget is refused before it writes anything", async () => {
    const refusal = { status: 429, response: { code: "rate_limited" }, headers: { "retry-after": "60" } };
    const { status, headers, writes } = await call({ camera: "Front door" }, SEED, () => refusal);
    expect(status).toBe(429);
    expect(headers).toEqual({ "retry-after": "60" });
    expect(writes).toEqual([]);
  });

  test("the budget is five per token, and services without one never spend anything", () => {
    const token = `spec-${Date.now()}-${Math.random()}`;
    const admit = serviceAdmission(SERVICES.show_camera, token, "show_camera");
    for (let i = 0; i < SHOW_CAMERA_RATE_LIMIT; i++) expect(admit(), `call ${i + 1}`).toBeNull();
    const refused = admit();
    expect(refused?.status).toBe(429);
    expect(refused?.response.code).toBe("rate_limited");
    expect(Number(refused?.headers?.["retry-after"])).toBeGreaterThanOrEqual(1);
    // Another token has its own budget.
    expect(serviceAdmission(SERVICES.show_camera, `${token}-other`, "show_camera")()).toBeNull();
    // A service with no budget of its own is never refused by this.
    const unlimited = serviceAdmission(SERVICES.add_shopping_item, token, "add_shopping_item");
    for (let i = 0; i < SHOW_CAMERA_RATE_LIMIT * 3; i++) expect(unlimited()).toBeNull();
  });
});

test.describe("show_camera: the wiring", () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, "..", ...path), "utf8");

  test("the screens can read the table and hear about it live", () => {
    expect(read("docker", "migration_camera_takeovers.sql")).toContain("ADD TABLE public.camera_takeovers");
    expect(read("docker", "migration_zz_row_level_security.sql")).toContain("'camera_takeovers'");
    expect(read("src", "hooks", "use-realtime.ts")).toMatch(/ALL_TABLES[\s\S]*"camera_takeovers"/);
  });

  test("the budget is spent by the handler, not before the idempotency check or validation", () => {
    const route = read("src", "app", "api", "integration", "v1", "services", "[service]", "route.ts");
    const post = route.slice(route.indexOf("export async function POST"));
    // No hitLimit of its own in POST: the replay check returns before the handler, and the handler spends it.
    expect(post).not.toContain("hitLimit(");
    expect(post).toMatch(/admit:\s*serviceAdmission\(def, context\.tokenId, service\)/);
    expect(post.indexOf("findStoredResult(")).toBeLessThan(post.indexOf("def.handle("));
  });

  test("the overlay and the screensaver go by the same resolved camera", () => {
    const providers = read("src", "app", "providers.tsx");
    expect(providers).toMatch(/const shownCamera = takeoverCamera\(shownTakeover, cameras\)/);
    expect(providers).toMatch(/cameraTakeover: !!shownCamera/);
    expect(providers).toMatch(/shownTakeover && shownCamera && \(/);
  });

  test("a late processor drops a camera push instead of sending it", () => {
    const processor = read("src", "app", "api", "cron", "process-notifications", "route.ts");
    expect(processor).toMatch(/endedCameraPushes\(current, new Date\(\)\)/);
    // Retired with the stale reminders, so it is marked processed and never retried.
    expect(processor).toMatch(/const stale = \[\.\.\.staleReminders, \.\.\.endedCameras\]/);
  });

  test("the push opens that camera, in every language", () => {
    expect(read("src", "app", "api", "cron", "process-notifications", "route.ts")).toContain('case "camera_live"');
    for (const locale of ["en", "de", "fr"]) {
      const push = JSON.parse(read("messages", `${locale}.json`)).push;
      expect(push.cameraLiveTitle, locale).toContain("{camera}");
      expect(String(push.cameraLiveBody).length, locale).toBeGreaterThan(0);
    }
  });
});

test.describe("a camera's doorbell (the pairs the Home Assistant integration reads)", () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, "..", ...path), "utf8");

  test("only a well-formed id in the four doorbell domains leaves the server; anything else is null", () => {
    expect(DOORBELL_DOMAINS).toEqual(["binary_sensor", "event", "button", "input_button"]);
    for (const good of [
      "binary_sensor.front_door_ding",
      "event.doorbell",
      "button.ring",
      "input_button.door_bell_2",
    ]) {
      expect(doorbellEntityId(good), good).toBe(good);
    }
    for (const bad of [
      "light.porch",
      "camera.front_door",
      "sensor.doorbell",
      "binary_sensor.",
      "binary_sensor",
      ".front_door",
      "Binary_sensor.front",
      "binary_sensor.Front_Door",
      "binary_sensor.front-door",
      " binary_sensor.front",
      "binary_sensor.front ",
      "binary_sensor.front\n",
      "binary_sensor.front.door",
      "binary_sensor.front?x=1",
      "rtsp://user:secret@10.0.0.5/door",
      "",
      42,
      true,
      {},
      ["binary_sensor.front"],
      undefined,
      null,
    ]) {
      expect(doorbellEntityId(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  test("GET /cameras reads the setting into id, name and doorbell, and nothing that could carry a secret", async () => {
    const leaky = [
      { id: "cam-door", name: "Front door", stream_type: "rtsp", stream_url: "rtsp://user:secret@10.0.0.5/door", snapshot_url: "http://admin:hunter2@10.0.0.5/snap.jpg", auth: { username: "u", password: "hunter2", type: "digest" }, webrtc_config: { turn_password: "turnpass" }, enabled: true, position: 0, doorbell_entity_id: "event.front_door" },
      // A doorbell field someone tried to smuggle a URL through.
      { id: "cam-yard", name: "Yard", stream_type: "rtsp", stream_url: "rtsp://x", enabled: true, position: 1, doorbell_entity_id: "binary_sensor.x\nrtsp://user:secret@10.0.0.5" },
      { id: "cam-side", name: "Side", stream_type: "rtsp", stream_url: "rtsp://x", enabled: true, position: 2 },
      { id: "cam-off", name: "Off", stream_type: "rtsp", stream_url: "rtsp://x", enabled: false, position: 3, doorbell_entity_id: "button.off" },
    ];
    const { db } = fakeDb({ settings: [{ family_id: FAMILY, key: "cameras", value: { cameras: leaky } }] });
    const listed = await readCameraListing(db, FAMILY);
    expect(listed).toEqual([
      { id: "cam-door", name: "Front door", doorbell_entity_id: "event.front_door" },
      { id: "cam-yard", name: "Yard", doorbell_entity_id: null },
      // Never set: null, present, not missing — the integration can rely on the key.
      { id: "cam-side", name: "Side", doorbell_entity_id: null },
      // A disabled camera is not listed, its doorbell with it.
    ]);
    for (const camera of listed) expect(Object.keys(camera).sort()).toEqual(["doorbell_entity_id", "id", "name"]);
    const wire = JSON.stringify({ cameras: listed });
    for (const secret of ["rtsp", "http", "secret", "hunter2", "turnpass", "10.0.0.5", "password", "auth"]) {
      expect(wire, secret).not.toContain(secret);
    }
    // Another family's cameras are not this family's.
    expect(await readCameraListing(fakeDb(SEED).db, OTHER_FAMILY)).toEqual([
      { id: "cam-theirs", name: "Theirs", doorbell_entity_id: null },
    ]);
  });

  test("show_camera still resolves and answers with the plain ref", async () => {
    expect(await readCameraRefs(fakeDb(SEED).db, FAMILY)).toEqual([
      { id: "cam-door", name: "Front door" },
      { id: "cam-garden", name: "Garden" },
    ]);
    const { status, response } = await call({ camera: "Front door" });
    expect(status).toBe(200);
    expect(response.camera).toEqual({ id: "cam-door", name: "Front door" });
  });

  test("the endpoint serves the listing under `cameras`, behind family:read", () => {
    const route = read("src", "app", "api", "integration", "v1", "cameras", "route.ts");
    expect(route).toMatch(/withIntegrationAuth\(request, "family:read"/);
    expect(route).toMatch(/const cameras = await readCameraListing\(/);
    expect(route).toMatch(/NextResponse\.json\(\{ cameras \}\)/);
  });

  test("a save may give a bell to one camera only, and only a real doorbell id", () => {
    expect(checkCameraDoorbells([
      { id: "a", name: "Front door", doorbell_entity_id: "binary_sensor.front" },
      { id: "b", name: "Garden", doorbell_entity_id: null },
      { id: "c", name: "Side" },
      { id: "d", name: "Back", doorbell_entity_id: "event.back" },
    ])).toEqual({ ok: true });
    // Not a cameras list at all is not this rule's business.
    expect(checkCameraDoorbells(undefined)).toEqual({ ok: true });

    const twice = checkCameraDoorbells([
      { id: "a", name: "Front door", doorbell_entity_id: "binary_sensor.front" },
      { id: "b", name: "Hall", doorbell_entity_id: "binary_sensor.front" },
    ]);
    expect(twice.ok).toBe(false);
    expect(!twice.ok && twice.error).toContain('"Front door"');

    for (const bad of ["light.porch", "binary_sensor.Front", "", 7, "event."]) {
      const refused = checkCameraDoorbells([{ id: "a", name: "Front door", doorbell_entity_id: bad }]);
      expect(refused.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("the picker greys out bells other cameras have, by name, but never the one being edited", () => {
    const cameras = [
      { id: "a", name: "Front door", doorbell_entity_id: "binary_sensor.front" },
      { id: "b", name: "Garden", doorbell_entity_id: "event.garden" },
      { id: "c", name: "Side", doorbell_entity_id: null },
      { id: "d", name: "Junk", doorbell_entity_id: "light.porch" },
    ];
    expect([...takenDoorbells(cameras, null)]).toEqual([
      ["binary_sensor.front", "Front door"],
      ["event.garden", "Garden"],
    ]);
    expect([...takenDoorbells(cameras, "a")]).toEqual([["event.garden", "Garden"]]);
    expect(takenDoorbells(undefined, null).size).toBe(0);
  });

  test("the doorbell is stored with the camera: a settings save keeps it in the row, not with the secrets", () => {
    const { publicValue, secretValue } = splitSecrets("cameras", {
      cameras: [{ id: "a", name: "Front door", auth: { username: "u", password: "p", type: "basic" }, doorbell_entity_id: "binary_sensor.front" }],
    });
    expect((publicValue as { cameras: { doorbell_entity_id?: string }[] }).cameras[0].doorbell_entity_id).toBe("binary_sensor.front");
    expect(JSON.stringify(secretValue ?? {})).not.toContain("binary_sensor");
  });

  test("the settings save refuses a bad or doubled doorbell before writing anything", () => {
    const route = read("src", "app", "api", "settings", "route.ts");
    const put = route.slice(route.indexOf("export async function PUT"), route.indexOf("export async function DELETE"));
    expect(put).toMatch(/if \(key === SETTINGS_KEYS\.cameras\) \{\s*const doorbells = checkCameraDoorbells\(value\?\.cameras\)/);
    expect(put).toMatch(/status: 400/);
    const check = put.indexOf("checkCameraDoorbells(");
    expect(check).toBeGreaterThan(put.indexOf("familyMatchesSession("));
    expect(check).toBeLessThan(put.indexOf("upsertSecrets("));
    expect(check).toBeLessThan(put.indexOf('.from("settings")'));
  });

  test("the dialog saves the doorbell with the camera and offers only the four domains", () => {
    const form = read("src", "plugins", "cameras", "drivers", "go2rtc.tsx");
    expect(form.match(/doorbell_entity_id: doorbellId,/g)?.length).toBe(2);
    expect(form).toMatch(/DOORBELL_DOMAINS as readonly string\[\]\)\.includes\(e\.domain\)/);
    expect(form).toMatch(/disabled=\{!haConnected\}/);
    expect(form).toContain("Home-Assistant#doorbell--camera");
    // The wiki section the link points at exists under that anchor.
    expect(read("..", "docs", "wiki", "Home-Assistant.md")).toMatch(/^## Doorbell → camera$/m);
  });

  test("the doorbell field speaks every language", () => {
    for (const locale of ["en", "de", "fr"]) {
      const cams = JSON.parse(read("messages", `${locale}.json`)).settings.cameras;
      for (const key of ["doorbellLabel", "doorbellNone", "doorbellHint", "doorbellNotConnected", "doorbellTaken", "doorbellBadge", "doorbellDocsLink"]) {
        expect(String(cams[key] ?? "").length, `${locale}.${key}`).toBeGreaterThan(0);
      }
      expect(cams.doorbellHint, locale).toContain("1.2.0");
      expect(cams.doorbellHint, locale).toContain("announcements:write");
      expect(cams.doorbellTaken, locale).toContain("{camera}");
    }
    expect(JSON.parse(read("messages", "de.json")).settings.cameras.doorbellLabel).toBe(
      "Auf den Bildschirmen zeigen, wenn es klingelt",
    );
  });
});
