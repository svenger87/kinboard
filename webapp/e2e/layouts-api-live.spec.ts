import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { builtInScreensaver } from "../src/lib/layouts/built-in";
import { validateItems } from "../src/lib/layouts/validate";
import type { LayoutItem } from "../src/lib/layouts/types";

/**
 * The layout routes against a running stack: create, edit with the stale
 * check, duplicate, assign to a screen, defaults, delete, and the PIN and
 * family walls. In a family of its own, removed afterwards. FAMILY_CODE says
 * there is a stack (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-layouts-";
let api: APIRequestContext;
let famId = "";
let otherFam = "";
let deviceId = "";
let otherDeviceId = "";
let otherLayoutId = "";
let layoutId = "";
let updatedAt = "";

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    psql(`DELETE FROM devices WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM layouts WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM settings WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${sqlText(id)}`);
    psql(`DELETE FROM families WHERE id = ${sqlText(id)}`);
  }
}
const lock = () => psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);
const defaults = () => psql(`SELECT COALESCE((SELECT value::text FROM settings WHERE family_id = '${famId}' AND key = 'layout_defaults'), 'none')`);
const dev = () => psql(`SELECT COALESCE(layout_id::text, 'null') FROM devices WHERE id = '${deviceId}'`);
const stamp = (id: string) => psql(`SELECT updated_at::text FROM layouts WHERE id = '${id}'`);

test.beforeAll(async () => {
  test.setTimeout(60_000);
  purge(psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(","));
  const code = `CD${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  otherFam = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}other', 'CD${randomBytes(4).toString("hex").toUpperCase()}', true) RETURNING id`);
  otherDeviceId = psqlRow(`INSERT INTO devices (family_id, name) VALUES ('${otherFam}', '${P}other-device') RETURNING id`);
  otherLayoutId = psqlRow(`INSERT INTO layouts (family_id, name, width, height) VALUES ('${otherFam}', '${P}theirs', 1080, 1920) RETURNING id`);

  api = await pwRequest.newContext({ baseURL: BASE });
  const join = await postJoin(api, { joinCode: code, hardwareId: `${P}device-${Date.now()}`, deviceName: `${P}device` });
  expect(join.ok(), await join.text()).toBe(true);
  deviceId = ((await join.json()) as { device: { id: string } }).device.id;
  const setPin = await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: "4711" } });
  expect(setPin.ok(), await setPin.text()).toBe(true);
});

test.afterAll(async () => {
  purge([famId, otherFam]);
  await api?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM layouts WHERE name LIKE '${P}%'`)).toBe("0");
});

const unlock = async () => {
  const v = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } });
  expect(v.ok(), await v.text()).toBe(true);
};

test("without the PIN every mutating route answers 403 pin_required", async () => {
  lock();
  const fake = otherLayoutId;
  const calls = [
    api.post("/api/layouts", { data: { name: "x", width: 1080, height: 1920 } }),
    api.patch(`/api/layouts/${fake}`, { data: { name: "y", updated_at: "x" } }),
    api.delete(`/api/layouts/${fake}`),
    api.post(`/api/layouts/${fake}/duplicate`, { data: { name: "z" } }),
    api.put("/api/layouts/defaults", { data: { portrait: null, landscape: null } }),
    api.put(`/api/devices/${deviceId}/layout`, { data: { layout_id: null } }),
  ];
  for (const res of await Promise.all(calls)) {
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("pin_required");
  }
  expect(psql(`SELECT count(*) FROM layouts WHERE family_id = '${famId}'`)).toBe("0");
});

test("GET needs a session only, and shows this family's layouts", async () => {
  lock();
  const res = await api.get("/api/layouts");
  expect(res.status()).toBe(200);
  expect((await res.json()).layouts).toEqual([]);
});

test("create from builtin: 201 with the built-in screensaver", async () => {
  await unlock();
  const res = await api.post("/api/layouts", { data: { grid: 48, name: `${P}one`, width: 1080, height: 1920, from: "builtin" } });
  expect(res.status(), await res.text()).toBe(201);
  const { layout } = await res.json();
  layoutId = layout.id;
  updatedAt = layout.updated_at;
  expect(layout).toMatchObject({ family_id: famId, name: `${P}one`, width: 1080, height: 1920, grid: 48 });
  expect(layout.screensaver).toEqual(builtInScreensaver(1080, 1920));
  const bad = await api.post("/api/layouts", { data: { grid: 48, name: "", width: 1080, height: 1920 } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toBe("bad_name");
  const size = await api.post("/api/layouts", { data: { grid: 48, name: "ok", width: 10, height: 1920 } });
  expect((await size.json()).error).toBe("bad_size");
  // In range, but too flat for six rows of the smallest cell (20px): no screensaver could ever fit.
  // (1920x600 is fine since wide screens shrink their cells: six rows of 64px.)
  const flat = await api.post("/api/layouts", { data: { grid: 48, name: "ok", width: 1920, height: 300, from: "builtin" } });
  expect(flat.status()).toBe(400);
  expect((await flat.json()).error).toBe("bad_size");
});

test("create from a layout at a smaller size: 201 with what fits, the rest listed as dropped", async () => {
  await unlock();
  const src = await api.post("/api/layouts", { data: { grid: 48, name: `${P}portrait`, width: 1080, height: 1920, from: "builtin" } });
  expect(src.status(), await src.text()).toBe(201);
  const srcId = (await src.json()).layout.id as string;
  const res = await api.post("/api/layouts", { data: { grid: 48, name: `${P}landscape`, width: 1280, height: 720, from: srcId } });
  expect(res.status(), await res.text()).toBe(201);
  const { layout, dropped } = (await res.json()) as { layout: { screensaver: LayoutItem[] }; dropped: string[] };
  expect(dropped.length).toBeGreaterThan(0);
  expect(layout.screensaver.length).toBeGreaterThan(0);
  expect(validateItems(layout.screensaver, 1280, 720).ok).toBe(true);
  expect([...layout.screensaver.map((i) => i.id), ...dropped].sort()).toEqual(builtInScreensaver(1080, 1920).map((i) => i.id).sort());
  // Created from builtin or empty: nothing dropped, the field is still there.
  const empty = await api.post("/api/layouts", { data: { grid: 48, name: `${P}empty`, width: 1080, height: 1920 } });
  expect((await empty.json()).dropped).toEqual([]);
});

test("PATCH: a valid change, a stale stamp, an overlap, unknown keys", async () => {
  await unlock();
  const items = builtInScreensaver(1080, 1920);
  const ok = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, name: `${P}renamed`, screensaver: items.slice(0, 1), updated_at: updatedAt } });
  expect(ok.status(), await ok.text()).toBe(200);
  const { layout } = await ok.json();
  expect(layout.name).toBe(`${P}renamed`);
  expect(layout.screensaver).toHaveLength(1);
  expect(layout.updated_at).not.toBe(updatedAt);

  const stale = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, name: `${P}stale`, updated_at: updatedAt } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toBe("stale");
  expect(psql(`SELECT name FROM layouts WHERE id = '${layoutId}'`)).toBe(`${P}renamed`);

  const fresh = layout.updated_at as string;
  const a = { id: "a", widget: "clock", x: 0, y: 0, w: 16, h: 8, text: "M" };
  const b = { id: "b", widget: "date", x: 8, y: 0, w: 16, h: 8, text: "M" };
  const before = stamp(layoutId);
  const over = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, screensaver: [a, b], updated_at: fresh } });
  expect(over.status()).toBe(400);
  expect((await over.json()).error).toBe("overlap");
  expect(stamp(layoutId)).toBe(before);

  const junk = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, name: "x", updated_at: "not a date" } });
  expect(junk.status()).toBe(400);
  expect((await junk.json()).error).toBe("bad_body");

  const unk = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, home: [], updated_at: fresh } });
  expect(unk.status()).toBe(400);
  expect((await unk.json()).error).toBe("bad_body");
  updatedAt = fresh;
});

test("duplicate: 201, same size and items, new id", async () => {
  await unlock();
  const res = await api.post(`/api/layouts/${layoutId}/duplicate`, { data: { grid: 48, name: `${P}copy` } });
  expect(res.status(), await res.text()).toBe(201);
  const { layout } = await res.json();
  expect(layout.id).not.toBe(layoutId);
  expect(layout).toMatchObject({ name: `${P}copy`, width: 1080, height: 1920, grid: 48 });
  expect(layout.screensaver).toHaveLength(1);
  const list = (await (await api.get("/api/layouts")).json()).layouts as { grid: number }[];
  expect(list.length).toBeGreaterThan(0);
  for (const l of list) expect(l.grid).toBe(48);
});

test("writes must say grid 48: without it, or with another, 409 grid_changed and nothing written", async () => {
  await unlock();
  const count = () => psql(`SELECT count(*) FROM layouts WHERE family_id = '${famId}'`);
  const before = count();
  const st = stamp(layoutId);
  for (const g of [{}, { grid: 12 }, { grid: "48" }, { grid: null }]) {
    const calls = [
      api.post("/api/layouts", { data: { name: `${P}g`, width: 1080, height: 1920, ...g } }),
      api.patch(`/api/layouts/${layoutId}`, { data: { name: `${P}g`, updated_at: updatedAt, ...g } }),
      api.patch(`/api/layouts/${layoutId}`, { data: { screensaver: [], updated_at: updatedAt, ...g } }),
      api.post(`/api/layouts/${layoutId}/duplicate`, { data: { name: `${P}g`, ...g } }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status(), JSON.stringify(g)).toBe(409);
      expect((await res.json()).error).toBe("grid_changed");
    }
  }
  expect(count()).toBe(before);
  expect(stamp(layoutId)).toBe(st);
});

test("a layout still on the 12-column grid cannot be assigned or made a default: 409 grid_changed", async () => {
  await unlock();
  const old = psqlRow(`INSERT INTO layouts (family_id, name, width, height, grid) VALUES ('${famId}', '${P}old-grid', 1080, 1920, 12) RETURNING id`);
  try {
    const assign = await api.put(`/api/devices/${deviceId}/layout`, { data: { layout_id: old } });
    expect(assign.status(), await assign.text()).toBe(409);
    expect((await assign.json()).error).toBe("grid_changed");
    expect(dev()).toBe("null");
    const before = defaults();
    const asDefault = await api.put("/api/layouts/defaults", { data: { portrait: old, landscape: null } });
    expect(asDefault.status(), await asDefault.text()).toBe(409);
    expect((await asDefault.json()).error).toBe("grid_changed");
    expect(defaults()).toBe(before);
  } finally {
    psql(`DELETE FROM layouts WHERE id = '${old}'`);
  }
});

test("another family's layout is 404 on every route", async () => {
  await unlock();
  expect((await api.patch(`/api/layouts/${otherLayoutId}`, { data: { grid: 48, name: "x", updated_at: stamp(otherLayoutId) } })).status()).toBe(404);
  expect((await api.delete(`/api/layouts/${otherLayoutId}`)).status()).toBe(404);
  expect((await api.post(`/api/layouts/${otherLayoutId}/duplicate`, { data: { grid: 48, name: "x" } })).status()).toBe(404);
  expect((await api.put(`/api/devices/${deviceId}/layout`, { data: { layout_id: otherLayoutId } })).status()).toBe(404);
  expect((await api.put(`/api/devices/${otherDeviceId}/layout`, { data: { layout_id: layoutId } })).status()).toBe(404);
  expect((await api.post("/api/layouts", { data: { grid: 48, name: "x", width: 1080, height: 1920, from: otherLayoutId } })).status()).toBe(404);
  // As a default, another family's layout is no layout of this family's: it counts as none.
  const asDefault = await api.put("/api/layouts/defaults", { data: { portrait: otherLayoutId, landscape: null } });
  expect(asDefault.status()).toBe(200);
  expect((await asDefault.json()).defaults).toEqual({ portrait: null, landscape: null });
  expect(psql(`SELECT count(*) FROM layouts WHERE id = '${otherLayoutId}'`)).toBe("1");
  expect(dev()).toBe("null");
});

test("assign and unassign set the device and leave updated_at alone", async () => {
  await unlock();
  const before = stamp(layoutId);
  const res = await api.put(`/api/devices/${deviceId}/layout`, { data: { layout_id: layoutId } });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).device).toMatchObject({ id: deviceId, layout_id: layoutId });
  expect(dev()).toBe(layoutId);
  expect(stamp(layoutId)).toBe(before); // an open editor must not go stale

  const mid = stamp(layoutId);
  const un = await api.put(`/api/devices/${deviceId}/layout`, { data: { layout_id: null } });
  expect(un.status()).toBe(200);
  expect(dev()).toBe("null");
  expect(stamp(layoutId)).toBe(mid);
});

test("defaults: matching orientation only; delete clears the slot and the device", async () => {
  await unlock();
  const wide = psqlRow(`INSERT INTO layouts (family_id, name, width, height) VALUES ('${famId}', '${P}wide', 1920, 1080) RETURNING id`);
  const wrong = await api.put("/api/layouts/defaults", { data: { portrait: wide, landscape: null } });
  expect(wrong.status()).toBe(400);
  expect((await wrong.json()).error).toBe("bad_default");

  const ok = await api.put("/api/layouts/defaults", { data: { portrait: layoutId, landscape: wide } });
  expect(ok.status(), await ok.text()).toBe(200);
  expect((await ok.json()).defaults).toEqual({ portrait: layoutId, landscape: wide });
  expect(JSON.parse(defaults())).toEqual({ portrait: layoutId, landscape: wide });

  await api.put(`/api/devices/${deviceId}/layout`, { data: { layout_id: layoutId } });
  const del = await api.delete(`/api/layouts/${layoutId}`);
  expect(del.status()).toBe(204);
  expect(dev()).toBe("null");
  expect(JSON.parse(defaults())).toEqual({ portrait: null, landscape: wide });
  expect(psql(`SELECT count(*) FROM layouts WHERE id = '${layoutId}'`)).toBe("0");
  expect((await api.delete(`/api/layouts/${layoutId}`)).status()).toBe(404);
});

test("defaults: an id with no layout behind it counts as null, so a dangling slot can be cleared", async () => {
  await unlock();
  const wide = psqlRow(`INSERT INTO layouts (family_id, name, width, height) VALUES ('${famId}', '${P}wide2', 1920, 1080) RETURNING id`);
  const gone = "00000000-0000-4000-8000-000000000000";
  // A stale value, as the settings page may still hold it after a delete elsewhere.
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${famId}', 'layout_defaults', '{"portrait":"${gone}","landscape":null}'::jsonb)
        ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value`);
  const res = await api.put("/api/layouts/defaults", { data: { portrait: gone, landscape: wide } });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).defaults).toEqual({ portrait: null, landscape: wide });
  expect(JSON.parse(defaults())).toEqual({ portrait: null, landscape: wide });
  // Another family's layout is no layout of this family's either.
  const theirs = await api.put("/api/layouts/defaults", { data: { portrait: otherLayoutId, landscape: wide } });
  expect(theirs.status()).toBe(200);
  expect(JSON.parse(defaults())).toEqual({ portrait: null, landscape: wide });
  // A layout of the family in the wrong orientation is still refused.
  const wrong = await api.put("/api/layouts/defaults", { data: { portrait: wide, landscape: null } });
  expect(wrong.status()).toBe(400);
});

test("the generic settings route does not write layout_defaults, unlocked or not", async () => {
  await unlock();
  const before = defaults();
  const res = await api.put("/api/settings", { data: { family_id: famId, key: "layout_defaults", value: { portrait: otherLayoutId, landscape: null } } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toContain("/api/layouts/defaults");
  const del = await api.delete("/api/settings", { data: { family_id: famId, key: "layout_defaults" } });
  expect(del.status()).toBe(403);
  expect(defaults()).toBe(before);
});
