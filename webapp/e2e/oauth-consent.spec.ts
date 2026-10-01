import { test, expect } from "@playwright/test";
import { decideConsent, type ConsentDeps, type ConsentInput } from "../src/lib/oauth/consent";
import type { AuthRequest } from "../src/lib/oauth/types";

const ORIGIN = "https://kb.example.com";
const NOW = new Date("2026-10-01T12:00:00Z");

function authRequest(over: Partial<AuthRequest> = {}): AuthRequest {
  return {
    id: "req-1",
    clientId: "https://claude.ai/meta",
    clientName: "Claude",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    state: "xyz",
    codeChallenge: "challenge",
    scopes: ["family:read", "tasks:write"],
    resource: `${ORIGIN}/api/mcp`,
    expiresAt: "2026-10-01T12:10:00.000Z",
    familyId: null,
    grantedScopes: null,
    codeExpiresAt: null,
    usedAt: null,
    grantId: null,
    ...over,
  };
}

function fakeDeps(over: Partial<ConsentDeps> = {}) {
  const calls: { hasPin: unknown[][]; verifyPin: unknown[][]; setPinIfAbsent: unknown[][]; approve: unknown[][]; deny: unknown[][] } = {
    hasPin: [], verifyPin: [], setPinIfAbsent: [], approve: [], deny: [],
  };
  const deps: ConsentDeps = {
    async hasPin(familyId) { calls.hasPin.push([familyId]); return false; },
    async verifyPin(familyId, pin) { calls.verifyPin.push([familyId, pin]); return "valid"; },
    async setPinIfAbsent(familyId, pin) { calls.setPinIfAbsent.push([familyId, pin]); return true; },
    async approve(...args) { calls.approve.push(args); return true; },
    async deny(...args) { calls.deny.push(args); },
    newCode: () => ({ code: "kbo_test", hash: "hash_test" }),
    ...over,
  };
  return { deps, calls };
}

const input = (over: Partial<ConsentInput> = {}): ConsentInput => ({
  request: authRequest(),
  familyId: "fam-1",
  origin: ORIGIN,
  decision: "approve",
  pin: undefined,
  newPin: undefined,
  scopes: ["family:read", "tasks:write"],
  now: NOW,
  ...over,
});

test("approve with the correct PIN redirects with code, state and iss", async () => {
  const { deps } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "valid" });
  const r = await decideConsent(deps, input({ pin: "1234" }));
  expect(r.status).toBe(200);
  if (r.status !== 200) return;
  const u = new URL(r.redirect);
  expect(u.searchParams.get("code")).toBe("kbo_test");
  expect(u.searchParams.get("state")).toBe("xyz");
  expect(u.searchParams.get("iss")).toBe(ORIGIN);
});

test("wrong PIN: 403 pin_invalid, approve is never called", async () => {
  const { deps, calls } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "invalid" });
  const r = await decideConsent(deps, input({ pin: "0000" }));
  expect(r).toMatchObject({ status: 403, error: "pin_invalid" });
  expect(calls.approve).toEqual([]);
});

test("rate-limited PIN: 429", async () => {
  const { deps } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "rate_limited" });
  const r = await decideConsent(deps, input({ pin: "0000" }));
  expect(r).toMatchObject({ status: 429, error: "rate_limited" });
});

test("no PIN yet + a valid newPin: setPin is called, then approve", async () => {
  const order: string[] = [];
  let setPinArgs: [string, string] | null = null;
  const { deps } = fakeDeps({
    hasPin: async () => false,
    setPinIfAbsent: async (familyId, pin) => { setPinArgs = [familyId, pin]; order.push("setPin"); return true; },
    approve: async () => { order.push("approve"); return true; },
  });
  const r = await decideConsent(deps, input({ newPin: "4321" }));
  expect(r.status).toBe(200);
  expect(order).toEqual(["setPin", "approve"]);
  expect(setPinArgs).toEqual(["fam-1", "4321"]);
});

test("no PIN yet + empty scopes: 400 no_scopes, setPin is never called", async () => {
  const { deps, calls } = fakeDeps({ hasPin: async () => false });
  const r = await decideConsent(deps, input({ newPin: "4321", scopes: [] }));
  expect(r).toMatchObject({ status: 400, error: "no_scopes" });
  expect(calls.setPinIfAbsent).toEqual([]);
});

test("no PIN yet + a malformed newPin: 400 new_pin_invalid", async () => {
  const { deps, calls } = fakeDeps({ hasPin: async () => false });
  const r = await decideConsent(deps, input({ newPin: "12a4" }));
  expect(r).toMatchObject({ status: 400, error: "new_pin_invalid" });
  expect(calls.setPinIfAbsent).toEqual([]);
});

test("PIN already exists + only newPin supplied: 403 pin_invalid, setPin never called (newPin ignored)", async () => {
  let verifyPinArgs: [string, string] | null = null;
  const { deps, calls } = fakeDeps({
    hasPin: async () => true,
    verifyPin: async (familyId, pin) => { verifyPinArgs = [familyId, pin]; return pin === "" ? "invalid" : "valid"; },
  });
  const r = await decideConsent(deps, input({ newPin: "4321", pin: undefined }));
  expect(r).toMatchObject({ status: 403, error: "pin_invalid" });
  expect(calls.setPinIfAbsent).toEqual([]);
  expect(verifyPinArgs).toEqual(["fam-1", ""]);
});

test("no PIN yet, but one appears before the new PIN is stored: 409 pin_changed, approve is never called", async () => {
  // hasPin said "none" at the top; by the time the insert-if-absent runs, a
  // PIN set elsewhere has won. This caller never knew that PIN, so nothing
  // may be approved on the strength of the one they just typed.
  const { deps, calls } = fakeDeps({ hasPin: async () => false, setPinIfAbsent: async () => false });
  const r = await decideConsent(deps, input({ newPin: "4321" }));
  expect(r).toMatchObject({ status: 409, error: "pin_changed" });
  expect(calls.approve).toEqual([]);
});

test("the requested scopes as ticked are what is granted", async () => {
  const { deps, calls } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "valid" });
  expect((await decideConsent(deps, input({ pin: "1234" }))).status).toBe(200);
  expect(calls.approve[0][2]).toEqual(["family:read", "tasks:write"]);
  // Fewer than requested, as before.
  const fewer = fakeDeps({ hasPin: async () => true, verifyPin: async () => "valid" });
  expect((await decideConsent(fewer.deps, input({ pin: "1234", scopes: ["tasks:write"] }))).status).toBe(200);
  expect(fewer.calls.approve[0][2]).toEqual(["tasks:write"]);
});

test("an assistant scope the client did not request can be granted when ticked", async () => {
  // The prod case: ChatGPT replays its cached scope list, which predates
  // vehicles:read; the family ticks it on the consent page.
  const { deps, calls } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "valid" });
  const r = await decideConsent(deps, input({ pin: "1234", scopes: ["family:read", "tasks:write", "vehicles:read"] }));
  expect(r.status).toBe(200);
  expect(calls.approve[0][2]).toEqual(["family:read", "tasks:write", "vehicles:read"]);
});

test("anything that is not an assistant scope is dropped, requested or not", async () => {
  const { deps, calls } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "valid" });
  const r = await decideConsent(deps, input({
    pin: "1234",
    request: authRequest({ scopes: ["family:read"] }),
    scopes: ["family:read", "energy:read", "events:read", "not-a-real-scope", "*", 42, { scope: "home:control" }],
  }));
  expect(r.status).toBe(200);
  expect(calls.approve[0][2]).toEqual(["family:read", "energy:read"]);
});

test("only unsupported scopes ticked: 400 no_scopes, nothing approved", async () => {
  const { deps, calls } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "valid" });
  const r = await decideConsent(deps, input({ pin: "1234", scopes: ["events:read", "admin", "openid"] }));
  expect(r).toMatchObject({ status: 400, error: "no_scopes" });
  expect(calls.approve).toEqual([]);
});

test("an unrequested scope still needs the PIN", async () => {
  const { deps, calls } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "invalid" });
  const r = await decideConsent(deps, input({ pin: "0000", scopes: ["vehicles:read"] }));
  expect(r).toMatchObject({ status: 403, error: "pin_invalid" });
  expect(calls.approve).toEqual([]);
});

test("approve() returning false: 404 not_found", async () => {
  const { deps } = fakeDeps({ hasPin: async () => true, verifyPin: async () => "valid", approve: async () => false });
  const r = await decideConsent(deps, input({ pin: "1234" }));
  expect(r).toMatchObject({ status: 404, error: "not_found" });
});

test("deny redirects with error=access_denied, state and iss, with no PIN needed", async () => {
  const { deps, calls } = fakeDeps({ hasPin: async () => { throw new Error("hasPin should not be called on deny"); } });
  const r = await decideConsent(deps, input({ decision: "deny" }));
  expect(r.status).toBe(200);
  if (r.status !== 200) return;
  const u = new URL(r.redirect);
  expect(u.searchParams.get("error")).toBe("access_denied");
  expect(u.searchParams.get("state")).toBe("xyz");
  expect(u.searchParams.get("iss")).toBe(ORIGIN);
  expect(calls.deny).toEqual([["req-1", NOW]]);
});
