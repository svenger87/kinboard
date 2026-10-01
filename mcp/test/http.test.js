import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createGateway, createJwtVerifier, readHttpConfig } from "../src/http.js";

const publicUrl = new URL("https://mcp.example.test/mcp");
const config = {
  publicUrl,
  issuer: "https://issuer.example.test/",
  jwksUrl: new URL("https://issuer.example.test/jwks"),
  allowedSubjects: new Set(["family-admin"]),
  allowedOrigins: new Set(["https://chatgpt.com"]),
};

test("web configuration fails closed without HTTPS and an allowed subject", () => {
  const base = {
    MCP_PUBLIC_URL: publicUrl.href,
    MCP_AUTH_ISSUER: config.issuer,
    MCP_JWKS_URL: config.jwksUrl.href,
  };
  assert.throws(() => readHttpConfig(base), /MCP_ALLOWED_SUBJECTS/);
  assert.throws(() => readHttpConfig({ ...base, MCP_PUBLIC_URL: "http://mcp.example.test/mcp", MCP_ALLOWED_SUBJECTS: "family-admin" }), /HTTPS/);
  assert.throws(() => readHttpConfig({ ...base, MCP_JWKS_URL: "https://elsewhere.test/jwks", MCP_ALLOWED_SUBJECTS: "family-admin" }), /same origin/);
  assert.throws(() => readHttpConfig({ ...base, MCP_ALLOWED_SUBJECTS: "family-admin", MCP_BIND_HOST: "192.0.2.1" }), /MCP_BIND_HOST/);
  assert.equal(readHttpConfig({ ...base, MCP_ALLOWED_SUBJECTS: "family-admin", MCP_BIND_HOST: "0.0.0.0" }).bindHost, "0.0.0.0");
});

test("JWT verifier checks issuer, audience, subject, expiry, and scopes", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const verify = createJwtVerifier(config, createLocalJWKSet({ keys: [jwk] }));
  const sign = async ({ sub = "family-admin", aud = config.publicUrl.href, ...claims } = {}) => new SignJWT({ scope: "family:read", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.issuer)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
  const accepted = await verify(await sign());
  assert.equal(accepted.clientId, "family-admin");
  assert.deepEqual(accepted.scopes, ["family:read"]);
  await assert.rejects(verify(await sign({ sub: "outsider" })), /Invalid or unauthorized/);
  await assert.rejects(verify(await sign({ aud: "https://other.test/mcp" })), /Invalid or unauthorized/);
  await assert.rejects(verify(await sign({ scope: "" })), /Invalid or unauthorized/);
});

function request(port, path, { body, authorization, host = publicUrl.host, origin } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path, method: body ? "POST" : "GET",
      headers: {
        Host: host,
        ...(body ? { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test("HTTP MCP serves discovery, rejects unauthorized callers, and enforces tool scope", async () => {
  const calls = [];
  const gateway = createGateway(config, { request: async (path) => { calls.push(path); return { ok: true }; } }, async (token) => ({
    token, clientId: "test-client", scopes: ["family:read"], expiresAt: Math.floor(Date.now() / 1000) + 300,
  }));
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const port = gateway.address().port;
  try {
    const metadata = await request(port, "/.well-known/oauth-protected-resource/mcp");
    assert.equal(metadata.status, 200);
    assert.deepEqual(JSON.parse(metadata.text).authorization_servers, [config.issuer]);
    assert.equal((await request(port, "/mcp", { host: "evil.test" })).status, 403);
    assert.equal((await request(port, "/mcp", { origin: "https://evil.test" })).status, 403);
    const listed = await request(port, "/mcp", {
      body: { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
    });
    assert.equal(listed.status, 200);
    const payload = JSON.parse(listed.text.match(/data: (\{[^\n]+\})/)?.[1] ?? listed.text);
    const writeTool = payload.result.tools.find((tool) => tool.name === "create_note");
    assert.deepEqual(writeTool.securitySchemes, [{ type: "oauth2", scopes: ["notes:write"] }]);

    const anonymous = await request(port, "/mcp", {
      body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_note", arguments: { text: "secret" } } },
    });
    assert.equal(anonymous.status, 200);
    assert.match(anonymous.text, /mcp\/www_authenticate/);
    assert.match(anonymous.text, /invalid_token/);

    const denied = await request(port, "/mcp", {
      authorization: "Bearer test",
      body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_note", arguments: { text: "secret" } } },
    });
    assert.equal(denied.status, 200);
    assert.match(denied.text, /insufficient_scope/);
    assert.match(denied.text, /notes:write/);

    const permitted = await request(port, "/mcp", {
      authorization: "Bearer test",
      body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_family_summary", arguments: {} } },
    });
    assert.equal(permitted.status, 200);
    assert.deepEqual(calls, ["/family/summary"]);
    assert.match(permitted.text, /ok/);
  } finally {
    gateway.close();
    await once(gateway, "close");
  }
});
