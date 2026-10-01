# RFC-010 — AI assistants through a built-in MCP endpoint

| | |
|---|---|
| **Status** | Draft — replaces the separate `mcp/` gateway on `feat/mcp-integration-api` (WIP, unreleased) |
| **Date** | 2026-10-01 |
| **Target release** | unscheduled — stays WIP until the open items in §9 are decided |
| **Depends on** | RFC-001 (Integration API, scopes, `integration_tokens`), RFC-002 (Bridge threat model) |

---

## 1. Why the first design is being replaced

The WIP branch shipped an MCP server as its own package (`mcp/`): a stdio server
for desktop clients and a Streamable HTTP gateway for web clients. To connect
ChatGPT or Claude on the web, a household had to:

1. create an integration token and put it in the gateway's environment;
2. run a second container with its own compose overlay and reverse proxy rules;
3. stand up an OAuth identity provider (Auth0 or similar) issuing RS256/ES256 JWTs
   with the gateway URL as audience and JWKS on the issuer's origin;
4. register ChatGPT and Claude as clients there and paste their client IDs and
   secrets into each assistant's advanced connector settings;
5. look up each family member's `sub` and list it in `MCP_ALLOWED_SUBJECTS`;
6. make the gateway reachable from the internet.

Only step 6 is inherent. Claude (web, Desktop, mobile) and ChatGPT call remote
MCP servers **from their own clouds**, so the endpoint must be publicly
reachable whatever we build. Steps 1–5 exist because the gateway borrowed its
login from somebody else's identity provider. Kinboard already knows which
family a browser belongs to and already has scoped, revocable machine tokens; it
only lacked the OAuth front door.

## 2. The decision

**Kinboard serves MCP itself, at `/api/mcp`, and is its own OAuth 2.1
authorization server.** Connecting an assistant becomes:

1. Kinboard is reachable over HTTPS (needed for any remote access anyway);
2. paste `https://<kinboard>/api/mcp` into Claude or ChatGPT;
3. approve the consent page Kinboard opens.

LAN-only households can still use **Claude Code** (it runs on the user's machine
and can reach a LAN URL) either through the same OAuth flow — it uses a loopback
redirect — or with a manually created integration token passed as an
`Authorization` header.

The `mcp/` package (gateway, stdio server, Dockerfile, compose overlays, Auth0
runbook) is deleted.

## 3. Shape

```
Claude / ChatGPT ──► GET  /api/mcp                       401 + WWW-Authenticate: resource_metadata=…
                 ──► GET  /.well-known/oauth-protected-resource/api/mcp
                 ──► GET  /.well-known/oauth-authorization-server
                 ──► (CIMD: Kinboard fetches the client's metadata URL)
                     (DCR:  POST /api/oauth/register)
   browser       ──► GET  /api/oauth/authorize?…        validates, stores a pending request
                 ──► 302  /oauth/consent/<request id>    AuthGuard → /join if this browser isn't joined
                 ──► POST /api/oauth/consent             session + settings PIN → code
                 ──► 302  <redirect_uri>?code=…&state=…&iss=<issuer>
                 ──► POST /api/oauth/token               code + PKCE verifier → access + refresh token
                 ──► POST /api/mcp  Bearer kbi_…         tools → Integration API routes, in process
```

### 3.1 Issuer and resource

- **Issuer** = the public origin of the request (`x-forwarded-proto` /
  `x-forwarded-host`, else `host`). Not `SITE_URL`: an install reachable on the
  LAN by IP and through a tunnel by name must advertise the name it was reached
  by, and a token minted for one origin is bound to it (§3.4), so a spoofed
  `Host` only ever produces tokens that are useless at the real one.
- **Resource** (RFC 8707 / 9728) = `<issuer>/api/mcp`. Both ChatGPT and Claude
  send it as `resource`; it is stored on the token and checked at `/api/mcp`.
- `/.well-known/*` is served through `next.config` rewrites onto
  `/api/oauth/metadata/*` route handlers. The `401` also carries an explicit
  `resource_metadata` pointer, which Claude prefers anyway.

### 3.2 Client identity

- **CIMD** (Client ID Metadata Document) is preferred by both assistants. The
  `client_id` is an HTTPS URL; Kinboard fetches it with the existing `safeFetch`
  (private-address and redirect checks), 5 s timeout, 16 KiB cap, requires the
  document's `client_id` to equal the URL, and caches it for 10 minutes.
- **DCR** is kept as a fallback (RFC 7591). Public clients only
  (`token_endpoint_auth_method: none`), redirect URIs must be HTTPS or HTTP
  loopback. Registration is anonymous, so clients are not family-scoped.
- Metadata advertises `token_endpoint_auth_methods_supported: ["none"]` and
  `client_id_metadata_document_supported: true` — Claude only selects CIMD when
  both are present.

### 3.3 Redirects

- Exact string match against the client's registered redirect URIs, except
  loopback (`http://localhost`, `http://127.0.0.1`, `http://[::1]`), which
  matches with the port ignored (RFC 8252 §7.3; Claude Code uses ephemeral
  ports).
- Every authorization response carries `iss`
  (`authorization_response_iss_parameter_supported: true`) so ChatGPT uses its
  stable redirect `https://chatgpt.com/connector_platform_oauth_redirect`.
- Errors before the client and redirect URI are validated are shown as a page,
  never redirected (open-redirect rule).

### 3.4 Tokens

- One OAuth connection is **one `integration_tokens` row**, named after the
  client ("Claude", "ChatGPT"), shown and revocable under Settings →
  Integrations like any other token. New columns: `oauth_client_id`,
  `resource`, `refresh_token_hash`, `refresh_expires_at`.
- Access token: an ordinary `kbi_` integration token, **1 hour**, in
  `token_hash` / `expires_at`. Existing `evaluateToken` and `withIntegrationAuth`
  work unchanged.
- Refresh token: `kbr_…`, **60 days sliding**, rotated on every use by
  compare-and-swap on the stored hash. A replayed refresh token fails with
  `invalid_grant` and the connection must be re-approved.
- Authorization codes: single use, 60 s, PKCE S256 required. A code presented
  twice revokes the connection it produced.
- `/api/mcp` accepts a token whose resource is NULL (manually created) or
  equals this server's resource. The binding separates origins a client
  legitimately reached; it is not a defence against a token holder, who can
  present any Host/X-Forwarded-Host.
- The REST Integration API accepts all tokens, including OAuth ones: MCP
  tools call it in process with the caller's token, so an assistant's token
  is, by design, an Integration API token with the scopes the family
  granted.

### 3.5 Consent

The consent page sits behind `AuthGuard`, so the browser must be joined to the
family (a device session) — that answers "which family". Approving always
requires the settings PIN, verified server-side through the same rate-limited
check `/api/pin` uses; if the family has none, the consent page sets one
(entered twice) in the same step.

The page shows the client name, the redirect **hostname** (MCP spec: required,
with an extra warning when only loopback redirects are registered), and the
requested scopes as checkboxes, ticked; the user may grant fewer.

Below them, under "Also available — <client> didn't ask for these", it lists
every other assistant scope (`MCP_SCOPES`), **unticked**, with the same
labels. Clients cache the scope list from when the connector was created
and replay it on every reconnect — ChatGPT does — so a scope Kinboard adds
later is never requested and, before this, could never be granted: on prod a
ChatGPT connection reconnected three times with its 11 cached scopes while
`/.well-known/oauth-protected-resource/api/mcp` advertised 15, and its token
never got `vehicles:read`. The consent POST therefore accepts any subset of
`MCP_SCOPES`, requested or not; anything else (an Integration API scope such
as `events:read`, an unknown string, a non-string) is dropped as before, and
nothing left is 400 `no_scopes`. This widens nothing without the user: each
extra scope is opt-in by ticking it, the PIN is still required to approve,
and the Origin check, browser binding, "Allow AI assistants" switch and
request expiry are unchanged. The granted set is what is stored on the
request and the grant, returned as the token response's `scope` (RFC 6749
§5.1 — it differs from the request exactly in this case), and kept by every
refresh.

A tool refused for scope answers with an `insufficient_scope` challenge in
the result's `_meta["mcp/www_authenticate"]` (the in-band form ChatGPT reads;
the HTTP status stays 200, as a JSON-RPC tool result). Its `scope` is the
token's current assistant scopes plus the tool's, so a client that
re-authorizes on it requests what it already had as well as what it lacks.

Twenty wrong PINs within an hour lock PIN entry (settings and consent) for
the rest of that hour.

The PIN is enforced on the server, not only by the screen in front of
Settings. Changing or removing the PIN, creating or revoking an integration
token, and switching AI assistants on or off all require a **settings
unlock**: a correct PIN entry records `settings_unlocked_until` on the device
session that entered it, fifteen minutes ahead, and those routes answer 403
`pin_required` without it (the settings UI then shows the PIN screen again).
Approving an assistant checks the PIN itself in the same request. A family
without a PIN needs no unlock, and its first PIN — from Settings or inline on
the consent page — is stored only if none exists at that moment (an atomic
insert-if-absent; losing that race is 409 `pin_changed`), so nobody can
replace a PIN they never knew. A forgotten PIN is reset by deleting the
family's `settings_pin` row from `integration_secrets`; the wiki's
AI-Assistants page has the one-line command.

### 3.6 Tools

The MCP server is built per request (`createMcpHandler` from
`@modelcontextprotocol/server`, web-standard `fetch`, stateless). Tools are thin
adapters: each one calls the **existing Integration API route handler in
process** with the caller's own bearer token. Scope checks, family scoping, rate
limits, idempotency and error codes are therefore the Integration API's, not a
second copy. Tool set and scopes are unchanged from the WIP gateway
(`family:read`, `notes:read`, `calendar:write`, `tasks:write`, `shopping:write`,
`notes:write`, `energy:read`). RFC-011 later grows this considerably —
editing and deleting, meal planning, messaging the screens, and Home
Assistant actuation — superseding this paragraph.

## 4. Threat notes (against RFC-002)

- This is the first path by which something outside the house acts inside it.
  RFC-002 §6's "never" list holds: **no actuation**. No tool reaches Home
  Assistant services, locks, alarms or presence; `energy:read` reads only
  sensors configured in Kinboard's energy settings — two solar sensors when
  this was written, every configured energy sensor (solar, battery, grid,
  consumption) since RFC-012 §5.8, never an arbitrary entity. RFC-011 later
  lifts the actuation rule, for devices in a household-built catalogue and
  behind PIN confirmation for sensitive actions — superseding this bullet.
- The new anonymous surface is: metadata (static), DCR (rate-limited, writes a
  bounded row), authorize (validates, writes a 10-minute pending row), token
  (rate-limited). It exists only once a family has switched on **Allow AI
  assistants** (a per-family setting, off by default): until then these
  routes and `/api/mcp` answer 404. A family that has it off cannot approve
  an assistant or use `/api/mcp`, whatever other families on the install
  chose; switching it off revokes the family's assistant connections. The
  Integration API is not behind the switch. Each is added to `api-route-auth.spec.ts`'s
  `PUBLIC_BY_DESIGN` with its argument.
- CIMD makes Kinboard fetch an attacker-chosen URL: `safeFetch` blocks private
  and loopback addresses on every hop; the DNS-rebinding race documented there
  applies, with a JSON document as the payoff.
- Approving requires a joined device and, if set, the PIN. That is the trust
  level of the settings pages today; §9 asks whether it is enough.

## 5. Out of scope

- Remote reachability (tunnels, the Bridge). Documented, not built.
- A desktop extension (MCPB) for Claude Desktop on LAN-only installs.
- MCP Apps widgets, elicitation, prompts, resources.
- `private_key_jwt` client authentication.

## 6–8. Compatibility

Nothing released depends on the WIP gateway. The Integration API contract
(RFC-001) is unchanged apart from the routes already on the WIP branch.

## 9. Open before release

1. Decided 2026-10-01: the PIN is mandatory for approving an assistant; a
   family without one sets it on the consent page.
2. Should OAuth connections be visually separate from manual tokens in
   Settings (proposed: same list, labelled "Assistant").
3. CHANGELOG, wiki page and release notes once the WIP label comes off.
