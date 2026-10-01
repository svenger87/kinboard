import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { exchangeAuthorizationCode, generateAuthorizationCode, refreshAccessToken } from "../src/lib/oauth/grants";
import { hashIntegrationToken } from "../src/lib/integration-auth";
import type { AuthRequest, GrantRecord, OAuthStore } from "../src/lib/oauth/types";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const RESOURCE = "https://kb.example.com/api/mcp";
const CLIENT = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const NOW = new Date("2026-10-01T12:00:00Z");

/** In-memory OAuthStore with the same compare-and-swap semantics as the Supabase one. */
function memoryStore() {
  const requests = new Map<string, AuthRequest & { codeHash: string | null }>();
  const grants = new Map<string, GrantRecord & { accessHash: string; refreshHash: string }>();
  let n = 0;
  const store: OAuthStore = {
    async createAuthRequest(r) { const id = `req${++n}`; requests.set(id, { ...r, id, familyId: null, grantedScopes: null, codeExpiresAt: null, usedAt: null, grantId: null, codeHash: null }); return id; },
    async getAuthRequest(id) { return requests.get(id) ?? null; },
    async approveAuthRequest(id, familyId, granted, codeHash, codeExpiresAt, now) {
      const r = requests.get(id);
      if (!r || r.familyId || r.usedAt || new Date(r.expiresAt) <= now) return false;
      Object.assign(r, { familyId, grantedScopes: granted, codeHash, codeExpiresAt }); return true;
    },
    async denyAuthRequest(id, now) { const r = requests.get(id); if (r && !r.familyId && !r.usedAt) r.usedAt = now.toISOString(); },
    async consumeCode(codeHash, now) {
      const r = [...requests.values()].find((x) => x.codeHash === codeHash);
      if (!r) return { status: "missing" };
      if (r.usedAt) return { status: "reused", grantId: r.grantId };
      if (!r.codeExpiresAt || new Date(r.codeExpiresAt) <= now) return { status: "missing" };
      r.usedAt = now.toISOString(); return { status: "ok", request: r };
    },
    async insertGrant(g) { const id = `grant${++n}`; grants.set(id, { id, familyId: g.familyId, scopes: g.scopes, oauthClientId: g.oauthClientId, resource: g.resource, refreshExpiresAt: g.refreshExpiresAt, revokedAt: null, accessHash: g.accessHash, refreshHash: g.refreshHash }); return id; },
    async linkGrant(requestId, grantId) { requests.get(requestId)!.grantId = grantId; },
    async findGrantByRefreshHash(h) { return [...grants.values()].find((g) => g.refreshHash === h) ?? null; },
    async rotateGrant(id, old, next) {
      const g = grants.get(id); if (!g || g.refreshHash !== old || g.revokedAt) return false;
      Object.assign(g, { accessHash: next.accessHash, refreshHash: next.refreshHash, refreshExpiresAt: next.refreshExpiresAt }); return true;
    },
    async revokeGrant(id, now) { const g = grants.get(id); if (g && !g.revokedAt) g.revokedAt = now.toISOString(); },
  };
  return { store, requests, grants };
}

async function approvedCode(store: OAuthStore) {
  const id = await store.createAuthRequest({ clientId: CLIENT, clientName: "Claude", redirectUri: REDIRECT, state: "s", codeChallenge: CHALLENGE, scopes: ["family:read", "tasks:write"], resource: RESOURCE, expiresAt: "2026-10-01T12:10:00Z" });
  const code = generateAuthorizationCode();
  expect(await store.approveAuthRequest(id, "fam-1", ["tasks:write"], code.hash, "2026-10-01T12:01:00Z", NOW)).toBe(true);
  return code.code;
}
const exchange = (store: OAuthStore, code: string, over: Partial<Parameters<typeof exchangeAuthorizationCode>[1]> = {}) =>
  exchangeAuthorizationCode(store, { code, codeVerifier: VERIFIER, clientId: CLIENT, redirectUri: REDIRECT, resource: RESOURCE, ...over }, NOW);

test.describe("authorization code", () => {
  test("a valid code yields an access and a refresh token with the granted scopes only", async () => {
    const { store, grants } = memoryStore();
    const r = await exchange(store, await approvedCode(store));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.access_token).toMatch(/^kbi_/);
    expect(r.body.refresh_token).toMatch(/^kbr_/);
    expect(r.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "tasks:write" });
    const [g] = [...grants.values()];
    expect(g.accessHash).toBe(hashIntegrationToken(r.body.access_token));
    expect(g).toMatchObject({ familyId: "fam-1", resource: RESOURCE, oauthClientId: CLIENT });
  });

  test("a code presented twice fails and revokes the connection it produced", async () => {
    const { store, grants } = memoryStore();
    const code = await approvedCode(store);
    expect((await exchange(store, code)).ok).toBe(true);
    const again = await exchange(store, code);
    expect(again).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
    expect([...grants.values()][0].revokedAt).not.toBeNull();
  });

  test("wrong verifier, client, redirect or resource are all refused", async () => {
    for (const over of [
      { codeVerifier: VERIFIER.replace("d", "e") },
      { clientId: "https://evil.example/client" },
      { redirectUri: "https://evil.example/cb" },
    ]) {
      const { store } = memoryStore();
      expect(await exchange(store, await approvedCode(store), over), JSON.stringify(over)).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
    }
    const { store } = memoryStore();
    expect(await exchange(store, await approvedCode(store), { resource: "https://other.example/api/mcp" }))
      .toMatchObject({ ok: false, body: { error: "invalid_target" } });
  });

  test("an omitted resource falls back to the one approved", async () => {
    const { store } = memoryStore();
    expect((await exchange(store, await approvedCode(store), { resource: null })).ok).toBe(true);
  });

  test("an unknown code is invalid_grant", async () => {
    const { store } = memoryStore();
    expect(await exchange(store, "kbo_nothing")).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
  });
});

test.describe("refresh", () => {
  async function connected() {
    const m = memoryStore();
    const r = await exchange(m.store, await approvedCode(m.store));
    if (!r.ok) throw new Error("setup");
    return { ...m, tokens: r.body };
  }
  const refresh = (store: OAuthStore, refreshToken: string, now = NOW, clientId = CLIENT) =>
    refreshAccessToken(store, { refreshToken, clientId, resource: null }, now);

  test("rotates both tokens; the old refresh token is dead afterwards", async () => {
    const { store, tokens } = await connected();
    const r1 = await refresh(store, tokens.refresh_token);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.body.refresh_token).not.toBe(tokens.refresh_token);
    expect(r1.body.access_token).not.toBe(tokens.access_token);
    expect(await refresh(store, tokens.refresh_token)).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
    expect((await refresh(store, r1.body.refresh_token)).ok).toBe(true);
  });

  test("an expired refresh token, a revoked connection or another client are refused", async () => {
    const late = await connected();
    expect(await refresh(late.store, late.tokens.refresh_token, new Date("2026-12-31T12:00:00Z"))).toMatchObject({ ok: false, body: { error: "invalid_grant" } });

    const revoked = await connected();
    await revoked.store.revokeGrant([...revoked.grants.keys()][0], NOW);
    expect(await refresh(revoked.store, revoked.tokens.refresh_token)).toMatchObject({ ok: false, body: { error: "invalid_grant" } });

    const other = await connected();
    expect(await refresh(other.store, other.tokens.refresh_token, NOW, "https://evil.example/c")).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
  });
});
