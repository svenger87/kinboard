import { test, expect, request as pwRequest, webkit, type APIRequestContext, type APIResponse } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { Client } from "@modelcontextprotocol/client";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import {
  callTool, connectAssistant, disconnectAssistant, mcpClient, newConnectState, psql, psqlRow, sqlText,
  type Connection, type ToolOutcome,
} from "./helpers/assistant-connect";

/**
 * Assistant actions (RFC-011) end to end, against a running server, a real
 * database and a mock Home Assistant: an assistant connected through the
 * real OAuth flow with every scope edits tasks, the shopping list, notes,
 * a local calendar and the meal plan, messages the screens, and controls
 * catalogue devices — with the sensitive ones confirmed (or refused) on a
 * Kinboard screen, the overlay checked in WebKit.
 *
 * Needs a stack and FAMILY_CODE; run with PLAYWRIGHT_BASE_URL pointing at
 * the server under test. If the family already has a settings PIN, set
 * SETTINGS_PIN — this spec never reads a PIN or the join code from the
 * database. Everything it creates is removed in afterAll, and the family's
 * Home Assistant settings and "Allow AI assistants" switch are put back.
 *
 * The overlay screenshot lands in SCREENSHOT_DIR when set, otherwise in the
 * test's own output directory.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const FAMILY_CODE = process.env.FAMILY_CODE;
const SCREENSHOT_FILE = "assistant-action-overlay-webkit.png";
const screenshotPath = () =>
  process.env.SCREENSHOT_DIR ? `${process.env.SCREENSHOT_DIR}/${SCREENSHOT_FILE}` : test.info().outputPath(SCREENSHOT_FILE);
test.skip(!FAMILY_CODE, "needs FAMILY_CODE and a running stack");

const ALL_SCOPES = [
  "family:read", "tasks:write", "shopping:write", "calendar:write", "notes:read", "notes:write",
  "meals:write", "announcements:write", "home:read", "home:control",
];
/** Every row this spec creates carries this prefix, so cleanup can find it. */
const P = "claude-actions-";
const CLIENT_NAME = "claude-actions-live";
const NEW_PIN = "4826";

// ── the mock Home Assistant ────────────────────────────────────────────────

const HA_TOKEN = "claude-mock-ha-token";
const HA_STATES = [
  { entity_id: "light.test_lamp", state: "off", attributes: { friendly_name: "Test lamp" } },
  { entity_id: "lock.test_door", state: "locked", attributes: { friendly_name: "Test door" } },
  { entity_id: "cover.test_garage", state: "closed", attributes: { friendly_name: "Test garage", device_class: "garage" } },
  { entity_id: "cover.test_blind", state: "closed", attributes: { friendly_name: "Test blind", device_class: "blind" } },
  { entity_id: "cover.test_unclassified", state: "closed", attributes: { friendly_name: "Test cover" } },
  { entity_id: "switch.not_in_catalogue", state: "off", attributes: { friendly_name: "Not in the catalogue" } },
];
const CATALOGUE = HA_STATES.filter((s) => s.entity_id !== "switch.not_in_catalogue").map((s) => s.entity_id);

interface HaCall { domain: string; service: string; body: Record<string, unknown>; authorized: boolean }
const haCalls: HaCall[] = [];
/** Paths of single-entity state reads, so the spec can see they are used. */
const haStateReads: string[] = [];
let haServer: http.Server | null = null;
const callsTo = (domain: string, service: string, entityId?: string) =>
  haCalls.filter((c) => c.domain === domain && c.service === service && (!entityId || c.body.entity_id === entityId));

async function startMockHa(): Promise<string> {
  haServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const authorized = req.headers.authorization === `Bearer ${HA_TOKEN}`;
      const url = new URL(req.url ?? "/", "http://mock");
      const service = url.pathname.match(/^\/api\/services\/([^/]+)\/([^/]+)$/);
      res.setHeader("content-type", "application/json");
      if (!authorized) {
        res.statusCode = 401;
        res.end("{}");
      } else if (req.method === "GET" && url.pathname === "/api/states") {
        res.end(JSON.stringify(HA_STATES));
      } else if (req.method === "GET" && url.pathname.startsWith("/api/states/")) {
        // One entity, as get_device_state and control_device read it.
        const one = HA_STATES.find((s) => s.entity_id === decodeURIComponent(url.pathname.slice("/api/states/".length)));
        haStateReads.push(url.pathname);
        if (one) res.end(JSON.stringify(one));
        else {
          res.statusCode = 404;
          res.end("{}");
        }
      } else if (req.method === "POST" && service) {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch { /* recorded as empty */ }
        haCalls.push({ domain: decodeURIComponent(service[1]), service: decodeURIComponent(service[2]), body, authorized });
        res.end("[]");
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => haServer!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(haServer!.address() as AddressInfo).port}`;
}

// ── shared state, filled in as the run goes so afterAll can clean up ───────

const state = newConnectState();
let api: APIRequestContext;
let conn: Connection;
let client: Client;
let startedAt = "";
let calendarId: string | null = null;
let mealPlansBefore: string[] = [];
/** The family's home_assistant rows before: undefined until read, null when absent. */
let haSettingBefore: string | null | undefined;
let haSecretBefore: string | null | undefined;

// The Integration API allows 30 writes a minute per token (sliding window),
// and this spec makes more than that. Every write goes through spendWrite(),
// which waits for the oldest to age out rather than collect a 429 that would
// say nothing about the feature under test.
const writes: number[] = [];
async function spendWrite(): Promise<void> {
  const now = Date.now();
  while (writes.length && now - writes[0] > 61_000) writes.shift();
  if (writes.length >= 28) {
    await new Promise((r) => setTimeout(r, 61_500 - (now - writes[0])));
    writes.shift();
  }
  writes.push(Date.now());
}

const READ_TOOL = /^(list_|get_)/;
async function tool(name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  if (!READ_TOOL.test(name)) await spendWrite();
  return callTool(client, name, args);
}

/** The Integration API directly, for what an MCP result hides: the HTTP status and headers. */
async function integ(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, key?: string): Promise<APIResponse> {
  if (method !== "GET") await spendWrite();
  return api.fetch(`/api/integration/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${conn.accessToken}`,
      ...(method === "POST" ? { "idempotency-key": key ?? randomUUID() } : {}),
    },
    ...(body !== undefined ? { data: body } : {}),
  });
}

const fam = () => state.familyId!;
const one = (sql: string) => psql(sql);

test.beforeAll(async () => {
  test.setTimeout(120_000);
  startedAt = psql("SELECT now()");
  api = await pwRequest.newContext({ baseURL: BASE });
  const join = await api.post("/api/session/join", { data: { joinCode: FAMILY_CODE, hardwareId: `${P}api-${Date.now()}`, deviceName: `${P}api` } });
  expect(join.ok(), await join.text()).toBe(true);
  state.familyId = psql(`SELECT id FROM families WHERE join_code = ${sqlText(FAMILY_CODE!)}`);

  const hasPin = psql(`SELECT count(*) FROM integration_secrets WHERE family_id = '${fam()}' AND key = 'settings_pin'`) !== "0";
  test.skip(hasPin && !process.env.SETTINGS_PIN, "the family has a settings PIN; set SETTINGS_PIN to run");

  conn = await connectAssistant(api, BASE, state, {
    scopes: ALL_SCOPES, clientName: CLIENT_NAME, newPin: NEW_PIN, existingPin: process.env.SETTINGS_PIN,
  });
  client = await mcpClient(BASE, conn.accessToken);
  const { tools } = await client.listTools();
  expect(tools.length).toBeGreaterThanOrEqual(33);
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await client?.close().catch(() => undefined);
  haServer?.close();
  const familyId = state.familyId;
  if (familyId) {
    // Before the token goes: its requests are found by token_id, which a
    // token delete would set to NULL.
    if (conn?.tokenId) psql(`DELETE FROM assistant_action_requests WHERE token_id = '${conn.tokenId}'`);
    psql(`DELETE FROM assistant_action_requests WHERE family_id = '${familyId}' AND created_at >= '${startedAt}' AND entity_id IN (${[...CATALOGUE, "switch.not_in_catalogue"].map(sqlText).join(", ")})`);
    psql(`DELETE FROM catalogue_items WHERE family_id = '${familyId}' AND entity_id IN (${CATALOGUE.map(sqlText).join(", ")})`);
    // Binned rows: the soft-delete trigger lets a second DELETE through as a purge.
    for (let i = 0; i < 2; i++) {
      psql(`DELETE FROM todos WHERE family_id = '${familyId}' AND title LIKE '${P}%'`);
      psql(`DELETE FROM notes WHERE family_id = '${familyId}' AND content LIKE '${P}%'`);
      psql(`DELETE FROM meal_plan_entries WHERE note LIKE '${P}%' AND meal_plan_id IN (SELECT id FROM meal_plans WHERE family_id = '${familyId}')`);
    }
    psql(`DELETE FROM shopping_items WHERE family_id = '${familyId}' AND name LIKE '${P}%'`);
    psql(`DELETE FROM messages WHERE family_id = '${familyId}' AND body LIKE '${P}%'`);
    if (calendarId) {
      psql(`DELETE FROM events WHERE calendar_id = '${calendarId}'`);
      psql(`DELETE FROM calendars WHERE id = '${calendarId}'`);
    }
    if (startedAt) {
      const keep = mealPlansBefore.length ? `AND id NOT IN (${mealPlansBefore.map(sqlText).join(", ")})` : "";
      psql(`DELETE FROM meal_plans mp WHERE family_id = '${familyId}' AND created_at >= '${startedAt}' ${keep} AND NOT EXISTS (SELECT 1 FROM meal_plan_entries e WHERE e.meal_plan_id = mp.id)`);
      psql(`DELETE FROM integration_idempotency WHERE family_id = '${familyId}' AND created_at >= '${startedAt}'`);
    }
    // Home Assistant settings back as they were.
    if (haSettingBefore !== undefined) {
      psql(`DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'home_assistant'`);
      psql(`DELETE FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'home_assistant'`);
      if (haSettingBefore !== null) {
        psql(`INSERT INTO settings (family_id, key, value) VALUES ('${familyId}', 'home_assistant', ${sqlText(haSettingBefore)}::jsonb)`);
      }
      if (haSecretBefore) {
        psql(`INSERT INTO integration_secrets (family_id, key, value) VALUES ('${familyId}', 'home_assistant', ${sqlText(haSecretBefore)}::jsonb)`);
      }
    }
  }
  disconnectAssistant(state);
  psql("DELETE FROM devices WHERE hardware_id LIKE 'claude-%'");
  await api?.dispose();
});

// ── tasks ──────────────────────────────────────────────────────────────────

test("tasks: complete a recurring one for today, complete/reopen a one-off, delete into the bin", async () => {
  test.setTimeout(180_000);
  const recurring = psqlRow(`INSERT INTO todos (family_id, title, recurrence) VALUES ('${fam()}', '${P}recurring', 'daily') RETURNING id`);

  const done = await tool("complete_task", { task_id: recurring });
  expect(done.isError, done.text).toBe(false);
  const tz = psql(`SELECT value #>> '{}' FROM settings WHERE family_id = '${fam()}' AND key = 'timezone'`) || process.env.TZ || "Europe/Berlin";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  expect(one(`SELECT completed::text || '|' || last_completed_day::text FROM todos WHERE id = '${recurring}'`)).toBe(`false|${today}`);

  const reopenRecurring = await tool("reopen_task", { task_id: recurring });
  expect(reopenRecurring.isError).toBe(true);
  expect(reopenRecurring.text).toContain("can't be reopened");

  const created = await tool("create_task", { title: `${P}one-off` });
  expect(created.isError, created.text).toBe(false);
  const oneOff = created.json.id as string;
  expect(one(`SELECT title FROM todos WHERE id = '${oneOff}' AND family_id = '${fam()}'`)).toBe(`${P}one-off`);
  expect((await tool("complete_task", { task_id: oneOff })).isError).toBe(false);
  expect(one(`SELECT completed FROM todos WHERE id = '${oneOff}'`)).toBe("t");
  expect((await tool("reopen_task", { task_id: oneOff })).isError).toBe(false);
  expect(one(`SELECT completed FROM todos WHERE id = '${oneOff}'`)).toBe("f");

  // Deleting goes to the recycle bin and says ok — the soft-delete trigger
  // makes the DELETE itself report 0 rows, which once turned into an error.
  const deleted = await tool("delete_task", { task_id: oneOff });
  expect(deleted.isError, deleted.text).toBe(false);
  expect(one(`SELECT deleted_at IS NOT NULL FROM todos WHERE id = '${oneOff}'`)).toBe("t");
  // A second delete is "not found" and must not purge the binned row.
  const again = await integ("DELETE", `/lists/tasks/${oneOff}`);
  expect(again.status(), await again.text()).toBe(404);
  expect(one(`SELECT count(*) FROM todos WHERE id = '${oneOff}'`)).toBe("1");
});

// ── shopping ───────────────────────────────────────────────────────────────

test("shopping: add, check, rename, delete", async () => {
  test.setTimeout(180_000);
  const added = await tool("add_shopping_item", { name: `${P}milk` });
  expect(added.isError, added.text).toBe(false);
  const id = added.json.id as string;
  expect(one(`SELECT name || '|' || checked::text FROM shopping_items WHERE id = '${id}' AND family_id = '${fam()}'`)).toBe(`${P}milk|false`);
  expect((await tool("check_shopping_item", { shopping_item_id: id })).isError).toBe(false);
  expect(one(`SELECT checked FROM shopping_items WHERE id = '${id}'`)).toBe("t");
  expect((await tool("rename_shopping_item", { shopping_item_id: id, name: `${P}oat milk` })).isError).toBe(false);
  expect(one(`SELECT name FROM shopping_items WHERE id = '${id}'`)).toBe(`${P}oat milk`);
  const deleted = await tool("delete_shopping_item", { shopping_item_id: id });
  expect(deleted.isError, deleted.text).toBe(false);
  expect(one(`SELECT count(*) FROM shopping_items WHERE id = '${id}'`)).toBe("0");
});

// ── notes ──────────────────────────────────────────────────────────────────

test("notes: create, update, delete into the bin", async () => {
  test.setTimeout(180_000);
  const created = await tool("create_note", { text: `${P}note` });
  expect(created.isError, created.text).toBe(false);
  const id = created.json.id as string;
  const updated = await tool("update_note", { note_id: id, content: `${P}note, edited`, pinned: true });
  expect(updated.isError, updated.text).toBe(false);
  expect(one(`SELECT content || '|' || pinned::text FROM notes WHERE id = '${id}' AND family_id = '${fam()}'`)).toBe(`${P}note, edited|true`);
  const listed = await tool("list_notes");
  expect(JSON.stringify(listed.json)).toContain(id);

  const deleted = await tool("delete_note", { note_id: id });
  expect(deleted.isError, deleted.text).toBe(false);
  expect(one(`SELECT deleted_at IS NOT NULL FROM notes WHERE id = '${id}'`)).toBe("t");
  const again = await integ("DELETE", `/notes/${id}`);
  expect(again.status(), await again.text()).toBe(404);
  expect(one(`SELECT count(*) FROM notes WHERE id = '${id}'`)).toBe("1");
  expect(JSON.stringify((await tool("list_notes")).json)).not.toContain(id);
});

// ── calendar ───────────────────────────────────────────────────────────────

test("calendar: create, move by an hour and delete an event on a local calendar", async () => {
  test.setTimeout(180_000);
  calendarId = psqlRow(`INSERT INTO calendars (family_id, name) VALUES ('${fam()}', '${P}calendar') RETURNING id`);
  const writable = await tool("list_writable_calendars");
  expect(JSON.stringify(writable.json)).toContain(calendarId);

  const created = await tool("create_calendar_event", {
    calendar_id: calendarId, title: `${P}event`, start_at: "2030-01-07T10:00:00+00:00", end_at: "2030-01-07T11:00:00+00:00",
  });
  expect(created.isError, created.text).toBe(false);
  const id = one(`SELECT id FROM events WHERE calendar_id = '${calendarId}' AND title = '${P}event'`);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  const moved = await tool("update_calendar_event", { event_id: id, start_at: "2030-01-07T11:00:00+00:00", end_at: "2030-01-07T12:00:00+00:00" });
  expect(moved.isError, moved.text).toBe(false);
  expect(one(`SELECT to_char(start_at AT TIME ZONE 'UTC', 'HH24:MI') || '-' || to_char(end_at AT TIME ZONE 'UTC', 'HH24:MI') FROM events WHERE id = '${id}'`)).toBe("11:00-12:00");

  const deleted = await tool("delete_calendar_event", { event_id: id });
  expect(deleted.isError, deleted.text).toBe(false);
  expect(one(`SELECT count(*) FROM events WHERE id = '${id}'`)).toBe("0");
});

// ── meals ──────────────────────────────────────────────────────────────────

test("meals: add, read back, remove into the bin", async () => {
  test.setTimeout(180_000);
  mealPlansBefore = psql(`SELECT id FROM meal_plans WHERE family_id = '${fam()}'`).split("\n").filter(Boolean);
  const added = await tool("add_meal", { date: "2030-01-08", meal_type: "dinner", note: `${P}soup` });
  expect(added.isError, added.text).toBe(false);
  const id = added.json.entry.id as string;

  const plan = await tool("get_meal_plan", { start: "2030-01-07", end: "2030-01-13" });
  expect(plan.isError, plan.text).toBe(false);
  expect(JSON.stringify(plan.json)).toContain(id);

  const removed = await tool("remove_meal", { meal_id: id });
  expect(removed.isError, removed.text).toBe(false);
  expect(one(`SELECT deleted_at IS NOT NULL FROM meal_plan_entries WHERE id = '${id}'`)).toBe("t");
  const again = await integ("DELETE", `/meals/${id}`);
  expect(again.status(), await again.text()).toBe(404);
  expect(one(`SELECT count(*) FROM meal_plan_entries WHERE id = '${id}'`)).toBe("1");
  expect(JSON.stringify((await tool("get_meal_plan", { start: "2030-01-07", end: "2030-01-13" })).json)).not.toContain(id);
});

// ── messages ───────────────────────────────────────────────────────────────

test("messages: five go through, the sixth in ten minutes is rate limited", async () => {
  test.setTimeout(180_000);
  try {
    for (let i = 1; i <= 5; i++) {
      const sent = await tool("send_message", { text: `${P}message ${i}` });
      expect(sent.isError, sent.text).toBe(false);
      expect(one(`SELECT body FROM messages WHERE id = '${sent.json.id}' AND family_id = '${fam()}'`)).toBe(`${P}message ${i}`);
      // Ruling 11: attributed to the connection, by its (at most 40-character) name.
      const label = one(`SELECT sender_label FROM messages WHERE id = '${sent.json.id}'`);
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(40);
      expect(one(`SELECT name FROM integration_tokens WHERE id = '${conn.tokenId}'`).startsWith(label.replace(/…$/, ""))).toBe(true);
    }
    const sixth = await integ("POST", "/messages", { text: `${P}message 6` });
    expect(sixth.status(), await sixth.text()).toBe(429);
    expect((await sixth.json()).code).toBe("rate_limited");
    expect(Number(sixth.headers()["retry-after"])).toBeGreaterThan(0);
    expect(one(`SELECT count(*) FROM messages WHERE family_id = '${fam()}' AND body LIKE '${P}message%'`)).toBe("5");
  } finally {
    // Now, not in afterAll: a message stays on every screen until someone
    // acknowledges it, and the overlay check below needs a clear screen.
    psql(`DELETE FROM messages WHERE family_id = '${fam()}' AND body LIKE '${P}%'`);
  }
});

// ── home ───────────────────────────────────────────────────────────────────

const status = (requestId: string) => one(`SELECT status FROM assistant_action_requests WHERE id = '${requestId}'`);

async function decide(ctx: APIRequestContext, requestId: string, body: Record<string, unknown>) {
  const res = await ctx.post(`/api/assistant-actions/${requestId}`, { data: body });
  return { status: res.status(), body: await res.json() };
}

test("home: catalogue only, run or confirm, approve with the PIN, deny without it", async () => {
  test.setTimeout(300_000);

  // Point the family's Home Assistant at the mock, through the route the
  // settings page saves with (the token goes to integration_secrets).
  haSettingBefore = psql(`SELECT value::text FROM settings WHERE family_id = '${fam()}' AND key = 'home_assistant'`) || null;
  haSecretBefore = psql(`SELECT value::text FROM integration_secrets WHERE family_id = '${fam()}' AND key = 'home_assistant'`) || null;
  const haUrl = await startMockHa();
  const saved = await api.put("/api/settings", {
    data: { family_id: fam(), key: "home_assistant", value: { url: haUrl, access_token: HA_TOKEN, dashboards: [] } },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  expect(one(`SELECT value ? 'access_token' FROM settings WHERE family_id = '${fam()}' AND key = 'home_assistant'`)).toBe("f");

  for (const [i, entityId] of CATALOGUE.entries()) {
    psql(`INSERT INTO catalogue_items (family_id, kind, entity_id, name, position) VALUES ('${fam()}', 'ha_entity', '${entityId}', '${P}${entityId.split(".")[1]}', ${900 + i})`);
  }

  // Exactly the catalogue: ours with their live state, nothing Home
  // Assistant has beyond it.
  const listed = await tool("list_home_devices");
  expect(listed.isError, listed.text).toBe(false);
  const devices = listed.json.devices as { entity_id: string; state: string | null; allowed_actions: { service: string; sensitive: boolean }[] }[];
  const catalogue = new Set(psql(`SELECT entity_id FROM catalogue_items WHERE family_id = '${fam()}' AND kind = 'ha_entity'`).split("\n"));
  for (const d of devices) expect(catalogue.has(d.entity_id), d.entity_id).toBe(true);
  for (const id of CATALOGUE) expect(devices.map((d) => d.entity_id)).toContain(id);
  expect(listed.text).not.toContain("not_in_catalogue");
  const byId = new Map(devices.map((d) => [d.entity_id, d]));
  expect(byId.get("lock.test_door")!.state).toBe("locked");
  const openCover = (id: string) => byId.get(id)!.allowed_actions.find((a) => a.service === "open_cover")!;
  expect(openCover("cover.test_blind").sensitive).toBe(false);
  expect(openCover("cover.test_garage").sensitive).toBe(true);
  expect(openCover("cover.test_unclassified").sensitive).toBe(true);

  // A light runs at once, exactly once, and is attributed to the assistant.
  const light = await tool("control_device", { entity_id: "light.test_lamp", service: "turn_on", data: { brightness_pct: 40 } });
  expect(light.isError, light.text).toBe(false);
  expect(light.json).toEqual({ status: "done" });
  expect(callsTo("light", "turn_on")).toEqual([{ domain: "light", service: "turn_on", body: { brightness_pct: 40, entity_id: "light.test_lamp" }, authorized: true }]);
  // Acting on one device read that device's state alone, not the whole list.
  expect(haStateReads).toContain("/api/states/light.test_lamp");
  expect(one(`SELECT status || '|' || client_name FROM assistant_action_requests WHERE token_id = '${conn.tokenId}' AND entity_id = 'light.test_lamp' AND service = 'turn_on'`))
    .toBe(`done|${one(`SELECT name FROM integration_tokens WHERE id = '${conn.tokenId}'`)}`);

  // The same Idempotency-Key twice runs it once; the second answer is the replay.
  const key = randomUUID();
  const first = await integ("POST", "/home/devices/light.test_lamp/actions", { service: "turn_off" }, key);
  expect(first.status(), await first.text()).toBe(200);
  const replay = await integ("POST", "/home/devices/light.test_lamp/actions", { service: "turn_off" }, key);
  expect(replay.status()).toBe(200);
  expect(replay.headers()["idempotent-replay"]).toBe("true");
  expect(callsTo("light", "turn_off")).toHaveLength(1);

  // Outside the catalogue: not found, and Home Assistant hears nothing.
  const outside = await tool("control_device", { entity_id: "switch.not_in_catalogue", service: "turn_on" });
  expect(outside.isError).toBe(true);
  expect(outside.text).toContain("No such device");
  const restart = await tool("control_device", { entity_id: "homeassistant.restart", service: "restart" });
  expect(restart.isError).toBe(true);
  const restartOnLamp = await tool("control_device", { entity_id: "light.test_lamp", service: "restart" });
  expect(restartOnLamp.isError).toBe(true);
  expect(restartOnLamp.text).toContain("is not an action an assistant may run");
  expect(haCalls.filter((c) => c.domain === "switch" || c.domain === "homeassistant" || c.service === "restart")).toEqual([]);

  // A blind moves at once; a cover with no device class waits for a person.
  const blind = await tool("control_device", { entity_id: "cover.test_blind", service: "open_cover" });
  expect(blind.json).toEqual({ status: "done" });
  expect(callsTo("cover", "open_cover", "cover.test_blind")).toHaveLength(1);
  const unclassified = await tool("control_device", { entity_id: "cover.test_unclassified", service: "open_cover" });
  expect(unclassified.isError, unclassified.text).toBe(false);
  expect(unclassified.json.status).toBe("pending_confirmation");
  expect(callsTo("cover", "open_cover", "cover.test_unclassified")).toHaveLength(0);

  // A screen that never entered the PIN cannot allow it, but can refuse it.
  const bystander = await pwRequest.newContext({ baseURL: BASE });
  try {
    const joined = await bystander.post("/api/session/join", { data: { joinCode: FAMILY_CODE, hardwareId: `${P}bystander-${Date.now()}`, deviceName: `${P}bystander` } });
    expect(joined.ok(), await joined.text()).toBe(true);
    const noPin = await decide(bystander, unclassified.json.request_id, { decision: "approve" });
    expect(noPin.status, JSON.stringify(noPin.body)).toBe(400);
    const wrongPin = await decide(bystander, unclassified.json.request_id, { decision: "approve", pin: conn.pin === "0000" ? "1111" : "0000" });
    expect(wrongPin.status, JSON.stringify(wrongPin.body)).toBe(403);
    expect(wrongPin.body.error).toBe("pin_invalid");
    expect(status(unclassified.json.request_id)).toBe("pending");
    const denied = await decide(bystander, unclassified.json.request_id, { decision: "deny" });
    expect(denied.status, JSON.stringify(denied.body)).toBe(200);
    expect(denied.body.request.status).toBe("denied");
  } finally {
    await bystander.dispose();
  }
  expect(callsTo("cover", "open_cover", "cover.test_unclassified")).toHaveLength(0);
  expect((await tool("get_action_status", { request_id: unclassified.json.request_id })).json.action.status).toBe("denied");

  // An unlock waits — and shows up on a screen that is not the dashboard.
  // WebKit, because that is the engine layout differences hide in.
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE, serviceWorkers: "block", viewport: { width: 1440, height: 810 } });
    const page = await context.newPage();
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const failure = await page.evaluate(async ({ code, hardwareId }) => {
      const res = await fetch("/api/session/join", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinCode: code, hardwareId, deviceName: hardwareId }),
      });
      if (!res.ok) return `join failed: ${res.status}`;
      const data = await res.json();
      document.cookie = "family-calendar-storage=" + encodeURIComponent(JSON.stringify({ state: { family: data.family, device: data.device }, version: 0 })) + "; path=/; max-age=86400";
      return null;
    }, { code: FAMILY_CODE!, hardwareId: `${P}webkit-${Date.now()}` });
    expect(failure).toBeNull();
    // Opened first, so the page is compiled and listening before the request exists.
    await page.goto("/calendar", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("assistant-action-overlay")).toHaveCount(0);

    const unlock = await tool("control_device", { entity_id: "lock.test_door", service: "unlock" });
    expect(unlock.isError, unlock.text).toBe(false);
    expect(unlock.json.status).toBe("pending_confirmation");
    expect(callsTo("lock", "unlock")).toHaveLength(0);

    const overlay = page.getByTestId("assistant-action-overlay");
    await expect(overlay).toBeVisible({ timeout: 45_000 });
    await expect(overlay).toContainText(`${P}test_door`);
    // The assistant's self-chosen name is a label of at most 40 characters, not the sentence.
    const label = (await overlay.locator("[data-assistant-client]").first().textContent()) ?? "";
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(40);
    expect(new URL(page.url()).pathname).toBe("/calendar");
    await page.screenshot({ path: screenshotPath() });

    // Deny from this screen — it never entered the PIN.
    const denyLabels = [en, de, fr].map((m) => m.assistantActions.deny);
    await overlay.getByRole("button", { name: new RegExp(`^(${denyLabels.join("|")})$`) }).click();
    await expect.poll(() => status(unlock.json.request_id), { timeout: 15_000 }).toBe("denied");
    await expect(overlay).toHaveCount(0, { timeout: 15_000 });
    expect(callsTo("lock", "unlock")).toHaveLength(0);
    await context.close();
  } finally {
    await browser.close();
  }

  // A second unlock, allowed with the PIN: it runs exactly once.
  const unlock2 = await tool("control_device", { entity_id: "lock.test_door", service: "unlock" });
  expect(unlock2.json.status).toBe("pending_confirmation");
  expect(callsTo("lock", "unlock")).toHaveLength(0);
  const allowed = await decide(api, unlock2.json.request_id, { decision: "approve", pin: conn.pin });
  expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  expect(allowed.body.request.status).toBe("done");
  expect(callsTo("lock", "unlock")).toEqual([{ domain: "lock", service: "unlock", body: { entity_id: "lock.test_door" }, authorized: true }]);
  const unlockStatus = await tool("get_action_status", { request_id: unlock2.json.request_id });
  expect(unlockStatus.json.action).toMatchObject({ status: "done", entity_id: "lock.test_door", service: "unlock" });
  const again = await decide(api, unlock2.json.request_id, { decision: "approve", pin: conn.pin });
  expect(again.status).toBe(409);
  expect(callsTo("lock", "unlock")).toHaveLength(1);

  // A garage door taken off the catalogue while it waits is not opened.
  const garage = await tool("control_device", { entity_id: "cover.test_garage", service: "open_cover" });
  expect(garage.json.status).toBe("pending_confirmation");
  psql(`DELETE FROM catalogue_items WHERE family_id = '${fam()}' AND entity_id = 'cover.test_garage'`);
  const stale = await decide(api, garage.json.request_id, { decision: "approve", pin: conn.pin });
  expect(stale.status, JSON.stringify(stale.body)).toBe(200);
  expect(stale.body.request.status).toBe("failed");
  expect(stale.body.request.result?.reason).toBe("not_in_catalogue");
  expect(callsTo("cover", "open_cover", "cover.test_garage")).toHaveLength(0);
  expect((await tool("get_action_status", { request_id: garage.json.request_id })).json.action.status).toBe("failed");

  // Every call Home Assistant received carried the token, and there were exactly these.
  expect(haCalls.every((c) => c.authorized)).toBe(true);
  expect(haCalls.map((c) => `${c.domain}.${c.service} ${c.body.entity_id}`)).toEqual([
    "light.turn_on light.test_lamp",
    "light.turn_off light.test_lamp",
    "cover.open_cover cover.test_blind",
    "lock.unlock lock.test_door",
  ]);
});
