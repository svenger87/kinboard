import { createServer as createHttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  createMcpHandler, getOAuthProtectedResourceMetadataUrl,
  OAuthError, OAuthErrorCode, requireBearerAuth,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createKinboardClient } from "./client.js";
import { createServer, TOOL_SCOPES } from "./server.js";

const ALL_SCOPES = [...new Set(Object.values(TOOL_SCOPES))];

export function readHttpConfig(env = process.env) {
  const publicUrl = new URL(env.MCP_PUBLIC_URL);
  const issuer = new URL(env.MCP_AUTH_ISSUER);
  const jwksUrl = new URL(env.MCP_JWKS_URL);
  if (publicUrl.protocol !== "https:" || publicUrl.pathname !== "/mcp" || publicUrl.search || publicUrl.hash ||
      issuer.protocol !== "https:" || jwksUrl.protocol !== "https:" || jwksUrl.origin !== issuer.origin) {
    throw new Error("MCP_PUBLIC_URL must be HTTPS /mcp; issuer and JWKS must use HTTPS on the same origin");
  }
  const allowedSubjects = (env.MCP_ALLOWED_SUBJECTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowedSubjects.length === 0) throw new Error("MCP_ALLOWED_SUBJECTS must name at least one authorized identity-provider subject");
  const port = Number(env.MCP_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MCP_PORT must be a valid TCP port");
  const bindHost = env.MCP_BIND_HOST ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0") {
    throw new Error("MCP_BIND_HOST must be 127.0.0.1 or 0.0.0.0");
  }
  return {
    publicUrl, issuer: issuer.href, jwksUrl,
    allowedSubjects: new Set(allowedSubjects), port, bindHost,
    allowedOrigins: new Set([
      publicUrl.origin, "https://chatgpt.com", "https://claude.ai",
      ...(env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    ]),
  };
}

export function createJwtVerifier(config, jwks = createRemoteJWKSet(config.jwksUrl)) {
  return async function verifyAccessToken(token) {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.publicUrl.href,
        algorithms: ["RS256", "ES256"],
      });
      if (!payload.sub || !config.allowedSubjects.has(payload.sub) || !payload.exp) {
        throw new Error("Unapproved subject or missing expiration");
      }
      const scopes = typeof payload.scope === "string"
        ? payload.scope.split(/\s+/).filter(Boolean)
        : Array.isArray(payload.scp) ? payload.scp.filter((s) => typeof s === "string") : [];
      if (scopes.length === 0) throw new Error("Token has no scopes");
      return {
        token, clientId: typeof payload.client_id === "string" ? payload.client_id : payload.sub,
        scopes, expiresAt: payload.exp,
      };
    } catch {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or unauthorized access token");
    }
  };
}

async function writeWebResponse(response, result) {
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
}

/** The gateway binds only to loopback; a TLS reverse proxy exposes it. */
export function createGateway(config, kinboardClient, verifyAccessToken = createJwtVerifier(config)) {
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(config.publicUrl);
  const gate = requireBearerAuth({
    verifier: { verifyAccessToken },
    resourceMetadataUrl: metadataUrl,
  });
  const handler = createMcpHandler(
    () => createServer(kinboardClient, { oauth: true, metadataUrl }),
  );
  // MCP SDK v2 currently drops the OpenAI tool-level securitySchemes extension
  // when serializing tools/list. Add it to that one response shape only.
  const nodeHandler = toNodeHandler({
    fetch: async (request, options) => {
      let isToolsList = false;
      if (request.method === "POST") {
        try { isToolsList = (await request.clone().json())?.method === "tools/list"; } catch { /* SDK handles invalid bodies. */ }
      }
      const result = await handler.fetch(request, options);
      if (!isToolsList) return result;
      const addSchemes = (payload) => {
        if (!Array.isArray(payload?.result?.tools)) return payload;
        for (const tool of payload.result.tools) {
          const scope = TOOL_SCOPES[tool.name];
          if (!scope) throw new Error(`Missing authorization scope for ${tool.name}`);
          tool.securitySchemes = [{ type: "oauth2", scopes: [scope] }];
        }
        return payload;
      };
      const mime = result.headers.get("content-type") ?? "";
      let body;
      if (mime.includes("application/json")) {
        body = JSON.stringify(addSchemes(await result.json()));
      } else if (mime.includes("text/event-stream")) {
        body = (await result.text()).replace(/^data: (.+)$/gm, (line, json) => {
          let parsed;
          try { parsed = JSON.parse(json); } catch { return line; }
          return `data: ${JSON.stringify(addSchemes(parsed))}`;
        });
      } else {
        return result;
      }
      const headers = new Headers(result.headers);
      headers.delete("content-length");
      return new Response(body, { status: result.status, headers });
    },
  });
  const metadata = JSON.stringify({
    resource: config.publicUrl.href,
    authorization_servers: [config.issuer],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
  });

  const http = createHttpServer(async (request, response) => {
    const origin = request.headers.origin;
    if (request.headers.host !== config.publicUrl.host || (origin && !config.allowedOrigins.has(origin))) {
      response.writeHead(403).end();
      return;
    }
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");

    const pathname = request.url?.split("?")[0];
    if (pathname === "/.well-known/oauth-protected-resource" ||
        pathname === "/.well-known/oauth-protected-resource/mcp") {
      if (request.method !== "GET") { response.writeHead(405).end(); return; }
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "public, max-age=300");
      response.end(metadata);
      return;
    }
    if (pathname !== "/mcp") { response.writeHead(404).end(); return; }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "authorization, content-type, mcp-protocol-version, mcp-session-id");
      response.writeHead(204).end();
      return;
    }
    if (request.headers.authorization) {
      const auth = await gate(new Request(config.publicUrl, { method: "GET", headers: request.headers }));
      if (auth instanceof Response) { await writeWebResponse(response, auth); return; }
      request.auth = auth;
    }
    try {
      await nodeHandler(request, response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
    }
  });
  return http;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readHttpConfig();
    const client = createKinboardClient();
    createGateway(config, client).listen(config.port, config.bindHost, () => {
      console.error(`Kinboard MCP listening on ${config.bindHost}:${config.port}`);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid Kinboard MCP HTTP configuration");
    process.exitCode = 1;
  }
}
