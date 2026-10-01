# Kinboard MCP

This MCP server calls Kinboard's versioned Integration API. It has no direct
database access and cannot call arbitrary Home Assistant entities or services.
Use stdio for a local desktop client or Streamable HTTP for a web client.

## Set up

1. In Kinboard, open **Settings → Integrations → New token**. Give this client
   its own token. Grant `family:read` plus only the extra scopes you need:
   `notes:read`, `calendar:write`, `tasks:write`, `shopping:write`,
   `notes:write`, and/or `energy:read`. The token is shown once; store it in your MCP client's
   protected configuration. Revoke it in Kinboard to disconnect the client.
2. In this directory, run `npm ci` with Node.js 22.11 or later.
3. Add a stdio MCP server to your client's configuration. The command is
   `node`, and its argument is the absolute path to `mcp/src/server.js`.
   Set these environment variables for that server process:

   ```text
   KINBOARD_URL=https://your-kinboard-host/
   KINBOARD_INTEGRATION_TOKEN=kbi_<token-created-in-settings>
   ```

   For a Kinboard instance reachable only through trusted local HTTP, also
   set `KINBOARD_ALLOW_HTTP=1`. Localhost HTTP is accepted automatically.
   Do not set this option for an untrusted network.

   For clients that accept an `mcpServers` JSON configuration, the entry has
   this shape (replace the path and values locally):

   ```json
   {
     "mcpServers": {
       "kinboard": {
         "command": "node",
         "args": ["/absolute/path/to/kinboard/mcp/src/server.js"],
         "env": {
           "KINBOARD_URL": "https://your-kinboard-host/",
           "KINBOARD_INTEGRATION_TOKEN": "kbi_<token-created-in-settings>"
         }
       }
     }
   }
   ```

The URL must be the Kinboard origin, without `/api`, credentials, query, or
fragment. The MCP server does not print the token. Do not commit client
configuration containing the token.

## Available tools

| Read | Write |
|---|---|
| Family summary and next birthday | Create task |
| Calendar events and writable calendars | Create calendar event |
| Tasks, shopping items, and notes | Add shopping item, create note |
| Configured solar power and today's solar energy | |

Calendar creation requires the ID of a calendar from
`list_writable_calendars`. Google and CalDAV calendars are written through
using Kinboard's stored provider credentials. ICS subscriptions and read-only
CalDAV calendars are excluded. A provider failure leaves the event in
Kinboard and returns `sync.synced: false`; the assistant must report this.
An all-day event takes `start_date` and `end_date` as `YYYY-MM-DD`, the end
being the last day (inclusive); Kinboard converts them in the family's time
zone. A timed event takes `start_at` and `end_at` with explicit offsets.
Solar readings return Home Assistant's units and observation time; an
unavailable sensor is represented by `null`.

`npm test` exercises the stdio handshake, tool schemas, authentication header,
idempotency key, and URL policy against a local stub. Kinboard's OpenAPI
contract test checks that the backing routes and their scopes match the
published spec; it does not exercise their behaviour.

Each write carries a fresh `Idempotency-Key`, so Kinboard deduplicates a
replayed HTTP request but not a model calling the same tool twice: that
creates two items. Tool descriptions ask the model to confirm ambiguous writes.

## Web clients (ChatGPT and Claude)

For Unraid with a Traefik reverse proxy, use the
[Unraid Compose file](docker-compose.unraid.yml) and
[Traefik overlay](docker-compose.unraid.traefik.yml). Set the variables in
[the example](.env.unraid.example) for your own host.

`npm run start:http` serves the same tools over Streamable HTTP on
`127.0.0.1:8787`. The included [Docker example](docker-compose.web.example.yml)
uses host networking for that loopback bind. Put a TLS reverse proxy in front
of it and expose **both** `/mcp` and
`/.well-known/oauth-protected-resource/mcp` on the same public hostname.
`/.well-known/oauth-protected-resource` is also served for clients that ask
at the root. Preserve the public `Host` header through the proxy.

For a host with Docker Compose and an existing HTTPS reverse proxy:

1. Point a DNS name at the host and terminate HTTPS there. The included
   [Caddy example](Caddyfile.example) forwards only to the loopback gateway.
2. Copy `.env.mcp.example` to `.env.mcp`, set the real values below, and
   restrict that file to its owner (`chmod 600 .env.mcp`).
3. Run `docker compose -f docker-compose.web.example.yml up -d --build`.
4. Check `https://<your-host>/.well-known/oauth-protected-resource/mcp`:
   `resource` must equal `MCP_PUBLIC_URL` and `authorization_servers` must
   identify your identity provider.
5. Add `MCP_PUBLIC_URL` in the ChatGPT or Claude custom MCP connection screen
   and complete OAuth sign-in.

The web gateway requires an external OAuth 2.1 identity provider. Configure it to:

1. Publish authorization-server metadata and a JWKS over HTTPS; use the exact
   issuer string in `MCP_AUTH_ISSUER`. The JWKS must be served from the
   issuer's own origin, and an issuer that is a bare origin is compared with
   a trailing `/`. Providers that host keys elsewhere (Google's are on
   `googleapis.com`) are refused rather than trusted.
2. Support authorization code with PKCE S256. Register ChatGPT and Claude
   clients with the callback URLs shown in their connector setup screens, or
   use Client ID Metadata Documents where the provider supports them. Supply
   each registered client ID and secret in the connector's advanced settings.
3. Issue short-lived JWT access tokens signed with RS256 or ES256. Set the
   token audience to the exact `MCP_PUBLIC_URL`, and grant only the scopes the
   household needs: `family:read`, `notes:read`, `energy:read`,
   `calendar:write`, `tasks:write`, `shopping:write`, and `notes:write`.
4. Put only approved user subject IDs in `MCP_ALLOWED_SUBJECTS`. The gateway
   refuses every other `sub`, even if the identity provider issued a valid
   token. Each household runs its own gateway and Kinboard integration token.

The gateway validates signature, issuer, audience, expiry, subject allowlist,
and scopes before calling Kinboard. It publishes per-tool OAuth metadata and
returns a linking challenge when a tool needs a missing scope. The Kinboard
token stays on the gateway and retains Kinboard's own independent scope check.

In ChatGPT or Claude, add the public `MCP_PUBLIC_URL` as a custom MCP
connection and complete the provider's OAuth sign-in. The gateway needs a
publicly reachable HTTPS hostname; a Kinboard instance that is only on a
private LAN still needs an outbound relay or tunnel before web clients can
reach it. The current package does not deploy a relay.
