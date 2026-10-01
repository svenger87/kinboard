import { test, expect } from "@playwright/test";
import { publicOrigin, mcpResource } from "../src/lib/oauth/origin";
import {
  authorizationServerMetadata, protectedResourceMetadata, protectedResourceMetadataUrl, wwwAuthenticate,
} from "../src/lib/oauth/metadata";
import { MCP_SCOPES } from "../src/lib/oauth/config";
import { INTEGRATION_SCOPES } from "../src/lib/integration-auth";

const h = (o: Record<string, string>) => new Headers(o);

test.describe("public origin", () => {
  test("prefers the forwarded scheme and host a reverse proxy sets", () => {
    expect(publicOrigin(h({ "x-forwarded-proto": "https", "x-forwarded-host": "kb.example.com", host: "webapp:3000" }), "http://webapp:3000"))
      .toBe("https://kb.example.com");
  });
  test("uses the first value of a comma-joined chain", () => {
    expect(publicOrigin(h({ "x-forwarded-proto": "https, http", "x-forwarded-host": "kb.example.com, inner" }), "http://x"))
      .toBe("https://kb.example.com");
  });
  test("falls back to Host and the fallback scheme", () => {
    expect(publicOrigin(h({ host: "192.168.1.20:3000" }), "http://192.168.1.20:3000")).toBe("http://192.168.1.20:3000");
  });
  test("drops a default port and lower-cases the host", () => {
    expect(publicOrigin(h({ "x-forwarded-proto": "https", host: "KB.Example.com:443" }), "http://x")).toBe("https://kb.example.com");
  });
  test("ignores a host header that is not a host", () => {
    expect(publicOrigin(h({ host: "evil.com/path?x" }), "http://localhost:3000")).toBe("http://localhost:3000");
  });
  test("the resource is the MCP URL", () => {
    expect(mcpResource("https://kb.example.com")).toBe("https://kb.example.com/api/mcp");
  });
});

test.describe("metadata", () => {
  const origin = "https://kb.example.com";
  test("protected resource names this server and its issuer", () => {
    expect(protectedResourceMetadata(origin)).toMatchObject({
      resource: "https://kb.example.com/api/mcp",
      authorization_servers: ["https://kb.example.com"],
      scopes_supported: [...MCP_SCOPES],
    });
  });
  test("authorization server advertises exactly what Claude and ChatGPT check for", () => {
    const m = authorizationServerMetadata(origin);
    expect(m.issuer).toBe(origin);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    // Claude picks CIMD only when both of these are present.
    expect(m.client_id_metadata_document_supported).toBe(true);
    expect(m.token_endpoint_auth_methods_supported).toEqual(["none"]);
    // ChatGPT uses its stable redirect only when this is true.
    expect(m.authorization_response_iss_parameter_supported).toBe(true);
    expect(m.registration_endpoint).toBe(`${origin}/api/oauth/register`);
  });
  test("the 401 challenge points at the metadata and names scopes", () => {
    expect(wwwAuthenticate(origin)).toBe(
      `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}", scope="${MCP_SCOPES.join(" ")}"`,
    );
    expect(wwwAuthenticate(origin, { error: "insufficient_scope", scope: "notes:read" }))
      .toBe(`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", error="insufficient_scope", scope="notes:read"`);
  });
  test("every MCP scope is a real integration scope", () => {
    for (const s of MCP_SCOPES) expect(INTEGRATION_SCOPES).toContain(s);
  });
});
