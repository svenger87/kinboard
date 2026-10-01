import { expect, type APIRequestContext } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { dbContainer } from "../whole-database";

/**
 * Connecting an assistant the way a real one does — the same steps as
 * e2e/mcp-oauth-flow.spec.ts (which keeps its own inline copy, because its
 * point is the assertions between the steps): switch "Allow AI assistants"
 * on, register (DCR), authorize with PKCE, approve on the consent API with
 * the settings PIN, exchange the code. For live specs that need a connected
 * assistant and only care what it can do afterwards.
 *
 * Never prints or writes down the join code or a PIN read from the
 * database; only ids and counts.
 */

/** psql against the stack's database, as `postgres`. `-tA`: bare rows, `|`-separated. */
export const psql = (sql: string): string =>
  execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], { encoding: "utf8" }).trim();

/** The first line only — an `INSERT … RETURNING` also prints its command tag. */
export const psqlRow = (sql: string): string => psql(sql).split("\n")[0];

export const sqlText = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * What a connection left behind, filled in as it goes so an afterAll can
 * clean up after a failure halfway through.
 */
export interface ConnectState {
  familyId: string | null;
  clientId: string | null;
  /** True only when this run set the family's first PIN (newPin on consent). */
  pinCreated: boolean;
  /** The family's assistants_enabled row before: null until read, "" when absent, else its JSON text. */
  assistantsBefore: string | null;
}

export const newConnectState = (): ConnectState =>
  ({ familyId: null, clientId: null, pinCreated: false, assistantsBefore: null });

export interface Connection {
  accessToken: string;
  /** integration_tokens.id of the grant — the id action requests are attributed to. */
  tokenId: string;
  /** The PIN that approves on this family: the one this run set, or SETTINGS_PIN. */
  pin: string;
}

/**
 * Connect an assistant with `scopes` to the family `api` is joined to.
 * `state.familyId` must be set. When the family has no PIN, consent sets
 * `newPin` and that becomes the PIN; when it has one, `existingPin` (from
 * the environment, never the database) must be given.
 */
export async function connectAssistant(
  api: APIRequestContext,
  base: string,
  state: ConnectState,
  opts: { scopes: string[]; clientName: string; newPin: string; existingPin?: string },
): Promise<Connection> {
  const familyId = state.familyId!;
  const hasPin = psql(`SELECT count(*) FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`) !== "0";
  if (hasPin && !opts.existingPin) throw new Error("family has a settings PIN: set SETTINGS_PIN");

  state.assistantsBefore = psql(`SELECT value::text FROM settings WHERE family_id = '${familyId}' AND key = 'assistants_enabled'`);
  if (hasPin) {
    const unlock = await api.post("/api/pin", { data: { family_id: familyId, action: "verify", pin: opts.existingPin } });
    expect((await unlock.json()).valid, "SETTINGS_PIN verifies").toBe(true);
  }
  const on = await api.post("/api/assistants", { data: { enabled: true } });
  expect(on.status(), await on.text()).toBe(200);
  // The "on anywhere?" answer is cached for 30 s per process.
  await expect.poll(async () => (await api.get("/.well-known/oauth-authorization-server")).status(), { timeout: 40_000, intervals: [1_000] }).toBe(200);

  const redirectUri = "http://127.0.0.1:53682/callback";
  const reg = await api.post("/api/oauth/register", { data: { client_name: opts.clientName, redirect_uris: [redirectUri] } });
  expect(reg.status(), await reg.text()).toBe(201);
  state.clientId = (await reg.json()).client_id as string;

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = await api.get("/api/oauth/authorize", {
    params: {
      response_type: "code", client_id: state.clientId, redirect_uri: redirectUri, state: "st",
      code_challenge: challenge, code_challenge_method: "S256", scope: opts.scopes.join(" "),
    },
    maxRedirects: 0,
  });
  expect(authorize.status(), await authorize.text()).toBe(302);
  const requestId = authorize.headers()["location"].split("/oauth/consent/")[1];

  const details = await (await api.get(`/api/oauth/consent?request=${requestId}`)).json();
  expect([...details.scopes].sort()).toEqual([...opts.scopes].sort());

  const consent = await api.post("/api/oauth/consent", {
    data: {
      request: requestId, decision: "approve", scopes: opts.scopes,
      ...(hasPin ? { pin: opts.existingPin } : { newPin: opts.newPin }),
    },
  });
  expect(consent.status(), await consent.text()).toBe(200);
  if (!hasPin) state.pinCreated = true;
  const redirect = new URL((await consent.json()).redirect);

  const exchange = await api.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code", code: redirect.searchParams.get("code")!, code_verifier: verifier,
      client_id: state.clientId, redirect_uri: redirectUri,
    },
  });
  const tokens = await exchange.json();
  expect(tokens.scope.split(" ").sort(), JSON.stringify(tokens)).toEqual([...opts.scopes].sort());
  const tokenId = psql(`SELECT id FROM integration_tokens WHERE oauth_client_id = '${state.clientId}' AND revoked_at IS NULL`);
  return { accessToken: tokens.access_token as string, tokenId, pin: hasPin ? opts.existingPin! : opts.newPin };
}

/** An MCP client on `/api/mcp` with the assistant's bearer token. */
export async function mcpClient(base: string, accessToken: string): Promise<Client> {
  const client = new Client({ name: "kinboard-live-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  }));
  return client;
}

export interface ToolOutcome {
  isError: boolean;
  text: string;
  /** The text parsed as JSON, or null when it is not JSON (an error message). */
  json: any;
}

/** Call a tool and unwrap its one text block. */
export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  const text = content?.[0]?.text ?? "";
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { isError: result.isError === true, text, json };
}

/**
 * Undo what `connectAssistant` did to the family: the assistants switch back
 * to its previous value, the client's grants, requests and registration,
 * and the PIN if this run set it. Rows referencing the token (action
 * requests) must be removed by the caller first.
 */
export function disconnectAssistant(state: ConnectState): void {
  const { familyId, clientId } = state;
  if (familyId && state.assistantsBefore !== null) {
    if (state.assistantsBefore === "") {
      psql(`DELETE FROM settings WHERE family_id = '${familyId}' AND key = 'assistants_enabled'`);
    } else {
      psql(`UPDATE settings SET value = ${sqlText(state.assistantsBefore)}::jsonb WHERE family_id = '${familyId}' AND key = 'assistants_enabled'`);
    }
  }
  if (clientId) {
    psql(`DELETE FROM integration_tokens WHERE oauth_client_id = '${clientId}'`);
    psql(`DELETE FROM oauth_authorization_requests WHERE client_id = '${clientId}'`);
    psql(`DELETE FROM oauth_clients WHERE client_id = '${clientId}'`);
  }
  if (state.pinCreated && familyId) {
    psql(`DELETE FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`);
  }
}
