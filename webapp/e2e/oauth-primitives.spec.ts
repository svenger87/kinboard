import { test, expect } from "@playwright/test";
import { isValidCodeChallenge, verifyPkceS256 } from "../src/lib/oauth/pkce";
import { buildRedirect, isAcceptableRedirectUri, isLoopbackRedirect, redirectUriMatches } from "../src/lib/oauth/redirect";
import { grantableScopes, parseRequestedScopes, stepUpScopes, unrequestedScopes } from "../src/lib/oauth/scopes";
import { MCP_SCOPES } from "../src/lib/oauth/config";

test.describe("PKCE S256", () => {
  // RFC 7636 appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  test("accepts the RFC test vector", () => expect(verifyPkceS256(verifier, challenge)).toBe(true));
  test("refuses a different verifier", () => expect(verifyPkceS256(verifier.replace("d", "e"), challenge)).toBe(false));
  test("refuses a plain challenge (the verifier itself)", () => expect(verifyPkceS256(verifier, verifier)).toBe(false));
  test("refuses verifiers outside 43-128 unreserved characters", () => {
    expect(verifyPkceS256("short", challenge)).toBe(false);
    expect(verifyPkceS256("a".repeat(129), challenge)).toBe(false);
  });
  test("challenge shape", () => {
    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(isValidCodeChallenge("abc")).toBe(false);
  });
});

test.describe("redirect URIs", () => {
  test("https and http loopback are acceptable; nothing else", () => {
    expect(isAcceptableRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAcceptableRedirectUri("http://localhost:3118/callback")).toBe(true);
    expect(isAcceptableRedirectUri("http://127.0.0.1/callback")).toBe(true);
    expect(isAcceptableRedirectUri("http://192.168.1.5/callback")).toBe(false);
    expect(isAcceptableRedirectUri("https://x.example/cb#frag")).toBe(false);
    expect(isAcceptableRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAcceptableRedirectUri("https://user:pw@x.example/cb")).toBe(false);
  });
  test("exact match for https", () => {
    const reg = ["https://chatgpt.com/connector_platform_oauth_redirect"];
    expect(redirectUriMatches(reg, "https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(redirectUriMatches(reg, "https://chatgpt.com/connector_platform_oauth_redirect/")).toBe(false);
    expect(redirectUriMatches(reg, "https://chatgpt.com/connector_platform_oauth_redirect?x=1")).toBe(false);
  });
  test("loopback matches with the port ignored, nothing else ignored", () => {
    const reg = ["http://localhost/callback", "http://127.0.0.1/callback"];
    expect(redirectUriMatches(reg, "http://localhost:49152/callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://127.0.0.1:3118/callback")).toBe(true);
    expect(redirectUriMatches(reg, "http://localhost:3118/other")).toBe(false);
    expect(redirectUriMatches(["https://localhost/callback"], "https://localhost:8443/callback")).toBe(false);
  });
  test("loopback detection", () => {
    expect(isLoopbackRedirect("http://[::1]:9/cb")).toBe(true);
    expect(isLoopbackRedirect("https://claude.ai/x")).toBe(false);
  });
  test("buildRedirect appends to an existing query and skips empty values", () => {
    expect(buildRedirect("https://a.example/cb?x=1", { code: "c d", state: null, iss: "https://kb.example.com" }))
      .toBe("https://a.example/cb?x=1&code=c+d&iss=https%3A%2F%2Fkb.example.com");
  });
});

test.describe("scopes", () => {
  test("no scope parameter asks for every assistant scope", () => {
    expect(parseRequestedScopes(null)).toEqual([...MCP_SCOPES]);
    expect(parseRequestedScopes("  ")).toEqual([...MCP_SCOPES]);
  });
  test("unknown and OIDC scopes are dropped, order follows MCP_SCOPES", () => {
    expect(parseRequestedScopes("openid offline_access tasks:write family:read admin")).toEqual(["family:read", "tasks:write"]);
  });
  test("only unknown scopes yields nothing", () => expect(parseRequestedScopes("openid email")).toEqual([]));
  test("the user may grant any assistant scope, requested or not, and nothing else", () => {
    // energy:read was not requested but is an assistant scope; events:read is
    // an Integration API scope no assistant is given; the rest are not scopes.
    expect(grantableScopes(["vehicles:read", "tasks:write", "energy:read", "events:read", "admin", "openid", 7, null, ["family:read"]]))
      .toEqual(["tasks:write", "energy:read", "vehicles:read"]);
    expect(grantableScopes(["events:read", "*", "family:read "])).toEqual([]);
  });
  test("what was not requested is offered, in MCP_SCOPES order", () => {
    expect(unrequestedScopes(["family:read", "tasks:write"])).toEqual(MCP_SCOPES.filter((s) => s !== "family:read" && s !== "tasks:write"));
    expect(unrequestedScopes([...MCP_SCOPES])).toEqual([]);
  });
  test("a step-up challenge names what the token holds plus what it needs", () => {
    expect(stepUpScopes(["tasks:write", "family:read", "events:read"], ["vehicles:read"])).toEqual(["family:read", "tasks:write", "vehicles:read"]);
    expect(stepUpScopes([], ["home:control", "pocket_money:write"])).toEqual(["home:control", "pocket_money:write"]);
  });
});
