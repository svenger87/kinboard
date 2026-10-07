import { test, expect } from "@playwright/test";
import { authenticateMcpRequest } from "../src/lib/mcp/auth";
import { TOOL_SCOPES } from "../src/lib/mcp/server";
import { hashIntegrationToken } from "../src/lib/integration-auth";
import { MCP_SCOPES } from "../src/lib/oauth/config";
import { TokenLookupUnavailable, type StoredToken } from "../src/lib/integration-store";
import { callIntegration, type RouteHandler } from "../src/lib/mcp/call-integration";

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

/**
 * `callIntegration` is how a tool reaches a route: it builds the Request the
 * route handler sees. PATCH and DELETE (RFC-011 §3) must not pick up the
 * Idempotency-Key that `calendar/events` POST relies on for retry safety —
 * an edit or delete replayed by a client is not the same operation, and
 * `integration-idempotency.ts` is not wired into those verbs at all.
 */
test.describe("callIntegration method and header shape", () => {
  const record = (): { handler: RouteHandler; calls: { method: string; headers: Headers; hasBody: boolean }[] } => {
    const calls: { method: string; headers: Headers; hasBody: boolean }[] = [];
    const handler: RouteHandler = async (request) => {
      calls.push({ method: request.method, headers: request.headers, hasBody: request.body !== null });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    return { handler, calls };
  };

  test("PATCH with a body sends a JSON content-type and no Idempotency-Key", async () => {
    const { handler, calls } = record();
    await callIntegration(handler, { origin: ORIGIN, path: "/notes/1", token: TOKEN, method: "PATCH", body: { text: "x" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].headers.get("idempotency-key")).toBeNull();
  });

  test("DELETE without a body sends no body and no content-type", async () => {
    const { handler, calls } = record();
    await callIntegration(handler, { origin: ORIGIN, path: "/notes/1", token: TOKEN, method: "DELETE" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].hasBody).toBe(false);
    expect(calls[0].headers.get("content-type")).toBeNull();
    expect(calls[0].headers.get("idempotency-key")).toBeNull();
  });

  test("a PATCH that asks for it sends an Idempotency-Key, fresh each call", async () => {
    // PATCH /recipes/{id} requires one: replacing ingredients hands out new
    // ids, so a retried change must replay, not run again.
    const { handler, calls } = record();
    const opts = { origin: ORIGIN, path: "/recipes/1", params: { id: "1" }, token: TOKEN, method: "PATCH" as const, body: { title: "x" }, idempotent: true };
    await callIntegration(handler, opts);
    await callIntegration(handler, opts);
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "PATCH"]);
    expect(calls[0].headers.get("idempotency-key")).toBeTruthy();
    expect(calls[1].headers.get("idempotency-key")).not.toBe(calls[0].headers.get("idempotency-key"));
  });

  test("POST sends an Idempotency-Key", async () => {
    const { handler, calls } = record();
    await callIntegration(handler, { origin: ORIGIN, path: "/lists/tasks", params: { list: "tasks" }, token: TOKEN, body: { summary: "x" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("idempotency-key")).toBeTruthy();
  });
});
