# AI assistants: self-hosting notes

Part of the [AI assistants](AI-Assistants) guide. This page is for whoever
runs the Kinboard server. Households connecting an assistant want
[Connecting an assistant](AI-Assistants-Connecting).

Kinboard is its own OAuth 2.1 authorization server and MCP server. There is
no separate container, gateway or identity provider to run: the webapp
container serves everything below. What you do need is for the right paths
to be reachable from the right places.

## Who reaches what

ChatGPT and Claude (web, desktop and mobile) call MCP servers **from their
own clouds**. The consent page, on the other hand, opens in a family
member's browser. So Kinboard must be reachable over HTTPS on a public
hostname, and some paths are called by the assistant's servers rather than by
a person.

| Path | Called by | What it is |
|---|---|---|
| `/api/mcp` | the assistant's servers | The MCP endpoint. Without a valid token it answers `401` with a `WWW-Authenticate` header pointing at the next row |
| `/.well-known/oauth-protected-resource/api/mcp` (and `/.well-known/oauth-protected-resource`) | the assistant's servers | Which authorization server protects `/api/mcp`, and the permissions on offer |
| `/.well-known/oauth-authorization-server` | the assistant's servers | The authorization server's endpoints |
| `/api/oauth/register` | the assistant's servers | Registration for clients that don't identify themselves with a metadata document |
| `/api/oauth/token` | the assistant's servers | Exchanges the approval for tokens, and renews them |
| `/icons/icon-512.png`, `/icons/icon-192.png` | the assistant's servers | Kinboard's logo, shown next to the connector |
| `/api/oauth/authorize` | a family member's browser | Checks the request and sends the browser to the consent page |
| `/oauth/consent/…`, `/api/oauth/consent` and the rest of the app | a family member's browser | The consent page. It is a normal Kinboard page, so the whole app (including the database API behind it) has to work in that browser at the public address |

The two `/.well-known/` paths are rewritten by Kinboard itself onto
`/api/oauth/metadata/…`; the proxy only has to pass them through.

Kinboard also makes **outbound** HTTPS requests: an assistant that
identifies itself with a client metadata document (both Claude and ChatGPT
prefer to) gives an HTTPS URL, and Kinboard fetches that document. Requests
to private and loopback addresses are blocked, with a 5-second timeout and a
16 KiB cap.

None of these paths exist until a family switches on **Allow AI
assistants**: until then they all answer `404`. On a server with several
families, they exist as soon as one family has switched it on, but a family
that has it off can neither approve an assistant nor use `/api/mcp`.

### A login page in front of Kinboard

If Kinboard sits behind Cloudflare Access, Authelia, Authentik or a similar
login layer (as [Security and threat model](Security-and-Threat-Model)
recommends for public exposure), the assistant's servers can't get through
it. Exempt the paths in the table that the assistant's servers call:
`/api/mcp`, `/.well-known/oauth-protected-resource*`,
`/.well-known/oauth-authorization-server*`, `/api/oauth/register`,
`/api/oauth/token` and `/icons/`. The paths a person's browser opens can stay
behind the login.

What the exempted paths expose without a login:

- `/api/mcp` does nothing without a valid token.
- The metadata documents are static.
- Registration is limited to 10 per hour per client address, and writes one
  small row.
- The token endpoint is limited to 60 requests a minute per client address,
  and the authorization endpoint to 30. A code is single-use, valid for 60
  seconds and needs the PKCE verifier; a code presented twice revokes the
  connection it produced.

These per-address limits read the client address from `X-Forwarded-For`
(or `X-Real-IP`), so the proxy should set it. Without it, every caller shares
one bucket.

## Reverse proxy

- **Send everything except Kong's paths to the webapp.** The Traefik overlay
  that ships with Kinboard already does: `/rest`, `/auth`, `/storage` and
  `/realtime` go to Kong, and everything else, `/api/oauth/…` and
  `/.well-known/…` included, goes to the webapp. See
  [Self-hosting](Self-hosting#behind-traefik).
- **Don't let the proxy answer `/.well-known/` itself.** Some proxies and
  NAS front ends serve that whole prefix for certificate challenges. Only
  `/.well-known/acme-challenge/` needs to be theirs; the two `oauth-` paths
  must reach Kinboard.
- **Forward the original host and scheme.** Pass the `Host` header through
  unchanged (or set `X-Forwarded-Host`), and set `X-Forwarded-Proto: https`
  when the proxy terminates TLS. See the next section for why.

## The address Kinboard advertises

Kinboard advertises itself under **the address each request arrived on**,
not a fixed setting. It reads `X-Forwarded-Host` (or `Host`) and
`X-Forwarded-Proto`. That way an install reachable at a LAN address and at a
public name gives each caller the name that caller used, and the issuer in
the metadata matches the address the user pasted.

Consequences worth knowing:

- **A connection is tied to the address it was made through.** Each token is
  bound to `<address>/api/mcp` as it was when the connection was approved.
  A connection made through `https://kinboard.example.com` doesn't work if
  the assistant later calls the LAN address, and the other way round. A token
  created by hand is not bound to an address.
- **A proxy that hides HTTPS breaks approval.** If the proxy terminates TLS
  but doesn't send `X-Forwarded-Proto`, the request looks like plain HTTP.
  Kinboard would advertise `http://` addresses, and the consent page, which
  the browser loads over `https://`, would have every approval refused,
  because the page's origin no longer matches. Kinboard corrects this one
  case itself when `SITE_URL` is an `https://` address **with the same
  host** the request arrived on: for that host it assumes HTTPS. It only ever
  upgrades to HTTPS, never downgrades, and leaves other hosts (the LAN
  address) alone. Setting `X-Forwarded-Proto` is still the cleaner fix.
- **The copy button in Settings** builds the address from the page it is on,
  so it is only right for ChatGPT and Claude when Settings is open at the
  public address.

## Checking it from outside

Run these from a machine outside your network (a cloud VM, or a phone
hotspot), with **Allow AI assistants** switched on for at least one family:

    curl -s https://kinboard.example.com/.well-known/oauth-protected-resource/api/mcp

should print JSON whose `resource` is exactly
`https://kinboard.example.com/api/mcp` and whose `authorization_servers` is
`["https://kinboard.example.com"]`. An `http://` address or an internal host
name there means the proxy isn't forwarding the host or the scheme.

    curl -s https://kinboard.example.com/.well-known/oauth-authorization-server

should print the endpoints, all under `https://kinboard.example.com`.

    curl -si https://kinboard.example.com/api/mcp | head -n 20

should answer `401` with a `www-authenticate: Bearer resource_metadata="https://kinboard.example.com/.well-known/oauth-protected-resource/api/mcp", …`
header.

A `404` from all three means the switch is off for every family. An HTML
login page means a login layer is in the way. A certificate error means the
assistant will fail too.

## Upgrading

Assistant support adds tables and columns, and the confirmation prompts on
the screens arrive through realtime. When you upgrade to a version that adds
or changes them:

1. **Let the migrations run.** The webapp container applies every migration
   when it starts and tells PostgREST to reload its schema afterwards; it
   refuses to start against a half-applied schema. If you run them by hand
   instead (`cd webapp/docker && ./start.sh migrate`), that reloads the
   schema too. See [Self-hosting: Updates](Self-hosting#updates).
2. **Restart realtime:** `docker compose restart realtime` (with your usual
   `-f` files). Realtime reads which tables it streams when it starts, so a
   table or a column added while it was running doesn't reach the screens
   until it restarts. Nothing reports this: the screens open their live
   connection as usual and simply never receive the confirmation requests.
3. **Restart `rest` if an error mentions a missing column.** That means
   PostgREST is still on the old schema: `docker compose restart rest`.
4. **Reload every household screen** (or leave them idle; they take a new
   version on their own) before an assistant asks for its first pocket-money
   booking. A screen still on the previous version can't describe a
   pocket-money request: it shows a generic line with no amount or child,
   while still offering the PIN field. What someone approves should always be
   what they read.

## The Integration API

Every assistant tool is a thin adapter over the **Integration API**
(`/api/integration/v1/…`), the same API Home Assistant uses. A tool calls the
matching route inside the server with the assistant's own token, so the
permission checks, family scoping, rate limits, idempotency and error
messages are the Integration API's, not a second copy.

That has a few consequences:

- **An assistant's token is an Integration API token** with the permissions
  the family granted, and it works on the REST API too. Connections made
  through the consent page are marked as assistant tokens, which is what
  applies the [assistant-only limits](AI-Assistants-Permissions-and-Safety#limits)
  and refuses them Home Assistant's `add_pocket_money` service.
- **The API is documented** in `webapp/openapi/integration-v1.yaml`, which a
  test checks against the code on every run: every documented path must
  exist, every route must be documented, and every permission and service
  name must match. The OAuth and MCP endpoints themselves are not part of it.
- **The switch covers `/api/mcp`, not the Integration API.** Home Assistant
  keeps working with **Allow AI assistants** off.

How Home Assistant uses the same API and tokens: [Home Assistant](Home-Assistant).

## Logs

A tool that fails unexpectedly answers the assistant with only *"Kinboard
request failed"*, so no internal detail leaves the server. The detail goes
to the webapp container's log, prefixed `[mcp] tool failed` and the tool's
name:

    docker logs kinboard-webapp 2>&1 | grep '\[mcp\]'

(The container is `kinboard-webapp` unless you changed `PROJECT_NAME`.)

## Design background

The decisions behind all this, with the threat notes, are in the RFCs:
[RFC-010](https://github.com/svenger87/kinboard/blob/main/docs/rfc/010-built-in-mcp.md)
(the built-in MCP server and OAuth),
[RFC-011](https://github.com/svenger87/kinboard/blob/main/docs/rfc/011-assistant-actions.md)
(editing and home control) and
[RFC-012](https://github.com/svenger87/kinboard/blob/main/docs/rfc/012-assistant-coverage.md)
(the rest of Kinboard).
