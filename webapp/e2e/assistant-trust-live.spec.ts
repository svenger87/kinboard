import { test, expect, request as pwRequest, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dbContainer } from "./whole-database";
import { postJoin } from "./session";
import en from "../messages/en.json";

/**
 * "Trust this assistant", end to end on a running server and the real
 * database: the switch in Settings → Integrations (PIN to switch on, none to
 * switch off, family-scoped, never reachable with an Integration API token);
 * a trusted assistant's pocket-money booking and reward decision running at
 * once through the confirm path, recorded as allowed by trust, with a quiet
 * notice on the screens that the assistant cannot acknowledge away; another
 * assistant still asking; and the trust gone after a revoke or a reconnect,
 * which the database itself enforces.
 *
 * Home Assistant actions are not run here (no Home Assistant on the test
 * stack): the home path is the same `submitActionRequest`, covered against
 * fakes in e2e/assistant-trust.spec.ts.
 *
 * In two families of its own, `claude-trust` and `claude-trust-other`,
 * created here and removed afterwards with their tokens, devices, requests,
 * messages and bookings. Needs a running stack: FAMILY_CODE says there is one.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const ID = (n: string) => `c1a0de00-0031-4000-8000-00000000${n}`;
const FAMILY = ID("f001");
const OTHER_FAMILY = ID("f002");
const MIRA = ID("f0a1");
const ACCOUNT = ID("f0b1");
const TABLET = ID("f0c1");
const JOIN_CODE = "CLAUDETRST";
const PIN = "5281";
const CLIENT = "claude-trust-client";

function psql(sql: string, user = "postgres"): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", user, "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  for (const fam of [FAMILY, OTHER_FAMILY]) {
    psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
      DELETE FROM messages WHERE family_id = '${fam}';
      DELETE FROM assistant_action_requests WHERE family_id = '${fam}';
      DELETE FROM scheduled_notifications WHERE family_id = '${fam}';
      DELETE FROM integration_idempotency WHERE family_id = '${fam}';
      DELETE FROM integration_tokens WHERE family_id = '${fam}';
      DELETE FROM integration_secrets WHERE family_id = '${fam}';
      DELETE FROM pocket_money_transactions WHERE account_id IN (SELECT id FROM pocket_money_accounts WHERE family_id = '${fam}');
      DELETE FROM pocket_money_accounts WHERE family_id = '${fam}';
      DELETE FROM devices WHERE family_id = '${fam}';
      DELETE FROM point_redemptions WHERE family_id = '${fam}';
      DELETE FROM point_rewards WHERE family_id = '${fam}';
      DELETE FROM todo_point_awards WHERE family_id = '${fam}';
      DELETE FROM creatures WHERE family_id = '${fam}';
      DELETE FROM people WHERE family_id = '${fam}';
      DELETE FROM settings WHERE family_id = '${fam}';
      DELETE FROM families WHERE id = '${fam}';`);
  }
  psql(`DELETE FROM devices WHERE hardware_id LIKE 'claude-trust-%'`);
}

/** An assistant connection, as the OAuth flow writes one: an integration_tokens row with a client id. */
function connection(name: string, family = FAMILY, scopes = ["pocket_money:write"], oauth = true): { id: string; bearer: string } {
  const bearer = `kbi_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(bearer).digest("hex");
  const id = psql(`INSERT INTO integration_tokens (family_id, name, token_hash, scopes, oauth_client_id)
    VALUES ('${family}', '${name}', '${hash}', ARRAY[${scopes.map((s) => `'${s}'`).join(",")}], ${oauth ? `'${CLIENT}'` : "NULL"}) RETURNING id`);
  return { id, bearer };
}

let api: APIRequestContext;
let screen: APIRequestContext;
let screenDeviceId = "";

const post = (path: string, bearer: string, data: unknown, key: string = randomUUID()): Promise<APIResponse> =>
  api.post(`/api/integration/v1${path}`, { headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key }, data });
const trust = (ctx: APIRequestContext, id: string, data: unknown) => ctx.post(`/api/assistants/${id}/trust`, { data });
const trustedAt = (id: string) => psql(`SELECT coalesce(trusted_at::text, 'null') FROM integration_tokens WHERE id = '${id}'`);
const balance = () => Number(psql(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${ACCOUNT}'`));
const booking = (bearer: string, key?: string) => post("/pocket-money/bookings", bearer, { person_id: MIRA, amount: 5, type: "deposit", note: "claude-trust" }, key);

test.beforeAll(async () => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES
      ('${FAMILY}', 'claude-trust', '${JOIN_CODE}', true),
      ('${OTHER_FAMILY}', 'claude-trust-other', 'CLAUDETRSO', true);
    INSERT INTO settings (family_id, key, value) VALUES ('${FAMILY}', 'locale', '"en"'::jsonb);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES ('${MIRA}', '${FAMILY}', 'claude-Mira', true, '#56B6E8');
    INSERT INTO pocket_money_accounts (id, family_id, person_id, balance_cents, currency) VALUES ('${ACCOUNT}', '${FAMILY}', '${MIRA}', 1000, 'EUR');
    INSERT INTO creatures (person_id, family_id, species, style, enabled) VALUES ('${MIRA}', '${FAMILY}', 'dragon', 'gumdrop', true);
    INSERT INTO point_rewards (id, family_id, title, cost_points, icon, active) VALUES ('${TABLET}', '${FAMILY}', 'claude-trust tablet time', 30, '📱', true);
    INSERT INTO todo_point_awards (family_id, person_id, points, completion_key) VALUES ('${FAMILY}', '${MIRA}', 1000, 'claude-trust-start');`);
  api = await pwRequest.newContext({ baseURL: BASE });
  screen = await pwRequest.newContext({ baseURL: BASE });
  const joined = await postJoin(screen, { joinCode: JOIN_CODE, hardwareId: "claude-trust-screen", deviceName: "claude-trust-screen" });
  expect(joined.status(), await joined.text()).toBe(200);
  screenDeviceId = (await joined.json()).device.id;
  expect((await screen.post("/api/pin", { data: { family_id: FAMILY, action: "set", pin: PIN } })).status()).toBe(200);
});

test.afterAll(async () => {
  await api?.dispose();
  await screen?.dispose();
  purge();
});

// ── the database ────────────────────────────────────────────────────────────

test("the browser roles can neither read nor write trust, nor rewrite the record", () => {
  for (const [role, table, column, priv] of [
    ["authenticated", "integration_tokens", "trusted_at", "UPDATE"],
    ["authenticated", "integration_tokens", "trusted_at", "SELECT"],
    ["anon", "integration_tokens", "trusted_at", "UPDATE"],
    ["authenticated", "assistant_action_requests", "decided_by_trust", "UPDATE"],
    ["anon", "assistant_action_requests", "decided_by_trust", "UPDATE"],
  ]) {
    expect(psql(`SELECT has_column_privilege('${role}', 'public.${table}', '${column}', '${priv}')`), `${role} ${priv} ${table}.${column}`).toBe("f");
  }
});

test("off for every assistant to begin with; a row is never born trusted; revoking or a hand-made token drops it", () => {
  const born = psql(`INSERT INTO integration_tokens (family_id, name, token_hash, scopes, oauth_client_id, trusted_at)
    VALUES ('${FAMILY}', 'claude-trust born', '${randomBytes(32).toString("hex")}', ARRAY['family:read'], '${CLIENT}', now()) RETURNING trusted_at IS NULL`);
  expect(born).toBe("t");

  const a = connection("claude-trust revoke-me");
  psql(`UPDATE integration_tokens SET trusted_at = now() WHERE id = '${a.id}'`);
  expect(trustedAt(a.id)).not.toBe("null");
  // What Settings' Revoke and "Allow AI assistants" off both write.
  psql(`UPDATE integration_tokens SET revoked_at = now() WHERE id = '${a.id}'`);
  expect(trustedAt(a.id)).toBe("null");
  // And a revoked row cannot be trusted again, however it is written.
  psql(`UPDATE integration_tokens SET trusted_at = now() WHERE id = '${a.id}'`);
  expect(trustedAt(a.id)).toBe("null");

  const manual = connection("claude-trust manual", FAMILY, ["pocket_money:write"], false);
  psql(`UPDATE integration_tokens SET trusted_at = now() WHERE id = '${manual.id}'`);
  expect(trustedAt(manual.id)).toBe("null");
});

// ── the switch ──────────────────────────────────────────────────────────────

test("an Integration API token cannot reach the switch, not even for itself", async () => {
  const self = connection("claude-trust self");
  const res = await api.post(`/api/assistants/${self.id}/trust`, {
    headers: { authorization: `Bearer ${self.bearer}` }, data: { trusted: true, pin: PIN },
  });
  expect(res.status()).toBe(401);
  expect(trustedAt(self.id)).toBe("null");
});

test("on needs the PIN: none and a wrong one are refused; the right one trusts it, recording the screen", async () => {
  const c = connection("claude-trust pin");
  expect((await trust(screen, c.id, { trusted: true })).status()).toBe(400);
  const wrong = await trust(screen, c.id, { trusted: true, pin: "0000" });
  expect(wrong.status()).toBe(403);
  expect((await wrong.json()).error).toBe("pin_invalid");
  expect(trustedAt(c.id)).toBe("null");

  const right = await trust(screen, c.id, { trusted: true, pin: PIN });
  expect(right.status(), await right.text()).toBe(200);
  expect(trustedAt(c.id)).not.toBe("null");
  expect(psql(`SELECT trusted_by_device_id FROM integration_tokens WHERE id = '${c.id}'`)).toBe(screenDeviceId);

  // Off: no PIN.
  const off = await trust(screen, c.id, { trusted: false });
  expect(off.status()).toBe(200);
  expect(trustedAt(c.id)).toBe("null");
});

test("family-scoped: another family's assistant is 404, on or off, and stays as it was", async () => {
  const theirs = connection("claude-trust theirs", OTHER_FAMILY);
  expect((await trust(screen, theirs.id, { trusted: true, pin: PIN })).status()).toBe(404);
  expect(trustedAt(theirs.id)).toBe("null");
  psql(`UPDATE integration_tokens SET trusted_at = now() WHERE id = '${theirs.id}'`);
  expect((await trust(screen, theirs.id, { trusted: false })).status()).toBe(404);
  expect(trustedAt(theirs.id)).not.toBe("null");
});

// ── a trusted assistant ─────────────────────────────────────────────────────

test("untrusted, a booking waits; trusted, it is booked at once, marked, with a notice the assistant cannot clear", async () => {
  const c = connection("claude-trust booker");
  const before = balance();
  const asked = await booking(c.bearer);
  expect(asked.status()).toBe(202);
  expect(balance()).toBe(before);

  expect((await trust(screen, c.id, { trusted: true, pin: PIN })).status()).toBe(200);
  const key = randomUUID();
  const ran = await booking(c.bearer, key);
  const body = await ran.json();
  expect(ran.status(), JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ status: "done", allowed_by_trust: true });
  expect(balance()).toBe(before + 500);

  const row = psql(`SELECT status, decided_by_trust, coalesce(decided_by_device_id::text, 'null') FROM assistant_action_requests WHERE id = '${body.request_id}'`);
  expect(row).toBe("done|t|null");

  // get_action_status says done, and that trust allowed it.
  const status = await (await api.get(`/api/integration/v1/actions/${body.request_id}`, { headers: { authorization: `Bearer ${c.bearer}` } })).json();
  expect(status.action).toMatchObject({ status: "done", allowed_by_trust: true, kind: "pocket_money" });

  // A retry with the same key replays the answer; it is not booked twice.
  const replay = await booking(c.bearer, key);
  expect(replay.headers()["idempotent-replay"]).toBe("true");
  expect(await replay.json()).toEqual(body);
  expect(balance()).toBe(before + 500);

  // The notice: a screen message, via the assistant, linked to the request, no device.
  const notice = psql(`SELECT id || '|' || body || '|' || sender_label || '|' || coalesce(sender_device_id::text, 'null')
    FROM messages WHERE action_request_id = '${body.request_id}'`);
  const [noticeId, text, label, device] = notice.split("|");
  expect(text).toBe("Done without asking: add €5.00 to claude-Mira’s pocket money (note: “claude-trust”)");
  expect(label).toBe("claude-trust booker");
  expect(device).toBe("null");

  const full = connection("claude-trust announcer", FAMILY, ["announcements:write", "pocket_money:write"]);
  const ack = await api.post(`/api/integration/v1/messages/${noticeId}/acknowledge`, { headers: { authorization: `Bearer ${full.bearer}` } });
  expect(ack.status()).toBe(403);
  expect(psql(`SELECT acknowledged_at IS NULL FROM messages WHERE id = '${noticeId}'`)).toBe("t");
});

test("one Idempotency-Key, five trusted bookings at once: booked exactly once, the rest told it is in progress or replayed", async () => {
  const c = connection("claude-trust burst");
  expect((await trust(screen, c.id, { trusted: true, pin: PIN })).status()).toBe(200);
  const before = balance();
  const key = randomUUID();
  const answers = await Promise.all(Array.from({ length: 5 }, () => booking(c.bearer, key)));
  const statuses = answers.map((a) => a.status()).sort();
  expect(statuses.filter((s) => s === 200).length, statuses.join(",")).toBeGreaterThanOrEqual(1);
  expect(statuses.every((s) => s === 200 || s === 409), statuses.join(",")).toBe(true);
  // 200s beyond the first are replays of the same answer.
  const done = await Promise.all(answers.filter((a) => a.status() === 200).map((a) => a.json()));
  expect(new Set(done.map((d) => d.request_id)).size).toBe(1);
  expect(balance()).toBe(before + 500);
  expect(psql(`SELECT count(*) FROM assistant_action_requests WHERE token_id = '${c.id}'`)).toBe("1");
  // And afterwards, a retry replays it.
  const retry = await booking(c.bearer, key);
  expect(retry.headers()["idempotent-replay"]).toBe("true");
  expect(balance()).toBe(before + 500);
});

test("another assistant of the same family still asks; a reconnect starts untrusted; a revoked one cannot act at all", async () => {
  const trusted = connection("claude-trust one");
  expect((await trust(screen, trusted.id, { trusted: true, pin: PIN })).status()).toBe(200);
  const other = connection("claude-trust two");
  const before = balance();
  expect((await booking(other.bearer)).status()).toBe(202);
  expect(balance()).toBe(before);

  // Revoked, as Settings revokes it: the trust is gone and the token is dead.
  psql(`UPDATE integration_tokens SET revoked_at = now() WHERE id = '${trusted.id}'`);
  expect(trustedAt(trusted.id)).toBe("null");
  expect((await booking(trusted.bearer)).status()).toBe(401);

  // The same client connecting again is a new row: it asks.
  const again = connection("claude-trust one");
  expect((await booking(again.bearer)).status()).toBe(202);
  expect(balance()).toBe(before);
});

test("a trusted reward decision is decided at once, through the parent's own path, with no deciding device", async () => {
  const c = connection("claude-trust rewards");
  expect((await trust(screen, c.id, { trusted: true, pin: PIN })).status()).toBe(200);
  const id = psql(`SELECT (request_person_point_redemption('${FAMILY}', '${MIRA}', '${TABLET}', NULL))->'redemption'->>'id'`);
  const res = await post(`/rewards/requests/${id}/decision`, c.bearer, { decision: "approve" });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ status: "done", allowed_by_trust: true, decision: "approve" });
  expect(psql(`SELECT status || '|' || coalesce(decided_by_device_id::text, 'null') FROM point_redemptions WHERE id = '${id}'`)).toBe("approved|null");

  // Already decided: refused before anything is stored, trusted or not.
  const again = await post(`/rewards/requests/${id}/decision`, c.bearer, { decision: "decline" });
  expect(again.status()).toBe(409);
  expect(psql(`SELECT status FROM point_redemptions WHERE id = '${id}'`)).toBe("approved");
});

// ── the screen ──────────────────────────────────────────────────────────────

async function signIn(page: Page) {
  const hardwareId = `claude-trust-browser-${Date.now()}`;
  const joined = await postJoin(page.request, { joinCode: JOIN_CODE, hardwareId, deviceName: hardwareId });
  expect(joined.ok(), await joined.text()).toBe(true);
  const data = await joined.json();
  await page.context().addCookies([{
    name: "family-calendar-storage",
    value: encodeURIComponent(JSON.stringify({ state: { family: data.family, device: data.device }, version: 0 })),
    url: BASE,
  }]);
  // The settings PIN screen, already passed on this tab.
  await page.addInitScript((familyId) => {
    sessionStorage.setItem("kinboard_settings_unlock", JSON.stringify({ familyId, at: Date.now() }));
  }, FAMILY);
}

test("Settings: the switch asks for the PIN, shows the warning, refuses a wrong PIN, trusts with the right one, and switches off without one", async ({ page }) => {
  test.setTimeout(180_000);
  const c = connection("claude-trust screen");
  // Earlier tests' waiting requests would cover the page.
  psql(`UPDATE assistant_action_requests SET status = 'expired' WHERE family_id = '${FAMILY}' AND status = 'pending'`);
  await signIn(page);
  await page.goto("/settings/integrations", { waitUntil: "domcontentloaded" });
  const row = page.locator(`[data-assistant-trust="${c.id}"]`);
  await expect(row).toBeVisible({ timeout: 90_000 });
  const toggle = row.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  const dialog = page.locator("[data-trust-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-trust-warning]")).toHaveText(en.settings.integrations.trustWarning);
  await page.screenshot({ path: test.info().outputPath("trust-dialog.png") });

  await dialog.locator("#trust-pin").fill("0000");
  await dialog.getByRole("button", { name: en.settings.integrations.trustConfirm }).click();
  // A dev server compiles the route on first use.
  await expect(dialog.getByRole("alert")).toHaveText(en.settings.integrations.trustPinInvalid, { timeout: 60_000 });
  expect(trustedAt(c.id)).toBe("null");

  await dialog.locator("#trust-pin").fill(PIN);
  await dialog.getByRole("button", { name: en.settings.integrations.trustConfirm }).click();
  // A dev server can hold the request while it compiles another page.
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await expect(row).toContainText(en.settings.integrations.trustBadge);
  expect(trustedAt(c.id)).not.toBe("null");
  await page.screenshot({ path: test.info().outputPath("trust-on.png") });

  // Off: straight away, no dialog, no PIN.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
  await expect(dialog).toHaveCount(0);
  expect(trustedAt(c.id)).toBe("null");
});
