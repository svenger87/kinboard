import { test, expect } from "@playwright/test";
import { isCimdClientId, parseClientMetadataDocument, parseRegistrationRequest, resolveClient } from "../src/lib/oauth/clients";

const URL_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";

test.describe("CIMD", () => {
  test("a client id is an https URL with a path", () => {
    expect(isCimdClientId(URL_ID)).toBe(true);
    expect(isCimdClientId("https://claude.ai/")).toBe(false);
    expect(isCimdClientId("http://claude.ai/x")).toBe(false);
    expect(isCimdClientId("kbclient_abc")).toBe(false);
  });
  test("the document must name itself and list acceptable redirects", () => {
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }))
      .toEqual({ clientId: URL_ID, clientName: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"], kind: "cimd" });
    expect(parseClientMetadataDocument(URL_ID, { client_id: "https://evil.example/x", redirect_uris: ["https://a.example/cb"] })).toBeNull();
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, redirect_uris: ["http://192.168.1.2/cb"] })).toBeNull();
    expect(parseClientMetadataDocument(URL_ID, "not json")).toBeNull();
  });
  test("a missing name falls back to the host, a long one is cut", () => {
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, redirect_uris: ["https://claude.ai/cb"] })?.clientName).toBe("claude.ai");
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, client_name: "x".repeat(300), redirect_uris: ["https://claude.ai/cb"] })?.clientName).toHaveLength(100);
  });
});

test.describe("DCR request", () => {
  test("accepts a public client with acceptable redirects", () => {
    expect(parseRegistrationRequest({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "none" }))
      .toEqual({ ok: true, clientName: "ChatGPT", redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"] });
  });
  test("refuses missing or unacceptable redirects", () => {
    expect(parseRegistrationRequest({ client_name: "x" })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseRegistrationRequest({ redirect_uris: ["http://10.0.0.1/cb"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseRegistrationRequest(null)).toMatchObject({ ok: false, error: "invalid_client_metadata" });
  });
});

test.describe("resolveClient", () => {
  const doc = { client_id: URL_ID, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };
  test("fetches a CIMD client once and caches it", async () => {
    let fetches = 0;
    const deps = { fetchDocument: async () => { fetches++; return doc; }, findRegistered: async () => null };
    expect((await resolveClient(URL_ID, deps, 1_000))?.clientName).toBe("Claude");
    expect((await resolveClient(URL_ID, deps, 2_000))?.clientName).toBe("Claude");
    expect(fetches).toBe(1);
    await resolveClient(URL_ID, deps, 1_000 + 11 * 60_000);
    expect(fetches).toBe(2);
  });
  test("a failed fetch is no client, not an exception", async () => {
    const deps = { fetchDocument: async () => { throw new Error("blocked"); }, findRegistered: async () => null };
    expect(await resolveClient("https://other.example/meta", deps)).toBeNull();
  });
  test("a non-URL id is looked up as a registered client", async () => {
    const deps = { fetchDocument: async () => { throw new Error("unused"); }, findRegistered: async (id: string) => id === "kbclient_x" ? { clientId: id, clientName: "ChatGPT", redirectUris: [], kind: "dcr" as const } : null };
    expect((await resolveClient("kbclient_x", deps))?.clientName).toBe("ChatGPT");
    expect(await resolveClient("kbclient_y", deps)).toBeNull();
  });
});
