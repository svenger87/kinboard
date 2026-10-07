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
  test("Kong's portless forwarded host keeps the port Host carries for the same name", () => {
    expect(publicOrigin(h({ "x-forwarded-proto": "http", "x-forwarded-host": "localhost", host: "localhost:3001" }), "http://webapp:3000"))
      .toBe("http://localhost:3001");
    expect(publicOrigin(h({ "x-forwarded-host": "192.168.1.20", host: "192.168.1.20:3001" }), "http://webapp:3000"))
      .toBe("http://192.168.1.20:3001");
    // A proxy that rewrote Host to something else: the forwarded host stands alone.
    expect(publicOrigin(h({ "x-forwarded-proto": "https", "x-forwarded-host": "kb.example.com", host: "webapp:3000" }), "http://x"))
      .toBe("https://kb.example.com");
    // A forwarded host with its own port is not second-guessed.
    expect(publicOrigin(h({ "x-forwarded-host": "kb.example.com:8443", host: "kb.example.com:3001" }), "http://x"))
      .toBe("http://kb.example.com:8443");
  });
  test("falls back to Host and the fallback scheme", () => {
    expect(publicOrigin(h({ host: "192.168.1.20:3000" }), "http://192.168.1.20:3000")).toBe("http://192.168.1.20:3000");
  });
  test("drops a default port and lower-cases the host", () => {
    expect(publicOrigin(h({ "x-forwarded-proto": "https", host: "KB.Example.com:443" }), "http://x")).toBe("https://kb.example.com");
  });
  test("an upper-case forwarded proto is still https", () => {
    expect(publicOrigin(h({ "x-forwarded-proto": "HTTPS", host: "kb.example.com" }), "http://webapp:3000", undefined))
      .toBe("https://kb.example.com");
  });
  test("no forwarded proto behind a TLS proxy: SITE_URL's https wins for its own host", () => {
    // The proxy forwarded Host but not X-Forwarded-Proto; the request reached
    // Next over plain http. SITE_URL says that name is served over https.
    expect(publicOrigin(h({ host: "kb.example.com" }), "http://kb.example.com", "https://kb.example.com"))
      .toBe("https://kb.example.com");
    // Host case and default ports do not stop the match.
    expect(publicOrigin(h({ host: "KB.Example.com:443" }), "http://webapp:3000", "https://kb.example.com/"))
      .toBe("https://kb.example.com");
    expect(publicOrigin(h({ host: "kb.example.com:80" }), "http://webapp:3000", "https://kb.example.com:443"))
      .toBe("https://kb.example.com");
  });
  test("SITE_URL for a different host is ignored", () => {
    expect(publicOrigin(h({ host: "192.168.1.20:3000" }), "http://192.168.1.20:3000", "https://kb.example.com"))
      .toBe("http://192.168.1.20:3000");
    expect(publicOrigin(h({ host: "kb.example.com:8443" }), "http://x", "https://kb.example.com"))
      .toBe("http://kb.example.com:8443");
    expect(publicOrigin(h({ "x-forwarded-proto": "https", host: "lan.example" }), "http://x", "http://kb.example.com"))
      .toBe("https://lan.example");
  });
  test("SITE_URL never downgrades: a forwarded https stays https under an http SITE_URL", () => {
    expect(publicOrigin(h({ "x-forwarded-proto": "https", host: "kb.example.com" }), "http://webapp:3000", "http://kb.example.com"))
      .toBe("https://kb.example.com");
    expect(publicOrigin(h({ "x-forwarded-proto": "HTTPS", host: "KB.Example.com:443" }), "http://webapp:3000", "http://kb.example.com:80"))
      .toBe("https://kb.example.com");
  });
  test("SITE_URL https upgrades a forwarded http on its own host", () => {
    expect(publicOrigin(h({ "x-forwarded-proto": "http", host: "kb.example.com" }), "http://webapp:3000", "https://kb.example.com"))
      .toBe("https://kb.example.com");
  });
  test("an http SITE_URL changes nothing when the request is plain http", () => {
    expect(publicOrigin(h({ host: "kb.example.com" }), "http://kb.example.com", "http://kb.example.com"))
      .toBe("http://kb.example.com");
    expect(publicOrigin(h({ host: "kb.example.com:3000" }), "http://x", "http://kb.example.com:3000"))
      .toBe("http://kb.example.com:3000");
  });
  test("an unparseable SITE_URL is ignored", () => {
    expect(publicOrigin(h({ host: "kb.example.com" }), "http://kb.example.com", "not a url")).toBe("http://kb.example.com");
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
