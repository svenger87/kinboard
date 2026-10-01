import { test, expect, request as pwRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Client } from "@modelcontextprotocol/client";
import {
  callTool, connectAssistant, disconnectAssistant, mcpClient, newConnectState, psql, psqlRow, sqlText,
  type Connection,
} from "./helpers/assistant-connect";

/**
 * RFC-012 end to end: every route the assistant-coverage work added, called
 * over HTTP on a running server with a token from the real OAuth flow, and
 * checked in the real database — recipes, timers, the recycle bin, rich
 * tasks, calendar search, the timetable, birthdays, pocket money confirmed
 * with the PIN on the session route, energy against a mock Home Assistant,
 * countdowns, screen messages and attention.
 *
 * It also pins the route-level behaviour the unit specs could only check
 * through the libraries: idempotent replay and 409 on a reused key, 404 for
 * another family's ids, 429 at the timer cap, the shopping list refusing
 * task fields, the energy 404/502 branches, a withdrawal request for another
 * account's goal, and a second approval answering already_decided.
 *
 * Gated like assistant-actions-live: needs a running stack and FAMILY_CODE,
 * with PLAYWRIGHT_BASE_URL pointing at the server under test. It does not
 * touch that family: it makes two families of its own (`claude-cov-*`), so
 * it sets its own PIN and never reads a real one, and deletes both — rows in
 * the recycle bin included — in afterAll, with any `claude-%` device.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
test.describe.configure({ mode: "serial" });

const P = "claude-cov-";
const SCOPES = [
  "family:read", "tasks:write", "shopping:write", "calendar:write", "notes:read", "notes:write",
  "meals:write", "announcements:write", "energy:read", "timers:write", "birthdays:write", "pocket_money:write",
];
const PIN = "5172";

// ── the mock Home Assistant (energy) ───────────────────────────────────────

const HA_TOKEN = "claude-cov-ha-token";
let haMode: "ok" | "error" = "ok";
let haStatesReads = 0;
let haServer: http.Server | null = null;
const HA_STATES = [
  { entity_id: "sensor.claude_solar", state: "1234", attributes: { unit_of_measurement: "W" }, last_updated: "2026-10-01T10:00:00+00:00" },
  { entity_id: "sensor.claude_soc", state: "unavailable", attributes: { unit_of_measurement: "%" }, last_updated: "2026-10-01T10:00:00+00:00" },
  { entity_id: "sensor.claude_grid", state: "-250.5", attributes: { unit_of_measurement: "W" }, last_updated: "2026-10-01T10:00:00+00:00" },
  // Not configured, and must never appear in an answer.
  { entity_id: "sensor.claude_unconfigured", state: "999", attributes: { unit_of_measurement: "W" } },
  { entity_id: "lock.claude_front_door", state: "unlocked", attributes: {} },
];

async function startMockHa(): Promise<string> {
  haServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== `Bearer ${HA_TOKEN}`) {
      res.statusCode = 401;
      res.end("{}");
      return;
    }
    if (req.method === "GET" && req.url === "/api/states") {
      haStatesReads++;
      if (haMode === "error") {
        res.statusCode = 500;
        res.end("{}");
      } else {
        res.end(JSON.stringify(HA_STATES));
      }
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => haServer!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(haServer!.address() as AddressInfo).port}`;
}

// ── fixtures ───────────────────────────────────────────────────────────────

const state = newConnectState();
let api: APIRequestContext;
let conn: Connection;
let client: Client;
let famA = "";
let famB = "";
const ids: Record<string, string> = {};

// The Integration API allows 30 writes a minute per token; wait instead of
// collecting a 429 that would say nothing about the feature under test.
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

async function integ(
  method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, key?: string | null,
): Promise<APIResponse> {
  if (method !== "GET") await spendWrite();
  return api.fetch(`/api/integration/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${conn.accessToken}`,
      ...(method === "POST" && key !== null ? { "idempotency-key": key ?? randomUUID() } : {}),
    },
    ...(body !== undefined ? { data: body } : {}),
  });
}

async function json(res: APIResponse, status: number): Promise<any> {
  const text = await res.text();
  expect(res.status(), text).toBe(status);
  return text ? JSON.parse(text) : null;
}

const one = (sql: string) => psql(sql);
const insert = (sql: string) => psqlRow(sql);
/** A day `n` days from today, as YYYY-MM-DD (UTC; the tests keep well clear of midnight edges). */
const dayFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Purge both families: soft-deleted tables twice (the first DELETE only bins), then the families. */
function purgeFamilies(): void {
  const fams = [famA, famB].filter(Boolean).map(sqlText).join(", ");
  if (!fams) return;
  for (let i = 0; i < 2; i++) {
    for (const table of ["todos", "notes", "birthdays", "recipes", "people"]) {
      psql(`DELETE FROM ${table} WHERE family_id IN (${fams})`);
    }
    psql(`DELETE FROM pocket_money_goals WHERE account_id IN (SELECT id FROM pocket_money_accounts WHERE family_id IN (${fams}))`);
    psql(`DELETE FROM meal_plan_entries WHERE meal_plan_id IN (SELECT id FROM meal_plans WHERE family_id IN (${fams}))`);
  }
  psql(`DELETE FROM families WHERE id IN (${fams})`);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Leftovers from an aborted run.
  const stale = psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`);
  for (const id of stale.split(",").filter(Boolean)) {
    famA = id;
    purgeFamilies();
  }
  famA = "";

  const code = `CC${randomBytes(4).toString("hex").toUpperCase()}`;
  famA = insert(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
  famB = insert(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}foreign', 'CF${randomBytes(4).toString("hex").toUpperCase()}', true) RETURNING id`);

  ids.child = insert(`INSERT INTO people (family_id, name, is_child) VALUES ('${famA}', '${P}Enno', true) RETURNING id`);
  ids.parent = insert(`INSERT INTO people (family_id, name, is_child) VALUES ('${famA}', '${P}Parent', false) RETURNING id`);
  ids.foreignChild = insert(`INSERT INTO people (family_id, name, is_child) VALUES ('${famB}', '${P}Other', true) RETURNING id`);

  api = await pwRequest.newContext({ baseURL: BASE });
  const join = await api.post("/api/session/join", { data: { joinCode: code, hardwareId: `${P}api-${Date.now()}`, deviceName: `${P}api` } });
  expect(join.ok(), await join.text()).toBe(true);
  state.familyId = famA;
  conn = await connectAssistant(api, BASE, state, { scopes: SCOPES, clientName: `${P}live`, newPin: PIN });
  client = await mcpClient(BASE, conn.accessToken);
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await client?.close().catch(() => undefined);
  haServer?.close();
  if (conn?.tokenId) psql(`DELETE FROM assistant_action_requests WHERE token_id = '${conn.tokenId}'`);
  disconnectAssistant(state);
  purgeFamilies();
  psql("DELETE FROM devices WHERE hardware_id LIKE 'claude-%'");
  await api?.dispose();
  // Nothing of ours is left anywhere.
  expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  for (const table of ["people", "todos", "notes", "birthdays", "recipes", "timers", "settings", "integration_tokens"]) {
    expect(psql(`SELECT count(*) FROM ${table} WHERE family_id IN (${[famA, famB].map(sqlText).join(", ")})`), table).toBe("0");
  }
});

// ── MCP: the tools are there for this token ───────────────────────────────

test("mcp: the new tools are offered to a token with these scopes", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of [
    "search_recipes", "get_recipe", "add_recipe_to_shopping_list", "list_timers", "start_timer", "stop_timer",
    "list_deleted_items", "restore_task", "restore_note", "restore_meal", "restore_birthday",
    "search_calendar_events", "get_school_timetable", "list_birthdays", "add_birthday", "update_birthday",
    "delete_birthday", "list_pocket_money", "book_pocket_money", "get_action_status", "get_energy_status",
    "list_countdowns", "add_countdown", "delete_countdown", "list_screen_messages", "acknowledge_message",
    "list_attention_items", "dismiss_attention_item",
  ]) expect(names, name).toContain(name);
  // Listed, but refused without its scope.
  const home = await callTool(client, "list_home_devices", {});
  expect(home.isError).toBe(true);
  expect(home.text).toContain("home:read");
});

// ── recipes ────────────────────────────────────────────────────────────────

test("recipes: search, read, shop scaled; replay, 409 on a reused key, 404 for another family's", async () => {
  test.setTimeout(120_000);
  ids.recipe = insert(`INSERT INTO recipes (family_id, title, servings) VALUES ('${famA}', '${P}Lentil soup', 4) RETURNING id`);
  ids.ingLentils = insert(`INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, sort_order) VALUES ('${ids.recipe}', '${P}lentils', 250, 'g', 1) RETURNING id`);
  ids.ingOnion = insert(`INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, sort_order) VALUES ('${ids.recipe}', '${P}onion', 1, NULL, 2) RETURNING id`);
  ids.binnedRecipe = insert(`INSERT INTO recipes (family_id, title, deleted_at) VALUES ('${famA}', '${P}Binned soup', now()) RETURNING id`);
  ids.foreignRecipe = insert(`INSERT INTO recipes (family_id, title) VALUES ('${famB}', '${P}Foreign soup') RETURNING id`);

  const found = await json(await integ("GET", `/recipes?query=${encodeURIComponent("soup")}`), 200);
  expect(found.recipes.map((r: { id: string }) => r.id)).toEqual([ids.recipe]);

  const detail = await json(await integ("GET", `/recipes/${ids.recipe}`), 200);
  expect(JSON.stringify(detail)).toContain(`${P}lentils`);
  await json(await integ("GET", `/recipes/${ids.foreignRecipe}`), 404);
  await json(await integ("GET", `/recipes/${ids.binnedRecipe}`), 404);

  const key = randomUUID();
  const first = await json(await integ("POST", `/recipes/${ids.recipe}/shopping`, { servings: 8 }, key), 201);
  expect(first.added).toHaveLength(2);
  expect(one(`SELECT string_agg(name || '=' || coalesce(quantity::text, '-'), ',' ORDER BY name) FROM shopping_items WHERE family_id = '${famA}'`))
    .toBe(`${P}lentils=500.00,${P}onion=2.00`);

  const replay = await integ("POST", `/recipes/${ids.recipe}/shopping`, { servings: 8 }, key);
  expect(await json(replay, 201)).toEqual(first);
  expect(replay.headers()["idempotent-replay"]).toBe("true");
  expect(one(`SELECT count(*) FROM shopping_items WHERE family_id = '${famA}'`)).toBe("2");

  const conflict = await json(await integ("POST", `/recipes/${ids.recipe}/shopping`, { servings: 2 }, key), 409);
  expect(conflict.code).toBe("conflict");

  // Only what was picked; an id from another recipe adds nothing.
  await json(await integ("POST", `/recipes/${ids.recipe}/shopping`, { ingredient_ids: [ids.ingOnion] }), 201);
  await json(await integ("POST", `/recipes/${ids.recipe}/shopping`, { ingredient_ids: [randomUUID()] }), 400);
  await json(await integ("POST", `/recipes/${ids.foreignRecipe}/shopping`, {}), 404);
  expect(one(`SELECT count(*) FROM shopping_items WHERE family_id = '${famA}'`)).toBe("3");
  expect(one(`SELECT count(*) FROM shopping_items WHERE family_id = '${famB}'`)).toBe("0");
});

// ── timers ─────────────────────────────────────────────────────────────────

test("timers: start, list, stop; the 11th not-dismissed timer is 429", async () => {
  test.setTimeout(120_000);
  const started = await json(await integ("POST", "/timers", { duration_seconds: 600, label: `${P}pasta` }), 201);
  const timerId = started.timer.id as string;
  expect(started.timer).toMatchObject({ label: `${P}pasta`, state: "running" });
  const listed = await json(await integ("GET", "/timers"), 200);
  expect(listed.timers.map((t: { id: string }) => t.id)).toEqual([timerId]);

  await json(await integ("DELETE", `/timers/${timerId}`), 200);
  expect(one(`SELECT dismissed_at IS NOT NULL FROM timers WHERE id = '${timerId}'`)).toBe("t");
  await json(await integ("DELETE", `/timers/${timerId}`), 404);
  await json(await integ("POST", "/timers", { duration_seconds: 86_401 }), 400);

  // Nine more, set on a screen; the tenth through the API is still allowed.
  for (let i = 0; i < 9; i++) psql(`INSERT INTO timers (family_id, label, duration_seconds, started_at) VALUES ('${famA}', '${P}screen ${i}', 900, now())`);
  // A foreign family's timers never count.
  for (let i = 0; i < 3; i++) psql(`INSERT INTO timers (family_id, label, duration_seconds, started_at) VALUES ('${famB}', '${P}foreign ${i}', 900, now())`);
  await json(await integ("POST", "/timers", { duration_seconds: 60 }), 201);
  const capped = await json(await integ("POST", "/timers", { duration_seconds: 60 }), 429);
  expect(capped.code).toBe("too_many_timers");
  expect(one(`SELECT count(*) FROM timers WHERE family_id = '${famA}' AND dismissed_at IS NULL`)).toBe("10");

  // The cap is an assistant's: a token made by hand (Home Assistant's) starts
  // an eleventh, as the panel would.
  const manual = `kbi_${P}${randomBytes(16).toString("hex")}`;
  psql(`INSERT INTO integration_tokens (family_id, name, token_hash, scopes) VALUES ('${famA}', '${P}ha', '${createHash("sha256").update(manual).digest("hex")}', '{timers:write}')`);
  const byHand = await api.fetch("/api/integration/v1/timers", {
    method: "POST",
    headers: { authorization: `Bearer ${manual}`, "idempotency-key": randomUUID() },
    data: { duration_seconds: 60 },
  });
  await json(byHand, 201);
  expect(one(`SELECT count(*) FROM timers WHERE family_id = '${famA}' AND dismissed_at IS NULL`)).toBe("11");

  // One that rang more than an hour ago and was never dismissed stops
  // counting: with two of the eleven made stale, the assistant may start one.
  psql(`UPDATE timers SET started_at = now() - interval '2 hours' WHERE id IN (SELECT id FROM timers WHERE family_id = '${famA}' AND dismissed_at IS NULL AND label LIKE '${P}screen %' ORDER BY label LIMIT 2)`);
  await json(await integ("POST", "/timers", { duration_seconds: 60 }), 201);
  await json(await integ("POST", "/timers", { duration_seconds: 60 }), 429);
});

// ── recycle bin ────────────────────────────────────────────────────────────

test("recycle bin: delete a note, list it, restore it once; another family's is not found", async () => {
  test.setTimeout(120_000);
  const created = await json(await integ("POST", "/services/create_note", { text: `${P}note` }), 201);
  const noteId = created.id as string;
  await json(await integ("DELETE", `/notes/${noteId}`), 200);
  expect(one(`SELECT deleted_at IS NOT NULL FROM notes WHERE id = '${noteId}'`)).toBe("t");

  const bin = await json(await integ("GET", "/recycle-bin?type=note"), 200);
  expect(bin.items.map((i: { id: string }) => i.id)).toContain(noteId);
  await json(await integ("GET", "/recycle-bin?type=shopping"), 400);

  const restored = await json(await integ("POST", `/recycle-bin/note/${noteId}/restore`, undefined, null), 200);
  expect(restored).toEqual({ ok: true, type: "note", id: noteId });
  expect(one(`SELECT deleted_at IS NULL FROM notes WHERE id = '${noteId}'`)).toBe("t");
  await json(await integ("POST", `/recycle-bin/note/${noteId}/restore`, undefined, null), 404);

  const foreignNote = insert(`INSERT INTO notes (family_id, content, deleted_at) VALUES ('${famB}', '${P}foreign note', now()) RETURNING id`);
  await json(await integ("POST", `/recycle-bin/note/${foreignNote}/restore`, undefined, null), 404);
  expect(one(`SELECT deleted_at IS NOT NULL FROM notes WHERE id = '${foreignNote}'`)).toBe("t");
  await json(await integ("POST", `/recycle-bin/shopping/${noteId}/restore`, undefined, null), 404);
});

// ── tasks ──────────────────────────────────────────────────────────────────

test("tasks: a repeating task with points for a child; the shopping list refuses task fields", async () => {
  test.setTimeout(120_000);
  const created = await json(await integ("POST", "/lists/tasks", {
    summary: `${P}feed the cat`, person_id: ids.child, recurrence: "days:fr,mo", priority: "high", icon: "🐾", points: 5,
  }), 201);
  const taskId = created.id as string;
  expect(one(`SELECT person_id || '|' || recurrence || '|' || priority || '|' || icon || '|' || points FROM todos WHERE id = '${taskId}' AND family_id = '${famA}'`))
    .toBe(`${ids.child}|days:MO,FR|high|🐾|5`);

  // Someone from another family cannot be assigned, and nothing is stored.
  const foreign = await json(await integ("POST", "/lists/tasks", { summary: `${P}foreign`, person_id: ids.foreignChild }), 400);
  expect(foreign.error).toContain("no such person in this family");
  await json(await integ("POST", "/lists/tasks", { summary: `${P}bad`, recurrence: "fortnightly" }), 400);
  expect(one(`SELECT count(*) FROM todos WHERE family_id = '${famA}'`)).toBe("1");

  const edited = await integ("PATCH", `/lists/tasks/${taskId}`, { recurrence: "weekly", points: 7 });
  await json(edited, 200);
  expect(one(`SELECT recurrence || '|' || points FROM todos WHERE id = '${taskId}'`)).toBe("weekly|7");

  const item = await json(await integ("POST", "/lists/shopping", { summary: `${P}bread` }), 201);
  const itemId = item.id as string;
  for (const field of [{ points: 3 }, { recurrence: "daily" }, { priority: "high" }, { icon: "🐾" }, { person_id: ids.child }]) {
    const refused = await json(await integ("PATCH", `/lists/shopping/${itemId}`, field), 400);
    expect(refused.code, JSON.stringify(field)).toBe("invalid_request");
  }
  expect(one(`SELECT name FROM shopping_items WHERE id = '${itemId}'`)).toBe(`${P}bread`);
});

// ── calendar ───────────────────────────────────────────────────────────────

test("calendar: search by name finds this family's appointment only, and an event can be for someone", async () => {
  test.setTimeout(120_000);
  ids.calendar = insert(`INSERT INTO calendars (family_id, name) VALUES ('${famA}', '${P}calendar') RETURNING id`);
  const foreignCal = insert(`INSERT INTO calendars (family_id, name) VALUES ('${famB}', '${P}foreign calendar') RETURNING id`);
  const when = `${dayFromNow(10)}T09:00:00+00:00`;
  const until = `${dayFromNow(10)}T10:00:00+00:00`;
  psql(`INSERT INTO events (calendar_id, title, start_at, end_at) VALUES ('${foreignCal}', '${P}Zahnärztin Müller', '${when}', '${until}')`);

  const created = await json(await integ("POST", "/calendar/events", {
    calendar_id: ids.calendar, title: `${P}Zahnärztin Müller`, start_at: when, end_at: until, person_id: ids.child,
  }), 201);
  const eventId = created.event.id as string;
  expect(one(`SELECT person_id FROM events WHERE id = '${eventId}'`)).toBe(ids.child);

  const found = await json(await integ("GET", `/calendar/events?query=${encodeURIComponent("zahnÄRZTIN müller")}`), 200);
  expect(found.events.map((e: { id: string }) => e.id)).toEqual([eventId]);
  const none = await json(await integ("GET", `/calendar/events?query=${encodeURIComponent("x),title.not.is.null")}`), 200);
  expect(none.events).toEqual([]);
  await json(await integ("GET", `/calendar/events?query=dentist&start=${encodeURIComponent(when)}`), 400);
});

// ── timetable ──────────────────────────────────────────────────────────────

test("timetable: the week, a school day, a holiday and a weekend", async () => {
  test.setTimeout(120_000);
  // 2030-06-24 is a Monday; the holiday covers the following week.
  psql(`INSERT INTO schedules (family_id, person_id, day_of_week, time_slots) VALUES ('${famA}', '${ids.child}', 1, '[{"period":1,"start":"08:00","end":"08:45","subject":"${P}Maths","room":"101"}]')`);
  psql(`INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES ('${famA}', '${P}Summer', '2030-07-01', '2030-07-12')`);

  const week = await json(await integ("GET", "/schedule"), 200);
  expect(week.children).toHaveLength(1);
  expect(week.children[0]).toMatchObject({ person_id: ids.child, name: `${P}Enno` });
  expect(JSON.stringify(week)).toContain(`${P}Maths`);

  const term = await json(await integ("GET", "/schedule?day=2030-06-24"), 200);
  expect(term).toMatchObject({ date: "2030-06-24", school_day: true });
  expect(term.children[0].slots[0]).toMatchObject({ subject: `${P}Maths`, start: "08:00", room: "101" });

  // The holiday's last day is still a holiday.
  for (const day of ["2030-07-01", "2030-07-12"]) {
    const holiday = await json(await integ("GET", `/schedule?day=${day}`), 200);
    expect(holiday, day).toMatchObject({ school_day: false, reason: "holiday", children: [] });
  }
  const weekend = await json(await integ("GET", "/schedule?day=2030-06-29"), 200);
  expect(weekend).toMatchObject({ school_day: false, reason: "weekend" });
  await json(await integ("GET", `/schedule?person_id=${ids.foreignChild}`), 404);
});

// ── birthdays ──────────────────────────────────────────────────────────────

test("birthdays: add with replay and 409, refuse this year, delete and restore", async () => {
  test.setTimeout(120_000);
  const key = randomUUID();
  const body = { name: `${P}Oma`, date: "1950-03-04", person_id: ids.parent, notify_days_before: 3 };
  const created = await json(await integ("POST", "/birthdays", body, key), 201);
  const birthdayId = created.birthday.id as string;
  expect(created.birthday).toMatchObject({ name: `${P}Oma`, date: "1950-03-04", year_known: true, notify_days_before: 3 });

  const replay = await integ("POST", "/birthdays", body, key);
  expect(await json(replay, 201)).toEqual(created);
  expect(replay.headers()["idempotent-replay"]).toBe("true");
  await json(await integ("POST", "/birthdays", { ...body, name: `${P}Opa` }, key), 409);
  expect(one(`SELECT count(*) FROM birthdays WHERE family_id = '${famA}'`)).toBe("1");

  const thisYear = new Date().getUTCFullYear();
  const refused = await json(await integ("POST", "/birthdays", { name: `${P}Baby`, date: `${thisYear}-01-02` }), 400);
  expect(refused.error).toContain("--01-02");
  await json(await integ("POST", "/birthdays", { name: `${P}Future`, date: `${thisYear + 1}-01-02` }), 400);
  const yearless = await json(await integ("POST", "/birthdays", { name: `${P}Friend`, date: "--05-06" }), 201);
  expect(yearless.birthday).toMatchObject({ date: "--05-06", year_known: false, age: null });
  await json(await integ("POST", "/birthdays", { name: `${P}Foreign`, date: "--05-06", person_id: ids.foreignChild }), 400);

  await json(await integ("DELETE", `/birthdays/${birthdayId}`), 200);
  expect(one(`SELECT deleted_at IS NOT NULL FROM birthdays WHERE id = '${birthdayId}'`)).toBe("t");
  await json(await integ("DELETE", `/birthdays/${birthdayId}`), 404);
  expect(one(`SELECT count(*) FROM birthdays WHERE id = '${birthdayId}'`)).toBe("1");
  const listedWhileBinned = await json(await integ("GET", "/birthdays"), 200);
  expect(listedWhileBinned.birthdays.map((b: { id: string }) => b.id)).not.toContain(birthdayId);

  await json(await integ("POST", `/recycle-bin/birthday/${birthdayId}/restore`, undefined, null), 200);
  const listed = await json(await integ("GET", "/birthdays"), 200);
  expect(listed.birthdays.map((b: { id: string }) => b.id)).toContain(birthdayId);
});

// ── pocket money ───────────────────────────────────────────────────────────

test("pocket money: booking waits, the PIN approves it on the session route, balance moves once", async () => {
  test.setTimeout(120_000);
  ids.account = insert(`INSERT INTO pocket_money_accounts (family_id, person_id, currency, balance_cents) VALUES ('${famA}', '${ids.child}', 'EUR', 1000) RETURNING id`);
  ids.goal = insert(`INSERT INTO pocket_money_goals (account_id, name, target_amount_cents) VALUES ('${ids.account}', '${P}bike', 5000) RETURNING id`);
  const foreignAccount = insert(`INSERT INTO pocket_money_accounts (family_id, person_id, currency, balance_cents) VALUES ('${famB}', '${ids.foreignChild}', 'EUR', 1000) RETURNING id`);
  ids.foreignGoal = insert(`INSERT INTO pocket_money_goals (account_id, name, target_amount_cents) VALUES ('${foreignAccount}', '${P}foreign goal', 5000) RETURNING id`);

  const read = await json(await integ("GET", "/pocket-money"), 200);
  expect(read.accounts).toHaveLength(1);
  expect(JSON.stringify(read)).toContain(ids.child);
  expect(JSON.stringify(read)).not.toContain(ids.foreignChild);

  await json(await integ("POST", "/pocket-money/bookings", { person_id: ids.parent, amount: 1, type: "deposit" }), 400);
  await json(await integ("POST", "/pocket-money/bookings", { person_id: ids.foreignChild, amount: 1, type: "deposit" }), 404);
  await json(await integ("POST", "/pocket-money/bookings", { person_id: ids.child, amount: 10.01, type: "withdrawal" }), 400);

  const booked = await json(await integ("POST", "/pocket-money/bookings", { person_id: ids.child, amount: 2.5, type: "deposit", note: `${P}mowing` }), 202);
  expect(booked.status).toBe("pending_confirmation");
  const requestId = booked.request_id as string;
  expect(one(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${ids.account}'`)).toBe("1000");
  const pending = await json(await integ("GET", `/actions/${requestId}`), 200);
  expect(pending.action).toMatchObject({ status: "pending", kind: "pocket_money" });

  const wrong = await api.post(`/api/assistant-actions/${requestId}`, { data: { decision: "approve", pin: "0000" } });
  expect(wrong.status(), await wrong.text()).toBe(403);
  expect(one(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${ids.account}'`)).toBe("1000");

  const approved = await api.post(`/api/assistant-actions/${requestId}`, { data: { decision: "approve", pin: PIN } });
  expect(approved.status(), await approved.text()).toBe(200);
  expect((await approved.json()).request.status).toBe("done");
  expect(one(`SELECT balance_cents || '|' || lifetime_saved_cents FROM pocket_money_accounts WHERE id = '${ids.account}'`)).toBe("1250|250");
  expect(one(`SELECT string_agg(amount_cents || ' ' || type || ' ' || coalesce(note, ''), ',') FROM pocket_money_transactions WHERE account_id = '${ids.account}'`))
    .toBe(`250 manual_deposit ${P}mowing`);

  const again = await api.post(`/api/assistant-actions/${requestId}`, { data: { decision: "approve", pin: PIN } });
  expect(again.status(), await again.text()).toBe(409);
  expect((await again.json()).error).toBe("already_decided");
  expect(one(`SELECT count(*) FROM pocket_money_transactions WHERE account_id = '${ids.account}'`)).toBe("1");
  expect((await json(await integ("GET", `/actions/${requestId}`), 200)).action.status).toBe("done");

  // The RFC-001 service books with no PIN, so an assistant token never reaches it.
  const service = await json(await integ("POST", "/services/add_pocket_money", { person_id: ids.child, amount: 5 }), 403);
  expect(service.code).toBe("forbidden");
  expect(one(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${ids.account}'`)).toBe("1250");

  // A child's withdrawal request may only name one of its own account's goals.
  const foreignGoal = await api.post(`/api/pocket-money/accounts/${ids.account}/withdrawal-requests`, {
    data: { family_id: famA, amount_cents: 100, related_goal_id: ids.foreignGoal },
  });
  expect(foreignGoal.status(), await foreignGoal.text()).toBe(400);
  const ownGoal = await api.post(`/api/pocket-money/accounts/${ids.account}/withdrawal-requests`, {
    data: { family_id: famA, amount_cents: 100, related_goal_id: ids.goal },
  });
  expect(ownGoal.status(), await ownGoal.text()).toBe(201);
  expect(one(`SELECT count(*) FROM pocket_money_withdrawal_requests WHERE account_id = '${ids.account}'`)).toBe("1");
});

// ── energy ─────────────────────────────────────────────────────────────────

test("energy: configured sensors only, null for one Home Assistant lacks, 404 and 502", async () => {
  test.setTimeout(120_000);
  // No Home Assistant at all.
  await json(await integ("GET", "/energy/current"), 404);

  const haUrl = await startMockHa();
  const setEnergy = (config: Record<string, string>) => {
    psql(`DELETE FROM settings WHERE family_id = '${famA}' AND key = 'home_assistant'`);
    psql(`INSERT INTO settings (family_id, key, value) VALUES ('${famA}', 'home_assistant', ${sqlText(JSON.stringify({ url: haUrl, access_token: HA_TOKEN, dashboards: [], energy_config: config }))}::jsonb)`);
  };

  // Only non-sensor ids configured: nothing to read.
  setEnergy({ solar_power: "lock.claude_front_door" });
  const nothing = await json(await integ("GET", "/energy/current"), 404);
  expect(nothing.code).toBe("not_found");
  expect(haStatesReads).toBe(0);

  // A battery and grid, no solar; one configured sensor Home Assistant doesn't report.
  setEnergy({ battery_soc: "sensor.claude_soc", grid_power: "sensor.claude_grid", home_consumption: "sensor.claude_missing", battery_power: "lock.claude_front_door" });
  const partial = await json(await integ("GET", "/energy/current"), 200);
  expect(partial.solar_power).toBeNull();
  expect(partial.power.grid_power).toEqual({ value: -250.5, unit: "W", observed_at: "2026-10-01T10:00:00+00:00" });
  expect(partial.power.home_consumption).toBeNull();
  expect(partial.power.battery_power).toBeNull();
  expect(partial.battery_soc).toEqual({ value: null, unit: "%", observed_at: "2026-10-01T10:00:00+00:00" });
  const text = JSON.stringify(partial);
  for (const leak of ["claude_unconfigured", "999", "lock.", "unlocked"]) expect(text, leak).not.toContain(leak);
  expect(haStatesReads).toBe(1);

  // Solar keeps its original shape, entity id included.
  setEnergy({ solar_power: "sensor.claude_solar" });
  const solar = await json(await integ("GET", "/energy/current"), 200);
  expect(solar.solar_power).toEqual({ value: 1234, unit: "W", entity_id: "sensor.claude_solar", observed_at: "2026-10-01T10:00:00+00:00" });
  expect(solar.power.solar_power).toEqual({ value: 1234, unit: "W", observed_at: "2026-10-01T10:00:00+00:00" });

  haMode = "error";
  const down = await json(await integ("GET", "/energy/current"), 502);
  expect(down.code).toBe("upstream_unavailable");
  haMode = "ok";
});

// ── countdowns, messages, attention ────────────────────────────────────────

test("countdowns: add, list, delete permanently", async () => {
  test.setTimeout(120_000);
  const date = dayFromNow(30);
  const key = randomUUID();
  const added = await json(await integ("POST", "/countdowns", { title: `${P}holiday`, date, icon: "🏖️" }, key), 201);
  const countdownId = added.countdown.id as string;
  const replay = await integ("POST", "/countdowns", { title: `${P}holiday`, date, icon: "🏖️" }, key);
  expect(await json(replay, 201)).toEqual(added);
  await json(await integ("POST", "/countdowns", { title: `${P}past`, date: "2020-01-01" }), 400);
  await json(await integ("POST", "/countdowns", { title: `${P}icon`, date, icon: "💣" }), 400);

  const listed = await json(await integ("GET", "/countdowns"), 200);
  expect(listed.countdowns).toEqual([expect.objectContaining({ id: countdownId, title: `${P}holiday`, date, icon: "🏖️" })]);

  await json(await integ("DELETE", `/countdowns/${countdownId}`), 200);
  await json(await integ("DELETE", `/countdowns/${countdownId}`), 404);
  expect((await json(await integ("GET", "/countdowns"), 200)).countdowns).toEqual([]);
});

test("messages: list and acknowledge — the first acknowledgement stands; another family's is not found", async () => {
  test.setTimeout(120_000);
  const messageId = insert(`INSERT INTO messages (family_id, body, sender_label) VALUES ('${famA}', '${P}dinner at six', NULL) RETURNING id`);
  const foreignMessage = insert(`INSERT INTO messages (family_id, body) VALUES ('${famB}', '${P}foreign') RETURNING id`);

  const listed = await json(await integ("GET", "/messages"), 200);
  expect(listed.messages.map((m: { id: string }) => m.id)).toEqual([messageId]);

  const first = await json(await integ("POST", `/messages/${messageId}/acknowledge`, undefined, null), 200);
  expect(first.message).toMatchObject({ id: messageId, acknowledged: true });
  const at = one(`SELECT acknowledged_at FROM messages WHERE id = '${messageId}'`);
  expect(at).not.toBe("");
  const second = await json(await integ("POST", `/messages/${messageId}/acknowledge`, undefined, null), 200);
  expect(second.already_acknowledged).toBe(true);
  expect(one(`SELECT acknowledged_at FROM messages WHERE id = '${messageId}'`)).toBe(at);

  await json(await integ("POST", `/messages/${foreignMessage}/acknowledge`, undefined, null), 404);
  expect(one(`SELECT acknowledged_at IS NULL FROM messages WHERE id = '${foreignMessage}'`)).toBe("t");
});

test("attention: hints listed, a home hint only as a count without home:read, dismissed through the service", async () => {
  test.setTimeout(120_000);
  psql(`INSERT INTO attention_items (family_id, rule_id, item_key, title, detail, priority, state, message_key, params)
        VALUES ('${famA}', 'lock-up-before-bed', 'lock-up-before-bed:${P}day', '2 still open', 'binary_sensor.claude_back_door, cover.claude_garage', 80, 'active',
                'lock-up-before-bed', '{"count": 2, "entities": "binary_sensor.claude_back_door, cover.claude_garage"}')`);
  psql(`INSERT INTO attention_items (family_id, rule_id, item_key, title, priority, state)
        VALUES ('${famB}', 'lock-up-before-bed', 'lock-up-before-bed:${P}foreign', '${P}foreign', 80, 'active')`);

  const listed = await json(await integ("GET", "/attention"), 200);
  expect(listed.items).toHaveLength(1);
  expect(listed.items[0]).toMatchObject({ item_key: `lock-up-before-bed:${P}day`, rule_id: "lock-up-before-bed", title: "2 still open", detail: null });
  const text = JSON.stringify(listed);
  for (const leak of ["binary_sensor.", "cover.", "claude_back_door", "entities"]) expect(text, leak).not.toContain(leak);

  const dismissed = await integ("POST", "/services/dismiss_attention", { key: `lock-up-before-bed:${P}day` });
  expect(dismissed.status(), await dismissed.text()).toBeLessThan(300);
  expect((await json(await integ("GET", "/attention"), 200)).items).toEqual([]);
  expect(one(`SELECT state FROM attention_items WHERE family_id = '${famB}'`)).toBe("active");
});
