import { test, expect, request as pwRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dbContainer } from "./whole-database";
import { postJoin } from "./session";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";

/**
 * An assistant asking a parent to approve or decline a child's reward
 * request, end to end on a running server and the real database:
 * POST /rewards/requests/{id}/decision stores a confirmation and decides
 * nothing; a Kinboard screen allows it with the settings PIN through
 * POST /api/assistant-actions/{id}, which decides the reward request through
 * decide_point_redemption, as the rewards page's own Approve does; and the
 * overlay shows the child, the reward, the points and the decision on a
 * screen that is not the rewards page.
 *
 * Refused along the way, with nothing decided: the wrong scope, another
 * family's id, the wrong PIN, an expired request, a request answered in the
 * app first -- and the app and the screen deciding at the same moment
 * decide once.
 *
 * In two families of its own, `claude-rwd` and `claude-rwd-other`, created
 * here and removed afterwards with their tokens, devices, requests and
 * queued pushes. Needs a running stack: FAMILY_CODE says there is one.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const ID = (n: string) => `c1a0de00-0021-4000-8000-00000000${n}`;
const FAMILY = ID("f001");
const OTHER_FAMILY = ID("f002");
const MIRA = ID("f0a1");
const OTHER_CHILD = ID("f0a2");
const TABLET = ID("f0c1");
const OTHER_REWARD = ID("f0c2");
const JOIN_CODE = "CLAUDERWDN";
const PIN = "5172";
const DEVICE = "claude-rwd-screen";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  for (const fam of [FAMILY, OTHER_FAMILY]) {
    psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
      DELETE FROM assistant_action_requests WHERE family_id = '${fam}';
      DELETE FROM scheduled_notifications WHERE family_id = '${fam}';
      DELETE FROM integration_idempotency WHERE family_id = '${fam}';
      DELETE FROM integration_tokens WHERE family_id = '${fam}';
      DELETE FROM integration_secrets WHERE family_id = '${fam}';
      DELETE FROM devices WHERE family_id = '${fam}';
      DELETE FROM point_redemptions WHERE family_id = '${fam}';
      DELETE FROM point_rewards WHERE family_id = '${fam}';
      DELETE FROM todo_point_awards WHERE family_id = '${fam}';
      DELETE FROM creatures WHERE family_id = '${fam}';
      DELETE FROM people WHERE family_id = '${fam}';
      DELETE FROM settings WHERE family_id = '${fam}';
      DELETE FROM families WHERE id = '${fam}';`);
  }
  psql(`DELETE FROM devices WHERE hardware_id LIKE 'claude-rwd-%'`);
}

/**
 * A token of its own per test: confirmations are limited per assistant (2
 * waiting, 5 per 10 minutes), and this spec asks more often than that.
 */
function token(scopes: string[], family = FAMILY): string {
  const value = `kbi_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(value).digest("hex");
  psql(`INSERT INTO integration_tokens (family_id, name, token_hash, scopes)
    VALUES ('${family}', 'claude-rwd ${scopes.join(" ")}', '${hash}', ARRAY[${scopes.map((s) => `'${s}'`).join(",")}])`);
  return value;
}

let api: APIRequestContext;
let screen: APIRequestContext;
let screenDeviceId = "";

const post = (path: string, bearer: string, data: unknown, key: string = randomUUID()): Promise<APIResponse> =>
  api.post(`/api/integration/v1${path}`, { headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key }, data });
const actionStatus = async (bearer: string, id: string) =>
  (await (await api.get(`/api/integration/v1/actions/${id}`, { headers: { authorization: `Bearer ${bearer}` } })).json()).action;
const redemption = (id: string) => psql(`SELECT status FROM point_redemptions WHERE id = '${id}'`);
const confirmations = () => psql(`SELECT count(*) FROM assistant_action_requests WHERE family_id IN ('${FAMILY}', '${OTHER_FAMILY}')`);
const balance = () => Number(JSON.parse(psql(`SELECT point_person_totals('${FAMILY}', '${MIRA}')::text`)).balance);

/** A child's pending reward request, made as the child's own Redeem makes it. */
function childAsks(reward = TABLET, family = FAMILY, child = MIRA): string {
  return psql(`SELECT (request_person_point_redemption('${family}', '${child}', '${reward}', NULL))->'redemption'->>'id'`);
}

const decide = async (ctx: APIRequestContext, id: string, data: Record<string, unknown>) => {
  const res = await ctx.post(`/api/assistant-actions/${id}`, { data });
  return { status: res.status(), body: await res.json() };
};

test.beforeAll(async () => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES
      ('${FAMILY}', 'claude-rwd', '${JOIN_CODE}', true),
      ('${OTHER_FAMILY}', 'claude-rwd-other', 'CLAUDERWDO', true);
    INSERT INTO settings (family_id, key, value) VALUES ('${FAMILY}', 'locale', '"en"'::jsonb);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES
      ('${MIRA}', '${FAMILY}', 'claude-Mira', true, '#56B6E8'),
      ('${OTHER_CHILD}', '${OTHER_FAMILY}', 'claude-Other', true, '#56E88E');
    INSERT INTO creatures (person_id, family_id, species, style, enabled) VALUES
      ('${MIRA}', '${FAMILY}', 'dragon', 'gumdrop', true),
      ('${OTHER_CHILD}', '${OTHER_FAMILY}', 'cat', 'gumdrop', true);
    INSERT INTO point_rewards (id, family_id, title, cost_points, icon, active) VALUES
      ('${TABLET}', '${FAMILY}', 'claude-rwd 30 minutes of tablet time', 30, '📱', true),
      ('${OTHER_REWARD}', '${OTHER_FAMILY}', 'claude-rwd other family', 5, NULL, true);
    INSERT INTO todo_point_awards (family_id, person_id, points, completion_key) VALUES
      ('${FAMILY}', '${MIRA}', 1000, 'claude-rwd-start'),
      ('${OTHER_FAMILY}', '${OTHER_CHILD}', 100, 'claude-rwd-start');`);
  api = await pwRequest.newContext({ baseURL: BASE });

  // The family's PIN, set from one screen; a second screen confirms.
  const setter = await pwRequest.newContext({ baseURL: BASE });
  try {
    const first = await postJoin(setter, { joinCode: JOIN_CODE, hardwareId: "claude-rwd-setter", deviceName: "claude-rwd-setter" });
    expect(first.status(), await first.text()).toBe(200);
    expect((await setter.post("/api/pin", { data: { family_id: FAMILY, action: "set", pin: PIN } })).status()).toBe(200);
  } finally {
    await setter.dispose();
  }
  screen = await pwRequest.newContext({ baseURL: BASE });
  const joined = await postJoin(screen, { joinCode: JOIN_CODE, hardwareId: DEVICE, deviceName: DEVICE });
  expect(joined.status(), await joined.text()).toBe(200);
  screenDeviceId = (await joined.json()).device.id;
});

test.afterAll(async () => {
  await screen?.dispose();
  await api?.dispose();
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id IN ('${FAMILY}', '${OTHER_FAMILY}')`)).toBe("0");
});

test("the browser roles still only read the two tables a reward decision touches", () => {
  // Every write to either goes through the server: a screen's own token must
  // not be able to approve a confirmation, or a reward request, by UPDATE.
  // has_table_privilege, not information_schema: it sees grants made by any role.
  expect(psql(`SELECT string_agg(t || ':' || r || ':' || p, ' ' ORDER BY t, r, p)
    FROM unnest(ARRAY['assistant_action_requests', 'point_redemptions']) t,
         unnest(ARRAY['anon', 'authenticated']) r,
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
    WHERE has_table_privilege(r, 'public.' || t, p)`))
    .toBe("assistant_action_requests:authenticated:SELECT point_redemptions:authenticated:SELECT");
  expect(psql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'assistant_action_requests_kind_check'`))
    .toContain("'reward_decision'");
});

test("asking decides nothing: 202 pending_confirmation, the reward request still pending", async () => {
  const writer = token(["pocket_money:write"]);
  const id = childAsks();
  const before = balance();
  const res = await post(`/rewards/requests/${id}/decision`, writer, { decision: "approve" });
  expect(res.status(), await res.text()).toBe(202);
  const body = await res.json();
  expect(body).toMatchObject({
    status: "pending_confirmation", decision: "approve",
    reward_request: { id, person_id: MIRA, child_name: "claude-Mira", title: "claude-rwd 30 minutes of tablet time", cost_points: 30 },
  });
  expect(redemption(id)).toBe("pending");
  expect(balance()).toBe(before);
  expect(psql(`SELECT concat_ws('|', kind, status, data->>'redemption_id', data->>'decision', entity_id IS NULL)
    FROM assistant_action_requests WHERE id = '${body.request_id}'`)).toBe(`reward_decision|pending|${id}|approve|t`);
  const status = await actionStatus(writer, body.request_id);
  expect(status).toMatchObject({ kind: "reward_decision", status: "pending" });
  expect(status.description).toBe("approve claude-Mira’s reward “claude-rwd 30 minutes of tablet time” for 30 points");
  // A second ask on the same request while one waits: refused.
  const again = await post(`/rewards/requests/${id}/decision`, token(["pocket_money:write"]), { decision: "decline" });
  expect(again.status()).toBe(409);
  expect(await again.json()).toMatchObject({ reason: "already_asked" });
});

test("the wrong scope, and another family's id, are refused with nothing stored", async () => {
  const id = childAsks();
  const before = confirmations();
  for (const scopes of [["family:read"], ["home:control"], ["family:read", "tasks:write", "home:control"]]) {
    const res = await post(`/rewards/requests/${id}/decision`, token(scopes), { decision: "approve" });
    expect(res.status(), scopes.join(" ")).toBe(401);
  }
  const otherId = childAsks(OTHER_REWARD, OTHER_FAMILY, OTHER_CHILD);
  const cross = await post(`/rewards/requests/${otherId}/decision`, token(["pocket_money:write"]), { decision: "approve" });
  expect(cross.status()).toBe(404);
  const none = await post(`/rewards/requests/${randomUUID()}/decision`, token(["pocket_money:write"]), { decision: "approve" });
  expect(none.status()).toBe(404);
  expect(await cross.json()).toEqual(await none.json());
  expect(confirmations()).toBe(before);
  expect(redemption(otherId)).toBe("pending");
});

test("a screen with the wrong PIN cannot allow it; the right PIN decides it once, through the parent's own path", async () => {
  const writer = token(["pocket_money:write"]);
  const id = childAsks();
  const before = balance();
  const asked = await (await post(`/rewards/requests/${id}/decision`, writer, { decision: "approve" })).json();

  const wrong = await decide(screen, asked.request_id, { decision: "approve", pin: "0000" });
  expect(wrong.status).toBe(403);
  expect(wrong.body.error).toBe("pin_invalid");
  const noPin = await decide(screen, asked.request_id, { decision: "approve" });
  expect(noPin.status).toBe(400);
  // A bearer token cannot use the screens' route at all.
  const bearer = await api.post(`/api/assistant-actions/${asked.request_id}`, {
    headers: { authorization: `Bearer ${writer}` }, data: { decision: "approve", pin: PIN },
  });
  expect(bearer.status()).toBe(401);
  expect(redemption(id)).toBe("pending");

  const allowed = await decide(screen, asked.request_id, { decision: "approve", pin: PIN });
  expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  expect(allowed.body.request.status).toBe("done");
  expect(psql(`SELECT concat_ws('|', status, decided_by_device_id) FROM point_redemptions WHERE id = '${id}'`))
    .toBe(`approved|${screenDeviceId}`);
  expect(balance()).toBe(before - 30);
  // The child hears about it as from the rewards page.
  expect(psql(`SELECT count(*) FROM scheduled_notifications WHERE family_id = '${FAMILY}'
    AND notification_type = 'reward_decided' AND related_entity_id = '${id}'`)).toBe("1");
  expect((await actionStatus(writer, asked.request_id)).status).toBe("done");

  // Replayed: already decided, and nothing more spent.
  const replay = await decide(screen, asked.request_id, { decision: "approve", pin: PIN });
  expect(replay.status).toBe(409);
  expect(balance()).toBe(before - 30);
  // And asking about it now says it was decided.
  const late = await post(`/rewards/requests/${id}/decision`, writer, { decision: "decline" });
  expect(late.status()).toBe(409);
  expect(await late.json()).toMatchObject({ reason: "already_decided", status: "approved" });
});

test("Deny on the screen leaves the reward request waiting; an allowed decline declines it", async () => {
  const writer = token(["pocket_money:write"]);
  const id = childAsks();
  const first = await (await post(`/rewards/requests/${id}/decision`, writer, { decision: "decline" })).json();
  const denied = await decide(screen, first.request_id, { decision: "deny" });
  expect(denied.body.request.status).toBe("denied");
  expect(redemption(id)).toBe("pending");
  const second = await (await post(`/rewards/requests/${id}/decision`, writer, { decision: "decline" })).json();
  const allowed = await decide(screen, second.request_id, { decision: "approve", pin: PIN });
  expect(allowed.body.request.status).toBe("done");
  expect(redemption(id)).toBe("denied");
});

test("answered in the app first: the confirmation fails and says so, the app's answer stands", async () => {
  const writer = token(["pocket_money:write"]);
  const id = childAsks();
  const asked = await (await post(`/rewards/requests/${id}/decision`, writer, { decision: "approve" })).json();
  // A parent declines it on the rewards page meanwhile.
  expect((await screen.post("/api/pin", { data: { family_id: FAMILY, action: "verify", pin: PIN } })).status()).toBe(200);
  const inApp = await screen.patch(`/api/rewards/redemptions/${id}`, { data: { status: "denied" } });
  expect(inApp.status(), await inApp.text()).toBe(200);
  const allowed = await decide(screen, asked.request_id, { decision: "approve", pin: PIN });
  expect(allowed.status).toBe(200);
  expect(allowed.body.request).toMatchObject({ status: "failed", result: { reason: "reward_already_decided" } });
  expect(redemption(id)).toBe("denied");
  expect((await actionStatus(writer, asked.request_id)).result.reason).toBe("reward_already_decided");
});

test("decided in the app and on a screen at the same moment: decided once", async () => {
  for (let round = 0; round < 3; round++) {
    const writer = token(["pocket_money:write"]);
    const id = childAsks();
    const before = balance();
    const asked = await (await post(`/rewards/requests/${id}/decision`, writer, { decision: "approve" })).json();
    const [inApp, onScreen] = await Promise.all([
      screen.patch(`/api/rewards/redemptions/${id}`, { data: { status: "approved" } }),
      decide(screen, asked.request_id, { decision: "approve", pin: PIN }),
    ]);
    const appWon = inApp.status() === 200;
    const screenWon = onScreen.body.request?.status === "done";
    expect(Number(appWon) + Number(screenWon), `round ${round}: app ${inApp.status()}, screen ${JSON.stringify(onScreen.body)}`).toBe(1);
    if (!screenWon) expect(onScreen.body.request.result.reason).toBe("reward_already_decided");
    if (!appWon) expect(inApp.status()).toBe(409);
    expect(redemption(id)).toBe("approved");
    expect(balance()).toBe(before - 30);
  }
});

test("expired: refused even with the right PIN, nothing decided", async () => {
  const writer = token(["pocket_money:write"]);
  const id = childAsks();
  const asked = await (await post(`/rewards/requests/${id}/decision`, writer, { decision: "approve" })).json();
  psql(`UPDATE assistant_action_requests SET expires_at = now() - interval '1 second' WHERE id = '${asked.request_id}'`);
  const late = await decide(screen, asked.request_id, { decision: "approve", pin: PIN });
  expect(late.status).toBe(409);
  expect(late.body.error).toBe("expired");
  expect(redemption(id)).toBe("pending");
  expect((await actionStatus(writer, asked.request_id)).status).toBe("expired");
});

test("the screen shows who asked, the child, the reward, the points and the decision; the PIN allows it", async ({ page }) => {
  test.setTimeout(240_000);
  const writer = token(["pocket_money:write"]);
  // Only this test's request on the screen: earlier ones may still be waiting.
  psql(`UPDATE assistant_action_requests SET status = 'expired' WHERE family_id = '${FAMILY}' AND status = 'pending'`);
  const id = childAsks();

  const hardwareId = `claude-rwd-browser-${Date.now()}`;
  const joined = await postJoin(page.request, { joinCode: JOIN_CODE, hardwareId, deviceName: hardwareId });
  expect(joined.ok(), await joined.text()).toBe(true);
  const data = await joined.json();
  await page.context().addCookies([{
    name: "family-calendar-storage",
    value: encodeURIComponent(JSON.stringify({ state: { family: data.family, device: data.device }, version: 0 })),
    url: BASE,
  }]);
  await page.goto("/calendar", { waitUntil: "domcontentloaded" });
  const overlay = page.getByTestId("assistant-action-overlay");
  await expect(overlay).toHaveCount(0);

  const asked = await (await post(`/rewards/requests/${id}/decision`, writer, { decision: "approve" })).json();
  // The screens poll every 10 s and refetch on realtime; a first compile of the route adds to it.
  await expect(overlay).toBeVisible({ timeout: 90_000 });
  const card = overlay.locator(`[data-assistant-action="${asked.request_id}"]`);
  await expect(card.locator("[data-assistant-client]")).toHaveText(/claude-rwd pocket_money:write/);
  const details = card.locator("[data-reward-decision]");
  await expect(details).toHaveAttribute("data-reward-decision", "approve");
  await expect(details).toContainText("claude-Mira");
  await expect(details).toContainText("claude-rwd 30 minutes of tablet time");
  await expect(details).toContainText("30");
  await expect(card).toContainText("approve claude-Mira’s reward");
  expect(new URL(page.url()).pathname).toBe("/calendar");
  await page.screenshot({ path: test.info().outputPath("reward-decision-overlay.png") });

  await card.locator(`#assistant-action-pin-${asked.request_id}`).fill(PIN);
  const allow = [en, de, fr].map((m) => m.assistantActions.allow).join("|");
  await card.getByRole("button", { name: new RegExp(`^(${allow})$`) }).click();
  await expect.poll(() => redemption(id), { timeout: 60_000 }).toBe("approved");
  // The card goes once the request is no longer pending. Its "Allowed, and
  // done." notice is not asserted: when realtime removes the card before the
  // decision's own answer arrives, the notice never shows -- for every kind,
  // home actions included (left as it is here; see the PR).
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  expect(psql(`SELECT decided_by_device_id FROM point_redemptions WHERE id = '${id}'`)).toBe(data.device.id);
});
