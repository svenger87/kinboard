import { test, expect, request as pwRequest } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

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
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const FAMILY_CODE = process.env.FAMILY_CODE;
test.skip(!FAMILY_CODE, "needs FAMILY_CODE and a running stack");

const psql = (sql: string) =>
  execFileSync("docker", ["exec", "-i", "kbfresh-db", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], { encoding: "utf8" }).trim();

// Rows this test creates, cleaned up in afterAll regardless of where the
// test fails. `pinCreated` is only set true if the family had no PIN before
// this test ran and the test's own approval set one.
let clientId: string | null = null;
let pinCreated = false;
let familyId: string | null = null;

test.afterAll(() => {
  psql("DELETE FROM devices WHERE hardware_id LIKE 'claude-%'");
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
  const join = await api.post("/api/session/join", { data: { joinCode: FAMILY_CODE, hardwareId: `claude-mcp-${Date.now()}`, deviceName: "claude-mcp-test" } });
  expect(join.ok(), await join.text()).toBe(true);

  // Never print or write down the join code or any PIN; only ids and counts.
  familyId = psql(`SELECT id FROM families WHERE join_code = '${FAMILY_CODE!.replace(/'/g, "''")}'`);
  const hasPin = psql(`SELECT count(*) FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`) !== "0";
  test.skip(hasPin && !process.env.SETTINGS_PIN, "family has a PIN; set SETTINGS_PIN to run");

  const redirectUri = "http://127.0.0.1:53682/callback";
  const reg = await api.post("/api/oauth/register", { data: { client_name: "claude-flow-test", redirect_uris: [redirectUri] } });
  expect(reg.status()).toBe(201);
  clientId = (await reg.json()).client_id as string;

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = await api.get("/api/oauth/authorize", {
    params: { response_type: "code", client_id: clientId, redirect_uri: redirectUri, state: "st", code_challenge: challenge, code_challenge_method: "S256", scope: "family:read tasks:write" },
    maxRedirects: 0,
  });
  expect(authorize.status()).toBe(302);
  const requestId = authorize.headers()["location"].split("/oauth/consent/")[1];

  // The authorize response set kb_oauth_request on `api`'s cookie jar. A
  // second, fresh context joined to the same family never saw that cookie,
  // so the same request id 404s for it — a consent link pasted elsewhere
  // (chat, a shared screen) cannot be approved in someone else's browser.
  const other = await pwRequest.newContext({ baseURL: BASE });
  const otherJoin = await other.post("/api/session/join", { data: { joinCode: FAMILY_CODE, hardwareId: `claude-mcp-othercookie-${Date.now()}`, deviceName: "claude-mcp-test" } });
  expect(otherJoin.ok(), await otherJoin.text()).toBe(true);
  const otherGet = await other.get(`/api/oauth/consent?request=${requestId}`);
  expect(otherGet.status()).toBe(404);
  await other.dispose();

  const details = await api.get(`/api/oauth/consent?request=${requestId}`);
  expect(await details.json()).toMatchObject({ clientName: "claude-flow-test", scopes: ["family:read", "tasks:write"], loopbackOnly: true, pinSet: hasPin });

  // A same-origin-page POST never carries a different Origin. One present
  // and different means the request didn't come from the consent page,
  // whatever the cookie says — the request must still be refused for it.
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

  const consent = await api.post("/api/oauth/consent", {
    data: { request: requestId, decision: "approve", scopes: ["family:read"], ...(hasPin ? { pin: process.env.SETTINGS_PIN } : { newPin: "4826" }) },
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
  expect(tokens).toMatchObject({ token_type: "Bearer", scope: "family:read" });

  const client = new Client({ name: "kinboard-flow-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("list_tasks");
  const listed = await client.callTool({ name: "list_tasks", arguments: {} });
  expect(listed.isError).toBeFalsy();
  const denied = await client.callTool({ name: "create_task", arguments: { title: "should not exist" } });
  expect(denied.isError).toBe(true); // granted family:read only
  await client.close();

  const refreshed = await (await api.post("/api/oauth/token", { form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId } })).json();
  expect(refreshed.access_token).toBeTruthy();
  const replay = await api.post("/api/oauth/token", { form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId } });
  expect((await replay.json()).error).toBe("invalid_grant");

  const old = await api.post("/api/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` }, data: {} });
  expect(old.status()).toBe(401); // rotated away

  psql(`UPDATE integration_tokens SET revoked_at = now() WHERE oauth_client_id = '${clientId}'`);
  const revoked = await api.post("/api/mcp", { headers: { authorization: `Bearer ${refreshed.access_token}` }, data: {} });
  expect(revoked.status()).toBe(401);
});
