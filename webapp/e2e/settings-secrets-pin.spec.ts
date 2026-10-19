import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";

/**
 * A setting that holds a secret also says where the secret goes. Home
 * Assistant's row keeps its long-lived token behind a sentinel: a device that
 * could PUT a new `url` without touching the token had the server send that
 * token to an address of its choosing on the next Home Assistant call. So
 * PUT and DELETE on /api/settings need the settings PIN for every key in
 * SECRET_FIELDS, and stay open for the rest.
 *
 * In a family of its own with a PIN of its own, removed afterwards. Needs a
 * running stack: FAMILY_CODE says there is one (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-secret-pin-";
// What the browser sends for a secret it was never shown (SECRET_SENTINEL).
const KEEP = "__secret_stored__";
const HA_URL = "http://homeassistant.invalid:8123";
let api: APIRequestContext;
let famId = "";

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    psql(`DELETE FROM devices WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM settings WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM families WHERE id = ${sqlText(id)}`);
  }
}

const lock = () => psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);
const haUrl = () =>
  psql(`SELECT COALESCE(value->>'url', 'none') FROM settings WHERE family_id = '${famId}' AND key = 'home_assistant'`) || "none";
const put = (key: string, value: unknown) => api.put("/api/settings", { data: { family_id: famId, key, value } });
const del = (key: string) => api.delete("/api/settings", { data: { family_id: famId, key } });

test.beforeAll(async () => {
  test.setTimeout(60_000);
  const stale = psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`);
  purge(stale.split(","));

  const code = `CS${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);

  api = await pwRequest.newContext({ baseURL: BASE });
  const join = await postJoin(api, { joinCode: code, hardwareId: `${P}device-${Date.now()}`, deviceName: `${P}device` });
  expect(join.ok(), await join.text()).toBe(true);

  // Connected while there was no PIN yet, as the setup wizard does it.
  const connect = await put("home_assistant", { url: HA_URL, access_token: "claude-test-token" });
  expect(connect.status(), await connect.text()).toBe(200);

  // A PIN, so the test proves the lock and not its absence (no PIN = unlocked).
  const setPin = await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: "4711" } });
  expect(setPin.ok(), await setPin.text()).toBe(true);
});

test.afterAll(async () => {
  purge([famId]);
  await api?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
});

test("without the PIN, Home Assistant's address can't be moved, and the row can't be deleted", async () => {
  lock();
  const moved = await put("home_assistant", { url: "https://evil.example", access_token: KEEP });
  expect(moved.status()).toBe(403);
  expect((await moved.json()).error).toBe("pin_required");

  const removed = await del("home_assistant");
  expect(removed.status()).toBe(403);
  expect(haUrl()).toBe(HA_URL);
});

test("without the PIN, every other secret-holding setting is closed too", async () => {
  lock();
  for (const key of ["immich", "cameras", "google_calendar", "bring_settings", "unsplash"]) {
    const res = await put(key, { url: "https://evil.example" });
    expect(res.status(), key).toBe(403);
  }
  expect(psql(`SELECT count(*) FROM settings WHERE family_id = '${famId}' AND key <> 'home_assistant'`)).toBe("0");
});

test("a setting with no secret in it needs no PIN", async () => {
  lock();
  const res = await put("claude_probe", { on: true });
  expect(res.status(), await res.text()).toBe(200);
  expect((await del("claude_probe")).status()).toBe(200);
});

test("with the PIN, the address changes", async () => {
  const verify = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } });
  expect(verify.ok(), await verify.text()).toBe(true);

  const res = await put("home_assistant", { url: "http://homeassistant.local:8123", access_token: KEEP });
  expect(res.status(), await res.text()).toBe(200);
  expect(haUrl()).toBe("http://homeassistant.local:8123");
});
