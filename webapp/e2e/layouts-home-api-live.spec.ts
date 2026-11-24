import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";
import { builtInHome, builtInScreensaver } from "../src/lib/layouts/built-in";
import { gridFor } from "../src/lib/layouts/grid";
import { homeArea } from "../src/lib/layouts/home-area";
import { validateItems } from "../src/lib/layouts/validate";
import type { HomeLayoutItem } from "../src/lib/layouts/types";

/**
 * PATCH /api/layouts/[id] accepts `home` (RFC-022 step 6), checked like the
 * screensaver: Home's widgets and minimums on the area Home's grid gets (the
 * screen less the navigation bar), no overlaps, and a child's widget only for
 * a person of this family. A refusal is 400 { error, itemId } and writes
 * nothing; the screensaver is untouched by a Home change. A copy for another
 * size redraws Home as well. In a family of its own, removed afterwards.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
test.describe.configure({ mode: "serial" });

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-rfc022-s6-api-";
const SIZE = { width: 1080, height: 1920 };
const AREA = homeArea(SIZE.width, SIZE.height);
let api: APIRequestContext;
let famId = "";
let otherFam = "";
let child = "";
let stranger = "";
let layoutId = "";
let stamp = "";

function purge(ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    const fam = sqlText(id);
    psql(`DELETE FROM devices WHERE family_id = ${fam}`);
    psql(`DELETE FROM layouts WHERE family_id = ${fam}`);
    psql(`DELETE FROM settings WHERE family_id = ${fam}`);
    psql(`SET kinboard.hard_delete = 'on'; DELETE FROM people WHERE family_id = ${fam}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${fam}`);
    psql(`DELETE FROM families WHERE id = ${fam}`);
  }
}
const row = () => JSON.parse(psql(`SELECT json_build_object('home', home, 'screensaver', screensaver, 'updated_at', updated_at)::text FROM layouts WHERE id = '${layoutId}'`));
const patch = (data: Record<string, unknown>) => api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, updated_at: stamp, ...data } });

/** A PATCH of `home` that must be refused with this code, naming this item, and change nothing. */
async function refused(home: unknown, error: string, itemId: string) {
  const before = row();
  const res = await patch({ home });
  expect(res.status(), await res.text()).toBe(400);
  expect(await res.json()).toEqual({ error, itemId });
  expect(row()).toEqual(before);
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  purge(psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(","));
  const code = `CS${randomBytes(4).toString("hex").toUpperCase()}`;
  famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  otherFam = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}other', 'CS${randomBytes(4).toString("hex").toUpperCase()}', true) RETURNING id`);
  child = psqlRow(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${famId}', '${P}Mia', '#ff8800', true) RETURNING id`);
  stranger = psqlRow(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${otherFam}', '${P}Theirs', '#0088ff', true) RETURNING id`);

  api = await pwRequest.newContext({ baseURL: BASE });
  const join = await postJoin(api, { joinCode: code, hardwareId: `${P}device-${Date.now()}`, deviceName: `${P}device` });
  expect(join.ok(), await join.text()).toBe(true);
  expect((await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: "4711" } })).ok()).toBe(true);
  expect((await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } })).ok()).toBe(true);

  const created = await api.post("/api/layouts", { data: { grid: 48, name: `${P}kitchen`, ...SIZE, from: "builtin" } });
  expect(created.status(), await created.text()).toBe(201);
  const { layout } = await created.json();
  layoutId = layout.id;
  stamp = layout.updated_at;
  // The built-in start leaves Home empty: the screen keeps the built-in Home.
  expect(layout.home).toEqual([]);
});

test.afterAll(async () => {
  purge([famId, otherFam]);
  await api?.dispose();
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM people WHERE name LIKE '${P}%'`)).toBe("0");
});

test("a valid Home is saved; the screensaver is left as it was", async () => {
  const before = row();
  const home = builtInHome(AREA.width, AREA.height, { scheduleChildren: [child] });
  expect(home.some((i) => i.options?.personId === child)).toBe(true);
  const res = await patch({ home });
  expect(res.status(), await res.text()).toBe(200);
  const { layout } = await res.json();
  expect(layout.home).toEqual(home);
  expect(layout.screensaver).toEqual(before.screensaver);
  expect(row().home).toEqual(home);
  stamp = layout.updated_at;
});

test("Home is refused with the screensaver's error shape: unknown key, below minimum, overlap, off the grid", async () => {
  const ok = (o: Partial<HomeLayoutItem> & { id: string }) => ({ widget: "tasks", x: 0, y: 0, w: 12, h: 12, text: "M", ...o });
  // A screensaver key is not a Home widget.
  await refused([ok({ id: "n", widget: "news" as never })], "unknown_widget", "n");
  // The week overview needs 24 steps of width.
  await refused([ok({ id: "w", widget: "weekOverview", w: 20, h: 8 })], "below_minimum", "w");
  await refused([ok({ id: "a" }), ok({ id: "b", widget: "notes", x: 6 })], "overlap", "b");
  // The screen's last rows are under the navigation bar: a box reaching them is off Home's grid.
  const screenRows = gridFor(SIZE.width, SIZE.height)!.rows;
  const homeRows = gridFor(AREA.width, AREA.height)!.rows;
  expect(homeRows).toBeLessThan(screenRows);
  await refused([ok({ id: "low", y: screenRows - 12 })], "out_of_bounds", "low");
  // The same box at Home's last row is fine.
  expect(validateItems([ok({ id: "low", y: homeRows - 12 })], AREA.width, AREA.height, "home").ok).toBe(true);
});

test("a child's widget must name a person of this family", async () => {
  const sched = (id: string, personId: string) => ({ id, widget: "schedule", x: 0, y: 0, w: 12, h: 12, text: "M", options: { personId } });
  // Another family's child: the shape is right, only the database can tell.
  await refused([sched("theirs", stranger)], "bad_person", "theirs");
  // Not an id, or on a widget that is not per child: refused before the database.
  await refused([sched("junk", "nobody")], "bad_person", "junk");
  await refused([{ id: "t", widget: "tasks", x: 0, y: 0, w: 12, h: 12, text: "M", options: { personId: child } }], "bad_person", "t");
  // A child in the recycle bin no longer counts.
  psql(`UPDATE people SET deleted_at = now() WHERE id = '${child}'`);
  try {
    await refused([sched("binned", child)], "bad_person", "binned");
  } finally {
    psql(`UPDATE people SET deleted_at = NULL WHERE id = '${child}'`);
  }
  const res = await patch({ home: [sched("mine", child)] });
  expect(res.status(), await res.text()).toBe(200);
  stamp = (await res.json()).layout.updated_at;
  expect(row().home).toEqual([sched("mine", child)]);
});

test("a stale stamp is refused for Home as for the screensaver", async () => {
  const res = await api.patch(`/api/layouts/${layoutId}`, { data: { grid: 48, updated_at: "2000-01-01T00:00:00Z", home: [] } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("stale");
});

test("a copy for another size redraws Home there, listing what did not fit", async () => {
  const home = builtInHome(AREA.width, AREA.height, { scheduleChildren: [child] });
  const res = await patch({ home });
  expect(res.status(), await res.text()).toBe(200);
  stamp = (await res.json()).layout.updated_at;
  const copy = await api.post("/api/layouts", { data: { grid: 48, name: `${P}landscape`, width: 1280, height: 720, from: layoutId } });
  expect(copy.status(), await copy.text()).toBe(201);
  const { layout, dropped, droppedHome } = (await copy.json()) as { layout: { home: HomeLayoutItem[]; screensaver: unknown[] }; dropped: string[]; droppedHome: string[] };
  const to = homeArea(1280, 720);
  expect(validateItems(layout.home, to.width, to.height, "home").ok).toBe(true);
  expect(layout.home.length).toBeGreaterThan(0);
  expect(droppedHome.length).toBeGreaterThan(0);
  expect([...layout.home.map((i) => i.id), ...droppedHome].sort()).toEqual(home.map((i) => i.id).sort());
  expect(validateItems(layout.screensaver, 1280, 720).ok).toBe(true);
  expect([...layout.screensaver.map((i) => (i as { id: string }).id), ...dropped].sort()).toEqual(builtInScreensaver(1080, 1920).map((i) => i.id).sort());
});

test("an empty Home puts the screen back on the built-in", async () => {
  const res = await patch({ home: [] });
  expect(res.status(), await res.text()).toBe(200);
  stamp = (await res.json()).layout.updated_at;
  expect(row().home).toEqual([]);
});
