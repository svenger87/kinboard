import { test, expect } from "@playwright/test";
import { validateAuthorizeQuery } from "../src/lib/oauth/authorize";

const ORIGIN = "https://kb.example.com";
const CLIENT = { clientId: "https://claude.ai/meta", clientName: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"], kind: "cimd" as const };
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const q = (over: Record<string, string | null> = {}) => {
  const base: Record<string, string | null> = {
    response_type: "code", client_id: CLIENT.clientId, redirect_uri: CLIENT.redirectUris[0], state: "xyz",
    code_challenge: CHALLENGE, code_challenge_method: "S256", resource: `${ORIGIN}/api/mcp`, scope: "family:read tasks:write",
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) p.set(k, v);
  return p;
};
const NOW = new Date("2026-10-01T12:00:00Z");

test("a well-formed request becomes a pending request", () => {
  const r = validateAuthorizeQuery(q(), ORIGIN, CLIENT, NOW);
  expect(r).toEqual({ kind: "ok", request: {
    clientId: CLIENT.clientId, clientName: "Claude", redirectUri: CLIENT.redirectUris[0], state: "xyz",
    codeChallenge: CHALLENGE, scopes: ["family:read", "tasks:write"], resource: `${ORIGIN}/api/mcp`,
    expiresAt: "2026-10-01T12:10:00.000Z",
  } });
});

test("an unknown client or a foreign redirect is a page, never a redirect", () => {
  expect(validateAuthorizeQuery(q(), ORIGIN, null, NOW)).toMatchObject({ kind: "page", status: 400 });
  expect(validateAuthorizeQuery(q({ redirect_uri: "https://evil.example/cb" }), ORIGIN, CLIENT, NOW)).toMatchObject({ kind: "page", status: 400 });
});

test("after the redirect is trusted, errors go back to the client with state and iss", () => {
  for (const [over, error] of [
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ code_challenge: null }, "invalid_request"],
    [{ resource: "https://other.example/api/mcp" }, "invalid_target"],
    [{ scope: "openid email" }, "invalid_scope"],
  ] as const) {
    const r = validateAuthorizeQuery(q(over), ORIGIN, CLIENT, NOW);
    expect(r.kind, JSON.stringify(over)).toBe("redirect");
    if (r.kind !== "redirect") continue;
    const u = new URL(r.location);
    expect(u.searchParams.get("error")).toBe(error);
    expect(u.searchParams.get("state")).toBe("xyz");
    expect(u.searchParams.get("iss")).toBe(ORIGIN);
  }
});

test("a missing resource means this server", () => {
  const r = validateAuthorizeQuery(q({ resource: null }), ORIGIN, CLIENT, NOW);
  expect(r.kind === "ok" && r.request.resource).toBe(`${ORIGIN}/api/mcp`);
});
