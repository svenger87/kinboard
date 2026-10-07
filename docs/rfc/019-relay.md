# RFC-019 — A blind relay: Kinboard from anywhere, and assistants without the setup

| | |
|---|---|
| **Status** | Draft 2026-10-07, for review. Tunnel and GDPR approach decided (§3.1, §9.1) |
| **Prompted by** | Listing Kinboard in the Claude connector directory and ChatGPT's app directory; families who can't expose their Kinboard to the internet |

## 1. Why

Connecting ChatGPT or Claude to Kinboard works today, but only for households that can do four things:

1. Make Kinboard reachable from the internet over HTTPS: a domain, a Cloudflare Tunnel or a reverse proxy, and a certificate. This is the step most families never get past.
2. In ChatGPT, turn on developer mode (a paid plan only) and accept its warnings. That's the only way to add an MCP server by URL.
3. Paste `https://<their host>/api/mcp` and pick OAuth.
4. Approve permissions with the settings PIN.

Both directories would remove steps 2 and 3, but neither fits a self-hosted product as it is:

- **Claude's directory** accepts servers with per-customer URLs through a *URL pattern*, an anchored regular expression every customer's URL must match. Kinboard households use arbitrary domains, so the only pattern that fits is open on the host. Whether Anthropic accepts that is an open question.
- **ChatGPT's directory** lists one fixed MCP server URL per app; users can't supply their own.

Separately, a family can only reach their Kinboard from outside the home if they have done step 1. A phone at the supermarket can't open the shopping list otherwise.

A relay that each Kinboard dials out to solves both: no domain, no open ports, an address under a domain we own (so Claude's URL pattern is narrow and ours), and remote access for the family's own devices.

## 2. Proposal

Three paths, all optional, chosen per household:

| Path | What the family does | Who can read the traffic | Depends on kinboard.app being up |
|---|---|---|---|
| **A. Direct** (as today) | Exposes Kinboard themselves | Only the family's Kinboard | No |
| **B. Relay** | Switches on remote access in Settings, with the PIN | Only the family's Kinboard: TLS ends at home, the relay forwards encrypted bytes | Yes |
| **C. ChatGPT directory** | Adds Kinboard from ChatGPT's app directory and enters a link code | The relay can read the assistant's requests (unavoidable with one shared URL); OpenAI reads them anyway | Yes |

Path A stays exactly as it is. B is the default recommendation for families who can't do A. C is a separate opt-in on top of B.

The relay runs on the server that already hosts kinboard.app and the demo. No load balancing and no second server until there is demand and money for it (§9).

## 3. How the relay works

```
 phone / Claude ──TLS──► relay (kinboard.app server)          family's home
                          │  reads only the SNI hostname         ┌───────────────────┐
                          │  k7f3q9.home.kinboard.app            │ kinboard-tunnel   │
                          └──── encrypted bytes, unchanged ─────►│  TLS ends here    │──► Kong :8000
                                over the tunnel Kinboard opened  │  (its own cert)   │
                                (outbound wss, kept alive)       └───────────────────┘
```

- **The tunnel is outbound.** A small `kinboard-tunnel` service in the family's stack dials `wss://relay.kinboard.app` and keeps one connection open, multiplexing the streams the relay hands it. It needs no inbound port, no port forwarding and no domain at home.
- **The relay routes by SNI and never terminates TLS** for family addresses. On the kinboard.app server, Traefik gets a TCP router `HostSNI(*.home.kinboard.app)` with `passthrough: true` to the relay. Everything else on that server (kinboard.app, the demo) is unchanged.
- **TLS ends inside the family's stack**, in `kinboard-tunnel`, with a certificate whose private key was created there and never leaves (§4). It forwards plain HTTP to Kong, the front door since RFC-018, so the app, its API and `/api/mcp` all work as they do at home.
- **Identity.** On enrolment the instance creates an Ed25519 key pair. The tunnel authenticates to the relay by signing a fresh challenge. The relay stores only the public key and the label it assigned.
- **The relay's own code is published** alongside Kinboard's, so its claims can be checked.

### 3.1 The tunnel: frp, narrowly configured (decided 2026-10-07)

| Option | Verdict |
|---|---|
| **[frp](https://github.com/fatedier/frp)** (Go, Apache-2.0, ~110k stars, active) | **Chosen.** Its `https` proxy type routes by SNI without terminating TLS, so the relay stays blind. A server plugin calls our API on login and on proxy creation, so the relay checks the Ed25519 challenge and that the label belongs to that instance. The control channel runs over TLS with multiplexing. On the family's side, the `https2http` client plugin terminates TLS inside `kinboard-tunnel` with the family's own certificate and forwards plain HTTP to Kong |
| [SniTun](https://github.com/NabuCasa/snitun) (Nabu Casa, the Home Assistant cloud tunnel) | Architecturally the closest fit and proven at scale, but GPL-3.0, so we'd ship GPL software into every Kinboard stack. Small community, and its session master is Nabu Casa's own cloud, which we'd have to rebuild |
| rathole, chisel | Route by port, not by hostname: one port per household. Doesn't scale |
| Own framing over WebSocket | Rejected. Tunnel framing is where security bugs live |

Configuration rules:

- **frps:** only the `https` proxy type, with `subDomainHost = home.kinboard.app`. The plugin refuses every other type and any label that isn't the caller's. `transport.tls.force = true`.
- **Traefik on the kinboard.app server:** a TCP router `HostSNI(*.home.kinboard.app)` with passthrough to frps. Everything else on that server is unchanged.
- **frpc:** runs in its own `kinboard-tunnel` container, which holds the TLS key, away from the webapp. It's pinned to a release, and updates are reviewed like any dependency.

## 4. Addresses and certificates

Family addresses live in **one dedicated subzone of kinboard.app**: `<label>.home.kinboard.app`, where the label is a random, non-guessable id (for example 10 base32 characters), never the family's name.

1. **A delegated subzone.** `home.kinboard.app` gets NS records pointing to its own DNS zone at a provider with an API (Hetzner DNS is free). The relay holds credentials for that subzone only; it can never touch records or certificates for kinboard.app itself. Cloudflare's free plan allows this NS delegation.
2. **Public Suffix List.** We submit `home.kinboard.app` to the PSL's private section. Browsers then treat each family address as its own site: no shared cookies, no same-site relaxation between families or with kinboard.app. Let's Encrypt also counts each address as its own registered domain, so its 50-new-certificates-per-week limit stops being a shared ceiling. PSL review takes weeks, so we submit early (§11).
3. **DNS only, not proxied.** These records stay grey-clouded in Cloudflare. Its proxy would end TLS itself, and the relay would no longer be blind.
4. **CAA** on `home.kinboard.app` allows only Let's Encrypt.
5. **Issuing a certificate.** `kinboard-tunnel` creates the key locally and runs ACME DNS-01. For the challenge it asks the relay, over its authenticated tunnel, to set the `_acme-challenge` TXT record **for its own label only**. The relay refuses any other name. Renewal works the same way. The private key never leaves the family's server, so the relay cannot present a valid certificate for the family's address.
6. **Monitoring.** Certificate Transparency logs show every certificate issued for `*.home.kinboard.app`. A certificate the instance didn't request is visible to anyone, including the family.

## 5. Remote access must not weaken Kinboard

Kinboard's security model assumes a trusted home network and a 6-character join code (Security-and-Threat-Model). An address on the internet changes that, so requests that arrive **through the tunnel** follow stricter rules:

- **No joining through the relay.** `/join` and family creation are refused over the tunnel. A new device is paired at home, or approved on a screen at home with the settings PIN. A stranger who finds `k7f3q9.home.kinboard.app` gets a locked door, not a code form to brute-force.
- **The tunnel's origin is unforgeable.** `kinboard-tunnel` strips any incoming `X-Kinboard-Via` header and sets its own; Kong accepts that header only from the tunnel service's address inside the stack (the same trust rule as `KONG_TRUSTED_IPS`, RFC-018).
- **Off by default.** Remote access is switched on in Settings with the PIN. One tap switches it off and drops the tunnel at once, and existing device sessions can be revoked as today.
- **Limits at the edge.** The relay can't read content, but it limits new connections per address and per source IP, and drops floods before they reach anyone's home connection.
- **No content logs.** The relay records connection metadata only: label, time, bytes, source IP for rate limiting. It keeps them for 7 days.

## 6. Assistants through the relay

- **Claude (path B).** The connector URL is `https://<label>.home.kinboard.app/api/mcp`, end to end. A directory listing uses the URL pattern `^https://[a-z2-7]{10}\.home\.kinboard\.app/api/mcp$`: narrow, on a domain we own, and with every auth mode Claude supports for URL patterns already in place (DCR, CIMD, S256 PKCE). ChatGPT can use the same address as a custom connector (developer mode, as today), also end to end.
- **ChatGPT directory (path C).** OpenAI allows one fixed URL per app, so the listing points at `https://mcp.kinboard.app/mcp`. The relay terminates TLS there and runs the OAuth front: the user signs in through ChatGPT, enters a link code shown in their Kinboard's Settings, and approves the scopes with the PIN on their own Kinboard. The relay maps the issued token to that instance and forwards each MCP request over the tunnel.
  - **The relay reads these requests.** It keeps them in memory only for the request, never logs bodies, and the family sees this stated plainly before opting in.
  - **Scopes are still enforced by the family's Kinboard.** The relay only routes, and a relay bug can't widen what a token may do.

## 7. Who can see what

| Party | Path A | Path B (remote access, Claude, ChatGPT custom connector) | Path C (ChatGPT directory) |
|---|---|---|---|
| Family's Kinboard | Everything | Everything | Everything |
| Relay operator | Nothing | Label, time, bytes, source IP; **no content** | The same, plus the assistant's requests and Kinboard's answers to them, in transit |
| Assistant provider | What the assistant reads | What the assistant reads | What the assistant reads |
| DNS provider for the subzone | — | The label exists | The label exists |

## 8. Threat model

| Threat | Mitigation |
|---|---|
| Relay operator or a compromised relay reads family traffic | Paths A and B: impossible without the family's private key; TLS ends at home. Path C: in scope by design, disclosed, opt-in |
| Relay issues a certificate for a family address to impersonate it | Needs a DNS-01 TXT the relay could set. Detectable in Certificate Transparency; we publish a CT monitor that alerts on certificates the instance didn't request. Residual risk, stated in the docs |
| Relay credentials used against kinboard.app | Impossible: the relay holds credentials for the `home.kinboard.app` subzone only |
| One family's address attacks another's or kinboard.app's cookies | Public Suffix List entry: each address is its own site |
| Stranger finds an address and guesses the join code | Joining is refused over the tunnel (§5) |
| Stolen device session used remotely | The same revocation as today; remote access can be switched off in one tap |
| Forged "came from tunnel" header from the LAN | The header is set only by `kinboard-tunnel` and accepted only from its in-stack address |
| A tunnel impersonates another instance | Ed25519 challenge per connection, bound to the label |
| Flood against one family through the relay | Per-label and per-IP connection limits at the relay |
| Relay outage | Paths B and C stop; path A is unaffected. Settings and docs say so |
| Path C token theft | Tokens are scoped, expire, and are revoked from the family's Settings; the relay checks them before forwarding |

## 9. Load and cost

On the kinboard.app server today: 3.8 GB RAM with about 2 GB free, 2 cores at load 0.6, 10 GB disk free. Estimates per connected household:

| Households | Relay RAM | Requests | Traffic |
|---|---|---|---|
| 100 | ~85 MB | under 0.1/s | under 0.5 GB/month |
| 1,000 | ~130 MB | ~0.5/s, peaks 5–10/s | 1–2 GB/month |
| 10,000 | ~600 MB | ~5/s, peaks ~50/s | ~15 GB/month |

Assistant traffic is small JSON. Remote use of the app adds page and photo traffic and is the larger share; at 1,000 households it's still well within one server's bandwidth.

- **Costs at the start:** none beyond what exists. The Hetzner DNS zone is free, and the subzone sits under the existing domain.
- **Load balancing or a second server** is deferred until demand and money justify it.
- **Single point of failure:** an update of the kinboard.app server interrupts paths B and C for a minute. That's acceptable for a free service, and stated.

### 9.1 Data protection (GDPR)

This is a reading, not legal advice. Path C waits for a legal check (see the last point).

- **Path A:** no data reaches the project.
- **Path B (blind relay):** the relay processes connection metadata (source IP, label, timestamps, byte counts). That is personal data, with the operator as controller and legitimate interest as the basis: running and securing the service, Art. 6(1)(f). Content is encrypted end to end, and the relay holds no key. Duties:
  - extend kinboard.app's privacy policy with what is logged, why, and for how long (7 days);
  - sign Hetzner's data processing agreement (AVV) for the server and the DNS zone. Both are in the EU, so there is no third-country transfer;
  - security appropriate to the risk (Art. 32).

  The families' own use of Kinboard falls under the household exemption; the relay itself does not.
- **Path C (ChatGPT directory front):** the relay reads family content, including children's data, and passes it to OpenAI in the US at the family's request. Before launch:
  - a full privacy notice;
  - a short data protection impact assessment (children's data plus new technology);
  - the third-country transfer settled;
  - a review by a data-protection lawyer.

  Path C does not ship without them.

## 10. Directories

- **Claude:** submit with the URL pattern from §6 once path B exists. Requirements: titles and hints on every tool (in progress), documentation, a connector privacy policy, a support contact, an icon, and a fully populated review instance reachable from Anthropic's egress range. Ask `mcp-review@anthropic.com` beforehand about the pattern and about pocket money (a ledger entry, no money moves).
- **ChatGPT:** submit once path C exists, under OpenAI's individual or business verification. Their guidelines forbid money transfers and targeting under-13s. Kinboard's users are parents, and `book_pocket_money` only records ledger entries; the listing says both plainly.

## 11. Rollout

1. **Now:** submit `home.kinboard.app` to the Public Suffix List and set up the delegated subzone with CAA. Both take time and cost nothing.
2. **Relay plus `kinboard-tunnel`, path B, as a beta:** remote access off by default; the stricter tunnel rules (§5) ship in the same release.
3. **Claude directory listing** on the §6 pattern.
4. **Path C** (ChatGPT directory), after B has run for a while.

## 12. Open questions

- **Label recovery:** if an instance loses its key (a restore onto new hardware), how does it reclaim its label without letting anyone else claim it? One option is a recovery code shown once at enrolment.
- **Uptime promise:** none, or "best effort"? Settings and docs should say.
- **Abuse contact** for the relay and its addresses.
