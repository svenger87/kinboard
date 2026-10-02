import { postJoin } from "./session";
import { test, expect, request as pwRequest } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { dbContainer } from "./whole-database";
import { MCP_SCOPES } from "../src/lib/oauth/config";

/**
 * The whole assistant connection against a running server: DCR, authorize,
 * consent (with a seeded device session, the request-cookie binding, the
 * Origin check and the mandatory-PIN rule), token exchange, MCP tools/list
 * and a tool call, refresh rotation, and revocation.
 *
 * Needs a stack and FAMILY_CODE; run with
 * PLAYWRIGHT_BASE_URL=http://localhost:3001 against the worktree server. See
 * task-12-amendment.md for why this departs from the original brief script:
 * the PIN is mandatory to approve (consent GET returns `pinSet`, POST takes
 * `pin` or `newPin`), /api/oauth/authorize binds the pending request to the
 * browser with a cookie, and a cross-origin consent POST is refused.
 *
 * Since the final review it also covers the server-side settings unlock (the
 * PIN guards the actions, not just the screen) and the "Allow AI assistants"
 * switch: the test switches it on for the family through /api/assistants,
 * and switching it off at the end is what cuts the assistant off. The
 * family's previous setting is restored in afterAll.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const FAMILY_CODE = process.env.FAMILY_CODE;
test.skip(!FAMILY_CODE, "needs FAMILY_CODE and a running stack");

const psql = (sql: string) =>
  execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], { encoding: "utf8" }).trim();

// Rows this test creates, cleaned up in afterAll regardless of where the
// test fails. `pinCreated` is only set true if the family had no PIN before
// this test ran and the test's own approval set one.
let clientId: string | null = null;
let pinCreated = false;
let familyId: string | null = null;
// A throwaway second family with one writable calendar, so the cross-family
// check below always has a target (CI has only the demo family) and its id
// is a real random UUID (seeded ids like 00000000-…-0000000000b1 fail the
// tool's own UUID validation, which would make the check pass for the wrong
// reason).
const FOREIGN_FAMILY = "claude-flow-foreign";
// The family's assistants_enabled row before this test touched it: null
// until read, "" when there was no row, else the JSON text to put back.
let assistantsBefore: string | null = null;

test.afterAll(() => {
  if (familyId && assistantsBefore !== null) {
    if (assistantsBefore === "") {
      psql(`DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'assistants_enabled'`);
    } else {
      psql(`UPDATE settings SET value = '${assistantsBefore.replace(/'/g, "''")}'::jsonb WHERE family_id = '${familyId}' AND key = 'assistants_enabled'`);
    }
  }
  psql("DELETE FROM devices WHERE hardware_id LIKE 'claude-%'");
  psql(`DELETE FROM events WHERE calendar_id IN (SELECT c.id FROM calendars c JOIN families f ON f.id = c.family_id WHERE f.name = '${FOREIGN_FAMILY}')`);
  psql(`DELETE FROM calendars WHERE family_id IN (SELECT id FROM families WHERE name = '${FOREIGN_FAMILY}')`);
  psql(`DELETE FROM families WHERE name = '${FOREIGN_FAMILY}'`);
  if (clientId) {
    psql(`DELETE FROM integration_tokens WHERE oauth_client_id = '${clientId}'`);
    psql(`DELETE FROM oauth_authorization_requests WHERE client_id = '${clientId}'`);
    psql(`DELETE FROM oauth_clients WHERE client_id = '${clientId}'`);
  }
  if (pinCreated && familyId) {
    psql(`DELETE FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`);
  }
});

test("an assistant connects, uses a tool, refreshes, and is cut off by revocation", async () => {
  const api = await pwRequest.newContext({ baseURL: BASE });

  // A joined browser: the session cookie the consent API needs.
  const join = await postJoin(api, { joinCode: FAMILY_CODE, hardwareId: `claude-mcp-${Date.now()}`, deviceName: "claude-mcp-test" });
  expect(join.ok(), await join.text()).toBe(true);

  // Never print or write down the join code or any PIN; only ids and counts.
  familyId = psql(`SELECT id FROM families WHERE join_code = '${FAMILY_CODE!.replace(/'/g, "''")}'`);
  const hasPin = psql(`SELECT count(*) FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`) !== "0";
  test.skip(hasPin && !process.env.SETTINGS_PIN, "family has a PIN; set SETTINGS_PIN to run");

  // Switch "Allow AI assistants" on, the way Settings does. With a PIN that
  // needs the server-side unlock first; without one there is nothing to
  // prove. Then wait out the 30-second "on anywhere?" cache, in case this
  // server answered "no" just before.
  assistantsBefore = psql(`SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = 'assistants_enabled'`);
  if (hasPin) {
    const unlock = await api.post("/api/pin", { data: { family_id: familyId, action: "verify", pin: process.env.SETTINGS_PIN } });
    expect((await unlock.json()).valid).toBe(true);
  }
  const on = await api.post("/api/assistants", { data: { enabled: true } });
  expect(on.status(), await on.text()).toBe(200);
  await expect.poll(async () => (await api.get("/.well-known/oauth-authorization-server")).status(), { timeout: 40_000, intervals: [1_000] }).toBe(200);

  const redirectUri = "http://127.0.0.1:53682/callback";
  const reg = await api.post("/api/oauth/register", { data: { client_name: "claude-flow-test", redirect_uris: [redirectUri] } });
  expect(reg.status()).toBe(201);
  clientId = (await reg.json()).client_id as string;

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = await api.get("/api/oauth/authorize", {
    params: { response_type: "code", client_id: clientId, redirect_uri: redirectUri, state: "st", code_challenge: challenge, code_challenge_method: "S256", scope: "family:read tasks:write calendar:write" },
    maxRedirects: 0,
  });
  expect(authorize.status()).toBe(302);
  const requestId = authorize.headers()["location"].split("/oauth/consent/")[1];

  // The authorize response set kb_oauth_request on `api`'s cookie jar. A
  // second, fresh context joined to the same family never saw that cookie,
  // so the same request id 404s for it — a consent link pasted elsewhere
  // (chat, a shared screen) cannot be approved in someone else's browser.
  const other = await pwRequest.newContext({ baseURL: BASE });
  const otherJoin = await postJoin(other, { joinCode: FAMILY_CODE, hardwareId: `claude-mcp-othercookie-${Date.now()}`, deviceName: "claude-mcp-test" });
  expect(otherJoin.ok(), await otherJoin.text()).toBe(true);
  const otherGet = await other.get(`/api/oauth/consent?request=${requestId}`);
  expect(otherGet.status()).toBe(404);
  await other.dispose();

  const details = await api.get(`/api/oauth/consent?request=${requestId}`);
  // A DCR client named itself: the page must not vouch for it.
  const detailsBody = await details.json();
  expect(detailsBody).toMatchObject({ clientName: "claude-flow-test", verified: false, clientHost: null, scopes: ["family:read", "calendar:write", "tasks:write"], loopbackOnly: true, pinSet: hasPin });
  // Everything else an assistant can be given is offered too, for the page
  // to show unticked: a client replaying an old scope list never asks.
  expect(detailsBody.available).toContain("vehicles:read");
  expect(detailsBody.available).not.toContain("family:read");
  expect([...detailsBody.scopes, ...detailsBody.available].sort()).toEqual([...MCP_SCOPES].sort());

  // A same-origin-page POST never carries a different Origin. One present
  // and different means the request didn't come from the consent page,
  // whatever the cookie says — the request must still be refused for it.
  // The body carries PIN fields on purpose, and they never matter: the
  // route checks Origin before decideConsent is called, so the PIN logic
  // (verify, rate limit, inline set) is never reached for this POST.
  const crossOrigin = await api.post("/api/oauth/consent", {
    headers: { origin: "https://evil.example" },
    data: { request: requestId, decision: "approve", scopes: ["family:read"], pin: process.env.SETTINGS_PIN ?? "", newPin: "4826" },
  });
  expect(crossOrigin.status()).toBe(403);

  if (!hasPin) {
    // decideConsent checks scopes before it stores a new PIN, specifically so
    // a request that was always going to fail never has the side effect of
    // setting a PIN nobody confirmed. Prove it: empty scopes + a well-formed
    // newPin must fail with no_scopes and leave no PIN row behind.
    const emptyScopes = await api.post("/api/oauth/consent", { data: { request: requestId, decision: "approve", scopes: [], newPin: "4826" } });
    expect(emptyScopes.status()).toBe(400);
    expect((await emptyScopes.json()).error).toBe("no_scopes");
    expect(psql(`SELECT count(*) FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`)).toBe("0");
  }

  // Ticking something no assistant can be given grants nothing: an
  // Integration API scope (events:read) and made-up ones are dropped, and
  // with nothing left the approval is refused.
  const unsupported = await api.post("/api/oauth/consent", {
    data: { request: requestId, decision: "approve", scopes: ["events:read", "admin", "*"], ...(hasPin ? { pin: process.env.SETTINGS_PIN } : { newPin: "4826" }) },
  });
  expect(unsupported.status()).toBe(400);
  expect((await unsupported.json()).error).toBe("no_scopes");

  const consent = await api.post("/api/oauth/consent", {
    // vehicles:read was not requested: the family ticked it in the "also
    // available" section. events:read rides along and must be dropped.
    data: { request: requestId, decision: "approve", scopes: ["family:read", "calendar:write", "vehicles:read", "events:read"], ...(hasPin ? { pin: process.env.SETTINGS_PIN } : { newPin: "4826" }) },
  });
  expect(consent.status(), await consent.text()).toBe(200);
  if (!hasPin) pinCreated = true;
  const redirect = new URL((await consent.json()).redirect);
  expect(redirect.searchParams.get("state")).toBe("st");
  expect(redirect.searchParams.get("iss")).toBe(BASE);

  const exchange = await api.post("/api/oauth/token", {
    form: { grant_type: "authorization_code", code: redirect.searchParams.get("code")!, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri },
  });
  const tokens = await exchange.json();
  // The granted set, not the requested one (RFC 6749 §5.1).
  expect(tokens).toMatchObject({ token_type: "Bearer", scope: "family:read calendar:write vehicles:read" });

  const client = new Client({ name: "kinboard-flow-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("list_tasks");
  const listed = await client.callTool({ name: "list_tasks", arguments: {} });
  expect(listed.isError).toBeFalsy();
  // The unrequested scope reached the token: the tool is not refused for
  // scope (it may still say Home Assistant is not set up).
  const vehicles = await client.callTool({ name: "list_vehicles", arguments: {} });
  expect(JSON.stringify(vehicles.content)).not.toContain("authorization is required");
  const denied = await client.callTool({ name: "create_task", arguments: { title: "should not exist" } });
  expect(denied.isError).toBe(true); // tasks:write was requested but not granted

  // calendar:write is granted — for this family's calendars only. Another
  // family's calendar id, however it was learned, is refused and nothing is
  // written to it. The refusal must be the route's family check ("No
  // writable calendar"), not input validation, or this proves nothing.
  const foreignCalendar = psql(
    `WITH f AS (INSERT INTO families (name, join_code) VALUES ('${FOREIGN_FAMILY}', upper(substr(md5(random()::text), 1, 6))) RETURNING id) ` +
    `INSERT INTO calendars (family_id, name) SELECT id, '${FOREIGN_FAMILY}' FROM f RETURNING id`,
  ).split("\n")[0];
  const foreign = await client.callTool({
    name: "create_calendar_event",
    arguments: { calendar_id: foreignCalendar, title: "claude-flow-test foreign", start_at: "2030-01-01T10:00:00+00:00", end_at: "2030-01-01T11:00:00+00:00" },
  });
  expect(foreign.isError).toBe(true);
  expect(JSON.stringify(foreign.content)).toContain("No writable calendar");
  expect(psql(`SELECT count(*) FROM events WHERE calendar_id = '${foreignCalendar}'`)).toBe("0");
  await client.close();

  const refreshed = await (await api.post("/api/oauth/token", { form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId } })).json();
  expect(refreshed.access_token).toBeTruthy();
  expect(refreshed.scope).toBe("family:read calendar:write vehicles:read");
  expect(psql(`SELECT array_to_string(scopes, ' ') FROM integration_tokens WHERE oauth_client_id = '${clientId}'`)).toBe("family:read calendar:write vehicles:read");
  const replay = await api.post("/api/oauth/token", { form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId } });
  expect((await replay.json()).error).toBe("invalid_grant");

  const old = await api.post("/api/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` }, data: {} });
  expect(old.status()).toBe(401); // rotated away

  // The connection is listed under the redirect host Kinboard checked, not
  // only the name the client gave itself.
  expect(psql(`SELECT name FROM integration_tokens WHERE oauth_client_id = '${clientId}'`)).toBe("claude-flow-test (127.0.0.1:53682)");

  // The PIN now exists (set inline above, or already there), so changing
  // protected settings needs the server-side unlock. A device that never
  // entered the PIN is refused — for the switch, for removing the PIN, and
  // for writing it through the generic settings route.
  const locked = await pwRequest.newContext({ baseURL: BASE });
  const lockedJoin = await postJoin(locked, { joinCode: FAMILY_CODE, hardwareId: `claude-mcp-locked-${Date.now()}`, deviceName: "claude-mcp-test" });
  expect(lockedJoin.ok(), await lockedJoin.text()).toBe(true);
  for (const [path, method, data] of [
    ["/api/assistants", "post", { enabled: false }],
    ["/api/pin", "post", { family_id: familyId, action: "remove" }],
    ["/api/pin", "post", { family_id: familyId, action: "set", pin: "1111" }],
    ["/api/integration-tokens", "post", { name: "claude-locked", scopes: ["family:read"] }],
  ] as const) {
    const r = await locked[method](path, { data });
    expect(r.status(), `${path} ${JSON.stringify(data)}`).toBe(403);
    expect((await r.json()).error).toBe("pin_required");
  }
  const viaSettings = await locked.put("/api/settings", { data: { family_id: familyId, key: "settings_pin", value: { pin: "1111" } } });
  expect(viaSettings.status()).toBe(403);
  await locked.dispose();

  // Switching assistants off is what cuts this one off: with the PIN
  // entered on this device, the switch revokes every assistant connection.
  const unlockAgain = await api.post("/api/pin", { data: { family_id: familyId, action: "verify", pin: hasPin ? process.env.SETTINGS_PIN : "4826" } });
  expect((await unlockAgain.json()).valid).toBe(true);
  const off = await api.post("/api/assistants", { data: { enabled: false } });
  expect(off.status(), await off.text()).toBe(200);
  expect(psql(`SELECT count(*) FROM integration_tokens WHERE oauth_client_id = '${clientId}' AND revoked_at IS NULL`)).toBe("0");
  // 401 while another family still has assistants on; 404 once none has
  // (the whole endpoint disappears). Either way the token is dead.
  const revoked = await api.post("/api/mcp", { headers: { authorization: `Bearer ${refreshed.access_token}` }, data: {} });
  expect([401, 404]).toContain(revoked.status());
});
