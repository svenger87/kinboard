import { test, expect, request as pwRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dbContainer } from "./whole-database";
import { postJoin } from "./session";

/**
 * Points, creatures and rewards through the Integration API, end to end on a
 * running server and the real database: GET /rewards against
 * point_person_totals, POST /rewards/requests asking exactly as a child does
 * (a pending row, a push queued for the parents), the scopes refusing what
 * they must, idempotent replay, and a parent's decision on the session route
 * with the PIN -- which queues the child's push -- while no integration token
 * can decide at all.
 *
 * In a family of its own, `claude-rwi`, created here and removed afterwards
 * with its tokens, devices, requests and queued pushes. It never calls the
 * push processor: that would send whatever another family has queued. The
 * processor's audience and quiet-hours rules are e2e/reward-notifications.spec.ts.
 * Needs a running stack: FAMILY_CODE says there is one.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const ID = (n: string) => `c1a0de00-0019-4000-8000-00000000${n}`;
const FAMILY = ID("f001");
const MIA = ID("f0a1");
const BEN = ID("f0a2");
const NO_CREATURE = ID("f0a3");
const PARENT = ID("f0b1");
const MINECRAFT = ID("f0c1");
const CINEMA = ID("f0c2");
const JOIN_CODE = "CLAUDERWIN";
const DEVICE = "claude-rwi-parent";
const PIN = "6284";
const CREATURE_NAME = "claude-Funkel";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM scheduled_notifications WHERE family_id = '${FAMILY}';
    DELETE FROM integration_idempotency WHERE family_id = '${FAMILY}';
    DELETE FROM integration_tokens WHERE family_id = '${FAMILY}';
    DELETE FROM integration_secrets WHERE family_id = '${FAMILY}';
    DELETE FROM devices WHERE family_id = '${FAMILY}' OR hardware_id IN ('e2e-${DEVICE}', 'e2e-${DEVICE}-setter');
    DELETE FROM point_redemptions WHERE family_id = '${FAMILY}';
    DELETE FROM point_purchases WHERE family_id = '${FAMILY}';
    DELETE FROM point_rewards WHERE family_id = '${FAMILY}';
    DELETE FROM todo_point_awards WHERE family_id = '${FAMILY}';
    DELETE FROM creatures WHERE family_id = '${FAMILY}';
    DELETE FROM people WHERE family_id = '${FAMILY}';
    DELETE FROM settings WHERE family_id = '${FAMILY}';
    DELETE FROM families WHERE id = '${FAMILY}';`);
}

function token(scopes: string[]): string {
  const value = `kbi_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(value).digest("hex");
  psql(`INSERT INTO integration_tokens (family_id, name, token_hash, scopes)
    VALUES ('${FAMILY}', 'claude-rwi ${scopes.join(" ")}', '${hash}', ARRAY[${scopes.map((s) => `'${s}'`).join(",")}])`);
  return value;
}

let api: APIRequestContext;
let readToken = "";
let writeToken = "";

test.beforeAll(async () => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-rwi', '${JOIN_CODE}', true);
    INSERT INTO settings (family_id, key, value) VALUES ('${FAMILY}', 'locale', '"en"'::jsonb);
    INSERT INTO people (id, family_id, name, is_child, color, created_at) VALUES
      ('${MIA}', '${FAMILY}', 'claude-Mia', true, '#56B6E8', now() - interval '3 days'),
      ('${BEN}', '${FAMILY}', 'claude-Ben', true, '#56E88E', now() - interval '2 days'),
      ('${NO_CREATURE}', '${FAMILY}', 'claude-Ida', true, '#E85656', now() - interval '1 day'),
      ('${PARENT}', '${FAMILY}', 'claude-Mum', false, '#8E56E8', now());
    INSERT INTO creatures (person_id, family_id, species, style, look, enabled) VALUES
      ('${MIA}', '${FAMILY}', 'dragon', 'gumdrop', '{"name": "${CREATURE_NAME}", "body": "#FF8A5B"}'::jsonb, true),
      ('${BEN}', '${FAMILY}', 'unicorn', 'gumdrop', '{"name": "${CREATURE_NAME}"}'::jsonb, true);
    INSERT INTO point_rewards (id, family_id, title, cost_points, icon, active) VALUES
      ('${MINECRAFT}', '${FAMILY}', 'claude-rwi Minecraft', 50, '🎮', true),
      ('${CINEMA}', '${FAMILY}', 'claude-rwi Cinema', 500, '🎬', true);
    INSERT INTO todo_point_awards (family_id, person_id, points, completion_key)
      VALUES ('${FAMILY}', '${MIA}', 120, 'claude-rwi-start');`);
  readToken = token(["family:read"]);
  writeToken = token(["pocket_money:write"]);
  api = await pwRequest.newContext({ baseURL: BASE });
});

test.afterAll(async () => {
  await api?.dispose();
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id = '${FAMILY}'`)).toBe("0");
});

const get = (path: string, bearer: string) =>
  api.get(`/api/integration/v1${path}`, { headers: { authorization: `Bearer ${bearer}` } });
const post = (path: string, bearer: string, data: unknown, key: string | null = randomUUID()): Promise<APIResponse> =>
  api.post(`/api/integration/v1${path}`, {
    headers: { authorization: `Bearer ${bearer}`, ...(key ? { "idempotency-key": key } : {}) },
    data,
  });
const pendingCount = () => psql(`SELECT count(*) FROM point_redemptions WHERE family_id = '${FAMILY}' AND status = 'pending'`);
const queued = (type: string) => psql(`SELECT count(*) FROM scheduled_notifications WHERE family_id = '${FAMILY}' AND notification_type = '${type}'`);

test("GET /rewards: the database's points, each creature's stage, the catalogue -- and never the creature's look", async () => {
  const res = await get("/rewards", readToken);
  expect(res.status(), await res.text()).toBe(200);
  const text = await res.text();
  const body = JSON.parse(text);
  expect(body.children.map((c: { name: string }) => c.name)).toEqual(["claude-Mia", "claude-Ben"]);
  const totals = JSON.parse(psql(`SELECT point_person_totals('${FAMILY}', '${MIA}')::text`));
  expect(body.children[0].points).toEqual({
    balance: totals.balance, earned: totals.earned, owed: totals.owed, pending: totals.pending,
    available: totals.balance - totals.pending, purchased: totals.purchased ?? 0,
  });
  expect(body.children[0].creature).toEqual({
    species: "dragon", stage: 2, stage_name: "Hatchling", grows_with: "points",
    next_stage: { stage: 3, stage_name: "Lizard", at: 150, unit: "points" },
  });
  expect(body.rewards.map((r: { title: string }) => r.title)).toEqual(["claude-rwi Minecraft", "claude-rwi Cinema"]);
  expect(body.pending).toEqual([]);
  expect(body.locale).toBe("en");
  expect(text).not.toContain(CREATURE_NAME);
  expect(text).not.toContain("#FF8A5B");
  // pocket_money:write alone does not read.
  expect((await get("/rewards", writeToken)).status()).toBe(401);
});

test("family:read cannot ask: 401, nothing stored, nothing queued", async () => {
  const res = await post("/rewards/requests", readToken, { child: "claude-Mia", reward: "claude-rwi Minecraft" });
  expect(res.status()).toBe(401);
  expect(pendingCount()).toBe("0");
  expect(queued("reward_requested")).toBe("0");
});

test("pocket_money:write asks, by name, exactly as the child would; the parents' push is queued", async () => {
  const key = randomUUID();
  const res = await post("/rewards/requests", writeToken, { child: "CLAUDE-mia", reward: "claude-rwi minecraft" }, key);
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  expect(body).toMatchObject({
    status: "pending_approval",
    redemption: { person_id: MIA, child_name: "claude-Mia", reward_id: MINECRAFT, title: "claude-rwi Minecraft", icon: "🎮", cost_points: 50 },
  });
  expect(psql(`SELECT concat_ws('|', person_id, status, cost_points, coalesce(requested_by_device_id::text, 'nobody'))
    FROM point_redemptions WHERE id = '${body.redemption.id}'`)).toBe(`${MIA}|pending|50|nobody`);
  const push = JSON.parse(psql(`SELECT data::text FROM scheduled_notifications
    WHERE family_id = '${FAMILY}' AND notification_type = 'reward_requested' AND related_entity_id = '${body.redemption.id}'`));
  expect(push).toEqual({
    redemption_id: body.redemption.id, person_id: MIA, child_name: "claude-Mia",
    reward_title: "claude-rwi Minecraft", reward_icon: "🎮", cost_points: "50",
  });
  expect(JSON.stringify(push)).not.toContain(CREATURE_NAME);

  // Replayed with the same key: the same answer, no second request.
  const again = await post("/rewards/requests", writeToken, { child: "CLAUDE-mia", reward: "claude-rwi minecraft" }, key);
  expect(again.status()).toBe(201);
  expect(again.headers()["idempotent-replay"]).toBe("true");
  expect((await again.json()).redemption.id).toBe(body.redemption.id);
  // The same key with other arguments: refused.
  expect((await post("/rewards/requests", writeToken, { child: MIA, reward: CINEMA }, key)).status()).toBe(409);
  expect(pendingCount()).toBe("1");
  expect(queued("reward_requested")).toBe("1");

  // It shows as waiting, and holds its points.
  const view = await (await get("/rewards", readToken)).json();
  expect(view.pending).toHaveLength(1);
  expect(view.children[0].points).toMatchObject({ balance: 120, pending: 50, available: 70 });
});

test("refusals: no key, unknown child, no creature, not enough points -- nothing stored, nothing queued", async () => {
  expect((await post("/rewards/requests", writeToken, { child: MIA, reward: MINECRAFT }, null)).status()).toBe(400);
  const unknown = await post("/rewards/requests", writeToken, { child: "claude-Nobody", reward: MINECRAFT });
  expect(unknown.status()).toBe(400);
  expect(await unknown.json()).toMatchObject({ reason: "no_child" });
  const grownUp = await post("/rewards/requests", writeToken, { child: PARENT, reward: MINECRAFT });
  expect(await grownUp.json()).toMatchObject({ reason: "no_child" });
  const noCreature = await post("/rewards/requests", writeToken, { child: NO_CREATURE, reward: MINECRAFT });
  expect(noCreature.status()).toBe(409);
  expect(await noCreature.json()).toMatchObject({ reason: "no_creature" });
  const tooDear = await post("/rewards/requests", writeToken, { child: MIA, reward: CINEMA });
  expect(tooDear.status()).toBe(409);
  expect(await tooDear.json()).toMatchObject({ reason: "insufficient_points", balance: 120, pending: 50 });
  expect(pendingCount()).toBe("1");
  expect(queued("reward_requested")).toBe("1");
});

test("no token decides: the session route refuses a bearer token; a parent with the PIN approves, and the child's push is queued", async () => {
  const id = psql(`SELECT id FROM point_redemptions WHERE family_id = '${FAMILY}' AND status = 'pending'`);
  for (const bearer of [readToken, writeToken]) {
    const res = await api.patch(`/api/rewards/redemptions/${id}`, {
      headers: { authorization: `Bearer ${bearer}` }, data: { status: "approved" },
    });
    expect(res.status()).toBe(401);
  }
  expect(psql(`SELECT status FROM point_redemptions WHERE id = '${id}'`)).toBe("pending");

  // The family's PIN, set from one screen; a second screen of the family is
  // refused until it types it, then approves.
  const setter = await pwRequest.newContext({ baseURL: BASE });
  const screen = await pwRequest.newContext({ baseURL: BASE });
  try {
    const first = await postJoin(setter, { joinCode: JOIN_CODE, hardwareId: `e2e-${DEVICE}-setter`, deviceName: `${DEVICE}-setter` });
    expect(first.status(), await first.text()).toBe(200);
    expect((await setter.post("/api/pin", { data: { family_id: FAMILY, action: "set", pin: PIN } })).status()).toBe(200);
    const join = await postJoin(screen, { joinCode: JOIN_CODE, hardwareId: `e2e-${DEVICE}`, deviceName: DEVICE });
    expect(join.status(), await join.text()).toBe(200);
    const locked = await screen.patch(`/api/rewards/redemptions/${id}`, { data: { status: "approved" } });
    expect(locked.status()).toBe(403);
    expect(psql(`SELECT status FROM point_redemptions WHERE id = '${id}'`)).toBe("pending");
    expect(queued("reward_decided")).toBe("0");
    const verify = await screen.post("/api/pin", { data: { family_id: FAMILY, action: "verify", pin: PIN } });
    expect((await verify.json()).valid).toBe(true);
    const approved = await screen.patch(`/api/rewards/redemptions/${id}`, { data: { status: "approved" } });
    expect(approved.status(), await approved.text()).toBe(200);
  } finally {
    await setter.dispose();
    await screen.dispose();
  }
  const push = JSON.parse(psql(`SELECT data::text FROM scheduled_notifications
    WHERE family_id = '${FAMILY}' AND notification_type = 'reward_decided' AND related_entity_id = '${id}'`));
  expect(push).toEqual({
    redemption_id: id, target_person_id: MIA, status: "approved",
    reward_title: "claude-rwi Minecraft", reward_icon: "🎮", cost_points: "50",
  });
  const view = await (await get("/rewards", readToken)).json();
  expect(view.pending).toEqual([]);
  expect(view.children[0].points).toMatchObject({ balance: 70, pending: 0, available: 70 });
});

test("a shop purchase comes through: purchased from point_person_totals, and the balance net of it", async () => {
  psql(`INSERT INTO point_purchases (family_id, person_id, item_id, cost) VALUES ('${FAMILY}', '${MIA}', 'cap', 25)`);
  const totals = JSON.parse(psql(`SELECT point_person_totals('${FAMILY}', '${MIA}')::text`));
  expect(totals.purchased).toBe(25);
  const view = await (await get("/rewards", readToken)).json();
  // 120 earned - 50 approved - 25 bought.
  expect(view.children[0].points).toEqual({ balance: 45, earned: 120, owed: 0, pending: 0, available: 45, purchased: 25 });
  // What was bought (and so what the creature wears) is never named.
  expect(JSON.stringify(view)).not.toContain("cap");
});
