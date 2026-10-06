import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";

/**
 * Who a device belongs to (RFC-017 §8.2) is a parent's setting: PATCH
 * /api/devices/[id] answers 403 pin_required to a device that has not entered
 * the settings PIN, writes once it has, and only within the session's family.
 * The browser cannot go round it -- device-owner-db.spec.ts shows the column
 * is not writable with a family token.
 *
 * In a family of its own with a PIN of its own, removed afterwards. Needs a
 * running stack: FAMILY_CODE says there is one (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-dev-owner-";
let api: APIRequestContext;
let famId = "";
let otherFam = "";
let kidId = "";
let strangerId = "";
let deviceId = "";
let otherDeviceId = "";

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    psql(`DELETE FROM devices WHERE family_id = ${sqlText(id)}`);
    for (let i = 0; i < 2; i++) psql(`DELETE FROM people WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM families WHERE id = ${sqlText(id)}`);
  }
}

const lock = () => psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);
const owner = () => psql(`SELECT COALESCE(person_id::text, 'null') FROM devices WHERE id = '${deviceId}'`);
const patch = (id: string, data: unknown) => api.patch(`/api/devices/${id}`, { data: data as Record<string, unknown> });

test.beforeAll(async () => {
  test.setTimeout(60_000);
  const stale = psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`);
  purge(stale.split(","));

  const code = `CD${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  otherFam = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}other', 'CD${randomBytes(4).toString("hex").toUpperCase()}', true) RETURNING id`);
  kidId = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid', true) RETURNING id`);
  strangerId = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${otherFam}', '${P}stranger', true) RETURNING id`);
  otherDeviceId = psqlRow(`INSERT INTO devices (family_id, name) VALUES ('${otherFam}', '${P}other-device') RETURNING id`);

  api = await pwRequest.newContext({ baseURL: BASE });
  const join = await postJoin(api, { joinCode: code, hardwareId: `${P}device-${Date.now()}`, deviceName: `${P}device` });
  expect(join.ok(), await join.text()).toBe(true);
  deviceId = ((await join.json()) as { device: { id: string } }).device.id;

  // A PIN, so the test proves the lock and not its absence (no PIN = unlocked).
  const setPin = await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: "4711" } });
  expect(setPin.ok(), await setPin.text()).toBe(true);
});

test.afterAll(async () => {
  purge([famId, otherFam]);
  await api?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
});

test("without the PIN: 403 pin_required, and nothing written", async () => {
  lock();
  const res = await patch(deviceId, { person_id: kidId });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe("pin_required");
  expect(owner()).toBe("null");
});

test("with the PIN: the device belongs to the child, and back to nobody", async () => {
  const verify = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } });
  expect(verify.ok(), await verify.text()).toBe(true);

  const res = await patch(deviceId, { person_id: kidId });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { device: { id: string; person_id: string | null; name: string } };
  // The whole row, for the screen's store.
  expect(body.device).toMatchObject({ id: deviceId, person_id: kidId, name: `${P}device` });
  expect(owner()).toBe(kidId);

  const clear = await patch(deviceId, { person_id: null });
  expect(clear.status()).toBe(200);
  expect(owner()).toBe("null");
});

test("unlocked, still only within the family: no stranger, no other family's device, no binned child", async () => {
  expect((await patch(deviceId, { person_id: strangerId })).status()).toBe(404);
  expect((await patch(otherDeviceId, { person_id: kidId })).status()).toBe(404);
  expect(psql(`SELECT COALESCE(person_id::text, 'null') FROM devices WHERE id = '${otherDeviceId}'`)).toBe("null");

  psql(`UPDATE people SET deleted_at = now() WHERE id = '${kidId}'`);
  try {
    const binned = await patch(deviceId, { person_id: kidId });
    expect(binned.status()).toBe(404);
    expect((await binned.json()).error).toBe("unknown_person");
  } finally {
    psql(`UPDATE people SET deleted_at = NULL WHERE id = '${kidId}'`);
  }
  expect(owner()).toBe("null");
});

test("only person_id, and only a person's id or null", async () => {
  for (const body of [{}, { person_id: "kid" }, { person_id: kidId, is_kiosk: true }, [kidId]]) {
    const res = await patch(deviceId, body);
    expect(res.status(), JSON.stringify(body)).toBe(400);
  }
  expect(owner()).toBe("null");
});

test("a bad body is refused before the PIN is asked for; a locked device learns nothing more", async () => {
  lock();
  expect((await patch(deviceId, { person_id: "kid" })).status()).toBe(400);
  // The family check comes after the PIN: locked, a foreign id is the same 403.
  const foreign = await patch(otherDeviceId, { person_id: strangerId });
  expect(foreign.status()).toBe(403);
  expect((await foreign.json()).error).toBe("pin_required");
});
