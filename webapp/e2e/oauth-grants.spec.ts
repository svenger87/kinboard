import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { exchangeAuthorizationCode, generateAuthorizationCode, grantName, refreshAccessToken, type GrantDeps } from "../src/lib/oauth/grants";
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
  const requests = new Map<string, AuthRequest & { codeHash: string | null; replayedAt: string | null }>();
  const grants = new Map<string, GrantRecord & { accessHash: string; refreshHash: string; name: string; requestId: string }>();
  let n = 0;
  const store: OAuthStore = {
    async createAuthRequest(r) { const id = `req${++n}`; requests.set(id, { ...r, id, familyId: null, grantedScopes: null, codeExpiresAt: null, usedAt: null, grantId: null, codeHash: null, replayedAt: null }); return id; },
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
      if (r.usedAt) { r.replayedAt = now.toISOString(); return { status: "reused", requestId: r.id }; }
      if (!r.codeExpiresAt || new Date(r.codeExpiresAt) <= now) return { status: "missing" };
      r.usedAt = now.toISOString(); return { status: "ok", request: r };
    },
    async insertGrant(g) { const id = `grant${++n}`; grants.set(id, { id, requestId: g.requestId, name: g.name, familyId: g.familyId, scopes: g.scopes, oauthClientId: g.oauthClientId, resource: g.resource, refreshExpiresAt: g.refreshExpiresAt, revokedAt: null, accessHash: g.accessHash, refreshHash: g.refreshHash }); return id; },
    async linkGrant(requestId, grantId) { requests.get(requestId)!.grantId = grantId; },
    async wasReplayed(requestId) { return !!requests.get(requestId)?.replayedAt; },
    async revokeGrantsForRequest(requestId, now) { for (const g of grants.values()) if (g.requestId === requestId && !g.revokedAt) g.revokedAt = now.toISOString(); },
    async findGrantByRefreshHash(h) { return [...grants.values()].find((g) => g.refreshHash === h) ?? null; },
    async rotateGrant(id, old, next) {
      const g = grants.get(id); if (!g || g.refreshHash !== old || g.revokedAt) return false;
      Object.assign(g, { accessHash: next.accessHash, refreshHash: next.refreshHash, refreshExpiresAt: next.refreshExpiresAt }); return true;
    },
    async revokeGrant(id, now) { const g = grants.get(id); if (g && !g.revokedAt) g.revokedAt = now.toISOString(); },
  };
  return { store, requests, grants };
}

async function approvedCode(store: OAuthStore, familyId = "fam-1") {
  const id = await store.createAuthRequest({ clientId: CLIENT, clientName: "Claude", redirectUri: REDIRECT, state: "s", codeChallenge: CHALLENGE, scopes: ["family:read", "tasks:write"], resource: RESOURCE, expiresAt: "2026-10-01T12:10:00Z" });
  const code = generateAuthorizationCode();
  expect(await store.approveAuthRequest(id, familyId, ["tasks:write"], code.hash, "2026-10-01T12:01:00Z", NOW)).toBe(true);
  return code.code;
}
/** Assistants switched on for every family unless a test says otherwise — no database behind these tests. */
const ON: GrantDeps = { isEnabledFor: async () => true };
const OFF: GrantDeps = { isEnabledFor: async () => false };
const exchange = (store: OAuthStore, code: string, over: Partial<Parameters<typeof exchangeAuthorizationCode>[1]> = {}, deps = ON) =>
  exchangeAuthorizationCode(store, { code, codeVerifier: VERIFIER, clientId: CLIENT, redirectUri: REDIRECT, resource: RESOURCE, ...over }, NOW, deps);

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

  test("a replay racing the first exchange before its grant exists still revokes it", async () => {
    // The second presentation arrives after the first consumed the code but
    // before it inserted the grant: the replay's revoke finds nothing, so the
    // first exchange must notice the replay itself.
    const m = memoryStore();
    const code = await approvedCode(m.store);
    let replay: Awaited<ReturnType<typeof exchange>> | null = null;
    const racing: OAuthStore = {
      ...m.store,
      async insertGrant(g) {
        replay = await exchange(m.store, code);
        return m.store.insertGrant(g);
      },
    };
    const first = await exchange(racing, code);
    expect(replay).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
    expect(first).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
    const [g] = [...m.grants.values()];
    expect(g.revokedAt).not.toBeNull();
  });

  test("a replay racing between the grant insert and its link revokes it by request id", async () => {
    const m = memoryStore();
    const code = await approvedCode(m.store);
    let revokedDuringReplay: string | null = null;
    const racing: OAuthStore = {
      ...m.store,
      async linkGrant(requestId, grantId) {
        // grant_id is not linked yet, so only the request id can find it.
        await exchange(m.store, code);
        revokedDuringReplay = m.grants.get(grantId)!.revokedAt;
        return m.store.linkGrant(requestId, grantId);
      },
    };
    expect(await exchange(racing, code)).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
    expect(revokedDuringReplay).not.toBeNull();
  });

  test("a second connection from the same assistant in the same family leaves the first one active", async () => {
    // Two household members, each connecting their own Claude: same client id, same family.
    const m = memoryStore();
    const first = await exchange(m.store, await approvedCode(m.store, "fam-1"));
    const second = await exchange(m.store, await approvedCode(m.store, "fam-1"));
    expect(first.ok && second.ok).toBe(true);
    const [g1, g2] = [...m.grants.values()];
    expect(g1).toMatchObject({ familyId: "fam-1", oauthClientId: CLIENT, revokedAt: null });
    expect(g2).toMatchObject({ familyId: "fam-1", oauthClientId: CLIENT, revokedAt: null });
    // And the first one still refreshes.
    if (!first.ok) return;
    expect((await refreshAccessToken(m.store, { refreshToken: first.body.refresh_token, clientId: CLIENT, resource: null }, NOW, ON)).ok).toBe(true);
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

  test("a family with assistants switched off gets no connection, and the code is spent", async () => {
    const m = memoryStore();
    const code = await approvedCode(m.store);
    const asked: string[] = [];
    const off = { isEnabledFor: async (fid: string) => { asked.push(fid); return false; } };
    expect(await exchange(m.store, code, {}, off))
      .toEqual({ ok: false, body: { error: "invalid_grant", error_description: "assistants are switched off" } });
    expect(asked).toEqual(["fam-1"]);
    expect(m.grants.size).toBe(0);
    // Switching back on does not make the old code good again.
    expect(await exchange(m.store, code)).toMatchObject({ ok: false, body: { error: "invalid_grant", error_description: "code already used" } });
    expect(m.grants.size).toBe(0);
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
  const refresh = (store: OAuthStore, refreshToken: string, now = NOW, clientId = CLIENT, deps = ON) =>
    refreshAccessToken(store, { refreshToken, clientId, resource: null }, now, deps);

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

  test("a family that switched assistants off is refused and its connection revoked", async () => {
    const { store, grants, tokens } = await connected();
    expect(await refresh(store, tokens.refresh_token, NOW, CLIENT, OFF))
      .toEqual({ ok: false, body: { error: "invalid_grant", error_description: "assistants are switched off" } });
    const [g] = [...grants.values()];
    expect(g.revokedAt).not.toBeNull();
    // Switching back on does not revive it.
    expect(await refresh(store, tokens.refresh_token)).toMatchObject({ ok: false, body: { error: "invalid_grant" } });
  });
});

test.describe("scopes the client did not request", () => {
  // ChatGPT's cached list, which predates vehicles:read; the family ticked
  // vehicles:read on the consent page and left tasks:write unticked.
  const REQUESTED = ["family:read", "notes:read", "calendar:write", "tasks:write"] as const;
  const GRANTED = ["family:read", "calendar:write", "vehicles:read"] as const;

  async function grantedBeyondRequest() {
    const m = memoryStore();
    const id = await m.store.createAuthRequest({ clientId: CLIENT, clientName: "ChatGPT", redirectUri: REDIRECT, state: "s", codeChallenge: CHALLENGE, scopes: [...REQUESTED], resource: RESOURCE, expiresAt: "2026-10-01T12:10:00Z" });
    const code = generateAuthorizationCode();
    expect(await m.store.approveAuthRequest(id, "fam-1", [...GRANTED], code.hash, "2026-10-01T12:01:00Z", NOW)).toBe(true);
    return { ...m, code: code.code };
  }

  test("the token response's scope is the granted set, not the requested one (RFC 6749 §5.1)", async () => {
    const { store, grants, code } = await grantedBeyondRequest();
    const r = await exchange(store, code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.scope).toBe(GRANTED.join(" "));
    expect(r.body.scope.split(" ")).not.toEqual([...REQUESTED]);
    expect([...grants.values()][0].scopes).toEqual([...GRANTED]);
  });

  test("refreshing keeps the granted set, round after round, and never narrows it to the request", async () => {
    const { store, grants, code } = await grantedBeyondRequest();
    const first = await exchange(store, code);
    if (!first.ok) throw new Error("setup");
    let refreshToken = first.body.refresh_token;
    for (let round = 0; round < 3; round++) {
      const r = await refreshAccessToken(store, { refreshToken, clientId: CLIENT, resource: null }, NOW, ON);
      expect(r.ok, `round ${round}`).toBe(true);
      if (!r.ok) return;
      expect(r.body.scope, `round ${round}`).toBe(GRANTED.join(" "));
      refreshToken = r.body.refresh_token;
    }
    expect([...grants.values()][0].scopes).toEqual([...GRANTED]);
  });
});

test.describe("the name a connection is listed under", () => {
  test("a CIMD client keeps the name its own host published", () => {
    expect(grantName(CLIENT, "Claude", REDIRECT)).toBe("Claude");
  });

  test("a self-registered client carries the host it returns to", () => {
    expect(grantName("kbclient_abc", "Claude", "http://127.0.0.1:53682/callback")).toBe("Claude (127.0.0.1:53682)");
    expect(grantName("kbclient_abc", "Claude", "https://evil.example/cb")).toBe("Claude (evil.example)");
  });

  test("the exchange stores that name", async () => {
    const { store, grants } = memoryStore();
    const dcrRedirect = "http://127.0.0.1:53682/callback";
    const id = await store.createAuthRequest({ clientId: "kbclient_abc", clientName: "Claude", redirectUri: dcrRedirect, state: null, codeChallenge: CHALLENGE, scopes: ["family:read"], resource: RESOURCE, expiresAt: "2026-10-01T12:10:00Z" });
    const code = generateAuthorizationCode();
    await store.approveAuthRequest(id, "fam-1", ["family:read"], code.hash, "2026-10-01T12:01:00Z", NOW);
    const r = await exchangeAuthorizationCode(store, { code: code.code, codeVerifier: VERIFIER, clientId: "kbclient_abc", redirectUri: dcrRedirect, resource: null }, NOW, ON);
    expect(r.ok).toBe(true);
    expect([...grants.values()][0].name).toBe("Claude (127.0.0.1:53682)");

    const cimd = memoryStore();
    expect((await exchange(cimd.store, await approvedCode(cimd.store))).ok).toBe(true);
    expect([...cimd.grants.values()][0].name).toBe("Claude");
  });
});
