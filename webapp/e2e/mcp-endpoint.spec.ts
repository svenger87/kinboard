import { test, expect } from "@playwright/test";
import { authenticateMcpRequest } from "../src/lib/mcp/auth";
import { TOOL_SCOPES } from "../src/lib/mcp/server";
import { hashIntegrationToken } from "../src/lib/integration-auth";
import { MCP_SCOPES } from "../src/lib/oauth/config";
import { TokenLookupUnavailable, type StoredToken } from "../src/lib/integration-store";

const ORIGIN = "https://kb.example.com";
const TOKEN = `kbi_${"a".repeat(43)}`;
const NOW = new Date("2026-10-01T12:00:00Z");
const row = (over: Partial<StoredToken> = {}): StoredToken => ({
  id: "tok-1", family_id: "fam-1", name: "Claude", scopes: ["family:read", "tasks:write"], token_hash: hashIntegrationToken(TOKEN),
  expires_at: "2026-10-01T13:00:00Z", revoked_at: null, last_used_at: null, oauth_client_id: "https://claude.ai/meta", resource: `${ORIGIN}/api/mcp`, ...over,
});
const req = (auth?: string) => new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: auth ? { authorization: auth } : {} });
// A no-op default so none of these tests reach the real touchToken (and so
// the real Postgres it talks to) unless a test explicitly wants to observe it.
const noopTouch = async () => {};
// Every family here has "Allow AI assistants" on unless a test says otherwise
// — and none of them reaches the real settings lookup.
const allOn = async () => true;
const auth = (
  r: Request,
  found: StoredToken | null,
  touch: (token: StoredToken, now?: Date) => Promise<void> = noopTouch,
  familyEnabled: (familyId: string) => Promise<boolean> = allOn,
) => authenticateMcpRequest(r, ORIGIN, async () => found, NOW, touch, familyEnabled);

test("no token is a 401 that points the client at the metadata", async () => {
  const r = await auth(req(), null);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.response.status).toBe(401);
  expect(r.response.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
});

test("a valid OAuth token for this resource yields its scopes", async () => {
  const r = await auth(req(`Bearer ${TOKEN}`), row());
  expect(r.ok && r.authInfo).toMatchObject({ token: TOKEN, clientId: "https://claude.ai/meta", scopes: ["family:read", "tasks:write"] });
});

test("a token minted for another origin is refused", async () => {
  const r = await auth(req(`Bearer ${TOKEN}`), row({ resource: "https://other.example/api/mcp" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.response.headers.get("www-authenticate")).toContain('error="invalid_token"');
});

test("a manually created token (no resource) is accepted", async () => {
  const r = await auth(req(`Bearer ${TOKEN}`), row({ resource: null, oauth_client_id: null }));
  expect(r.ok && r.authInfo.clientId).toBe("token:tok-1");
});

test("expired and revoked tokens are refused", async () => {
  expect((await auth(req(`Bearer ${TOKEN}`), row({ expires_at: "2026-10-01T11:59:59Z" }))).ok).toBe(false);
  expect((await auth(req(`Bearer ${TOKEN}`), row({ revoked_at: "2026-10-01T10:00:00Z" }))).ok).toBe(false);
});

test("every tool names an assistant scope", () => {
  for (const [tool, scope] of Object.entries(TOOL_SCOPES)) expect(MCP_SCOPES, tool).toContain(scope);
  expect(TOOL_SCOPES.list_notes).toBe("notes:read");
});

test("a lookup that cannot be verified is a 503 with retry-after, never a 401", async () => {
  const r = await authenticateMcpRequest(
    req(`Bearer ${TOKEN}`), ORIGIN,
    async () => { throw new TokenLookupUnavailable(); },
    NOW, noopTouch,
  );
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.response.status).toBe(503);
  expect(r.response.headers.get("retry-after")).toBe("5");
});

test("a successful authentication touches the token once; a failed one does not", async () => {
  let calls: StoredToken[] = [];
  const touch = async (token: StoredToken) => { calls.push(token); };

  await auth(req(`Bearer ${TOKEN}`), row(), touch);
  expect(calls).toHaveLength(1);
  expect(calls[0].id).toBe("tok-1");

  calls = [];
  await auth(req(`Bearer ${TOKEN}`), row({ revoked_at: "2026-10-01T10:00:00Z" }), touch);
  expect(calls).toHaveLength(0);

  calls = [];
  await auth(req(), null, touch);
  expect(calls).toHaveLength(0);
});

test("a valid token from a family with assistants switched off is refused as invalid_token", async () => {
  const asked: string[] = [];
  const r = await auth(req(`Bearer ${TOKEN}`), row(), noopTouch, async (familyId) => { asked.push(familyId); return false; });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.response.status).toBe(401);
  expect(r.response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  expect(asked).toEqual(["fam-1"]);
  // A hand-made token is no exception: /api/mcp is the assistants' door.
  expect((await auth(req(`Bearer ${TOKEN}`), row({ resource: null, oauth_client_id: null }), noopTouch, async () => false)).ok).toBe(false);
});

test("a switch lookup that fails is a 503, never a 401", async () => {
  const r = await auth(req(`Bearer ${TOKEN}`), row(), noopTouch, async () => { throw new Error("db down"); });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.response.status).toBe(503);
});
