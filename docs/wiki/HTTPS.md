# HTTPS

Kinboard doesn't come with HTTPS built in. A household that wants it picks one
of the ways below; on your own network, plain `http://` works for almost
everything.

## What needs HTTPS

Browsers keep a few features for pages opened at an `https://` address (or at
`http://localhost` on the same computer, which a phone or tablet can't use).
On a plain `http://192.168.1.50:3001` address:

- **Push notifications** don't work. The browser won't sign up for them.
  ([Notifications](Notifications#requirements-read-this-first))
- **The barcode scanner's live camera** stays off. Taking a photo of the
  barcode and typing the numbers still work, and the scanner says so.
- **Installing the app** ("Add to Home Screen", "Install app") gives you a
  plain shortcut, not an app of its own.
- **Some copy buttons** (the family code, the calendar feed address, the
  assistant address) can't copy. Select the text and copy it by hand.
- **AI assistants** in the cloud (ChatGPT, Claude on the web, desktop and
  phone) need more than HTTPS: an address **on the public internet**. See
  [AI assistants and Tailscale](#ai-assistants-and-tailscale) below and
  [Connecting an assistant](AI-Assistants-Connecting).

**Everything else works over plain HTTP on your network**: every screen, live
updates between them, the calendar, lists, photos, cameras, Home Assistant and
every other integration. If none of the list above matters to you, you don't
need to do anything.

## The ways, shortest first

| Way | Reachable from | Needs | Tested by us |
|---|---|---|---|
| [Unraid 7: "Use Tailscale"](#unraid-7-use-tailscale) | your devices that run Tailscale | a Tailscale account | to be tested on Unraid 7 before release |
| [Tailscale on other hosts](#tailscale-on-other-hosts) | your devices that run Tailscale | a Tailscale account | not tested by us |
| [SWAG or Nginx Proxy Manager on Unraid](#swag-or-nginx-proxy-manager-on-unraid) | anywhere, or your network only | a domain | not tested by us |
| [Synology DSM's reverse proxy](#synology-dsms-reverse-proxy) | anywhere, or your network only | a domain | not tested by us |
| [Cloudflare Tunnel](#cloudflare-tunnel) | anywhere | a domain on Cloudflare | not tested by us |
| [Caddy](#caddy) | anywhere, or your network only | a domain | not tested by us |
| [Traefik (git installs)](#traefik-git-installs) | anywhere | a domain | Kinboard's own overlay; not re-tested for this page |

"Anywhere" means the whole internet can reach the address. Read
[Security and threat model](Security-and-Threat-Model) first: the family code
is the only lock, so put a login in front (Authelia, Authentik, Cloudflare
Access).

## Whichever way you choose

Four things are the same for every way. Each recipe below says how they apply
to it.

1. **`SITE_URL`.** The address Kinboard puts into links other apps get (the
   calendar feed you subscribe to on a phone). Set it to the new `https://`
   address if the apps that use those links can reach it. The browser itself
   doesn't need it: Kinboard always answers at the address a page was opened
   at.
2. **The proxy must say it was HTTPS.** A proxy that turns HTTPS into plain
   HTTP for Kinboard has to send `X-Forwarded-Proto: https` with each request,
   or connecting an AI assistant fails. Most do it on their own; the recipes
   say which. Why, and the safety net `SITE_URL` gives:
   [The address Kinboard advertises](AI-Assistants-Self-Hosting#the-address-kinboard-advertises).
3. **Live updates.** Screens stay in sync over one long-running request,
   `GET /api/realtime` (Server-Sent Events, not a WebSocket). The proxy must
   pass it through as it arrives instead of collecting it. Kinboard sends
   `X-Accel-Buffering: no`, which nginx-based proxies (SWAG, Nginx Proxy
   Manager, Synology) honour, and a heartbeat every 25 seconds, so the usual
   60-second timeouts don't cut it. If a screen only updates after a reload,
   this is the place to look.
4. **Screens move to the new address one by one, and join again.** A
   sign-in belongs to the address it was made at, because the browser keeps
   it per host name. A screen that opens the `https://` address for the first
   time starts at the join screen: join with the family's code (the same as
   before). It then shows up as a new device under **Settings → Devices**;
   give it its name again and remove the old entry. The old `http://` address
   keeps working until you stop using it, so wall tablets can move whenever
   suits you, or stay on `http://` if they don't need anything from the list
   above. (The same rule as after [a move to the all-in-one image](All-in-one#moving-between-the-compose-file-and-the-all-in-one-image).)

## Unraid 7: "Use Tailscale"

Unraid 7 can put any container on your
[Tailscale](https://tailscale.com) network (your *tailnet*) with one switch,
and Tailscale Serve gives it an `https://kinboard.<your-tailnet>.ts.net`
address with a real certificate. Kinboard's Unraid template has the fields
filled in; the switch is off until you turn it on.

**What you get:** an HTTPS address that works from every phone, tablet and
computer that runs the Tailscale app signed in to your tailnet, at home and
away. Devices without Tailscale can't open it; they keep using the `http://`
LAN address, which keeps working.

**Status:** to be tested on Unraid 7 before release. What we checked so far:
Unraid's own Tailscale script runs in the Kinboard image, installs Tailscale
and reaches the sign-in step without extra settings.

### Before you start

1. A Tailscale account (the free plan is enough).
2. In the Tailscale admin console, under **DNS**: switch on **MagicDNS**, and
   under *HTTPS Certificates* click **Enable HTTPS**. Without both, Serve
   doesn't start, and the container log says so.
3. Kinboard's container on the network type **Bridge** (the template's
   default). Unraid offers "Use Tailscale" only for Bridge and custom
   networks.

### Switch it on

1. **Docker** → click Kinboard → **Edit**.
2. Switch **Use Tailscale** on. Check the fields that appear:

   | Field | Value |
   |---|---|
   | Tailscale Hostname | `kinboard` (becomes `kinboard.<your-tailnet>.ts.net`) |
   | Be a Tailscale Exit Node | No |
   | Tailscale Userspace Networking | Enabled |
   | Enable Tailscale SSH | No |
   | Tailscale Serve | **Serve** (not Funnel, see below) |
   | Tailscale Serve Port | `3000`, the port *inside* the container, not the 3001 you open on the LAN |

   Under **Tailscale Show Advanced Settings**:

   | Field | Value |
   |---|---|
   | Tailscale Serve Target | `http://127.0.0.1` |
   | Tailscale Serve Protocol | `https` |
   | Tailscale State Directory | `/data/tailscale` |

   Leave the others empty. If your container was added before the template
   had these presets, or was saved with Tailscale off, the fields may be
   empty: fill them in as above. The state directory matters most: under
   `/data` the Tailscale sign-in is kept with your data and survives updates.
3. **Apply.**
4. Open the container's **log**. It installs Tailscale, then shows
   `To authenticate, visit: https://login.tailscale.com/a/…`. Open that link
   and add the machine to your tailnet. **Kinboard itself doesn't start until
   you have**: the script waits for the sign-in first, and the container shows
   as starting until then.
5. The log then says `Enabling Serve!` and `Generating Tailscale certs!`, and
   Kinboard starts. The Docker page's menu for the container now offers the
   `https://` address.
6. In the Tailscale admin console, under **Machines**, open `kinboard` and
   choose **Disable key expiry**. Otherwise the machine drops off your tailnet
   after 180 days until you sign it in again (Unraid's edit page warns before
   that).

### Then, for this way

- **`SITE_URL`**: set it to `https://kinboard.<your-tailnet>.ts.net` only if
  every phone that subscribes to the calendar feed runs Tailscale. Otherwise
  leave it empty or on the LAN address.
- **`X-Forwarded-Proto`**: Tailscale Serve sends it (with `X-Forwarded-Host`
  and `X-Forwarded-For`). Nothing to do.
- **Live updates**: Serve passes the stream through. Nothing to do.
- **Screens**: each device needs the Tailscale app, signed in to your
  tailnet, before it can open the address. Then join it again as described
  [above](#whichever-way-you-choose).

### Good to know

- **Every update installs Tailscale again.** Unraid recreates the container
  on each update, and its script downloads Tailscale anew (about 40 MB) before
  Kinboard starts. The container needs internet access at that moment. The
  sign-in is kept in `/data/tailscale`.
- **`/data/tailscale` holds this machine's Tailscale key.** It is part of your
  data folder and its backups; keep them private, as you already do. To sign
  the machine in afresh, stop the container, delete that folder and start it.
- **Switching it off** (Use Tailscale off, Apply) leaves Kinboard on its
  `http://` address only. Remove the machine in the Tailscale admin console.

### AI assistants and Tailscale

**An address from Tailscale Serve is reachable only inside your tailnet.**
ChatGPT, Claude on the web and the Claude desktop and phone apps' custom
connectors call Kinboard from their makers' servers on the internet, so they
**can't reach it**. For them, a Serve address counts as LAN-only. Claude Code
and other MCP clients running on a computer in your tailnet *can* use it:
`https://kinboard.<your-tailnet>.ts.net/api/mcp`. See
[Connecting an assistant](AI-Assistants-Connecting).

**Tailscale Funnel** makes the same address public, so the cloud assistants
could reach it. It is a deliberate choice, not a setting to flip in passing:

- **Funnel puts all of Kinboard on the internet**, not only `/api/mcp`.
  Connecting an assistant also needs the `/.well-known/` addresses, the
  sign-in routes, and the approval page that opens in your browser; Funnel
  can't publish only those, and it can't put a login in front. Anyone who
  finds the address reaches the join screen, and the family code is the only
  lock ([Security and threat model](Security-and-Threat-Model)).
- Funnel only offers ports **443, 8443 and 10000**, and your tailnet's access
  policy must allow Funnel for this machine (the `funnel` node attribute).
- To use it anyway: set **Tailscale Serve** to **Funnel** in the same
  template, keep the protocol `https` and the port `3000`. What the assistants
  need beyond that: [Self-hosting notes](AI-Assistants-Self-Hosting).
- **Not tested by us.** The template's default stays Serve, and off.

## Tailscale on other hosts

On any Linux host (a git install, the one-file install, `docker run` of the
all-in-one image) with Tailscale installed and signed in, and MagicDNS and
HTTPS enabled as [above](#before-you-start):

```bash
sudo tailscale serve --bg http://127.0.0.1:3001
tailscale serve status    # shows https://<this-machine>.<your-tailnet>.ts.net
```

`3001` is the port Kinboard is published on, on the host. The address uses
the host's own Tailscale name. `sudo tailscale serve reset` switches it off.
Serve sends `X-Forwarded-Proto` and passes live updates through; `SITE_URL`
and moving screens as [above](#whichever-way-you-choose); the
[assistants note](#ai-assistants-and-tailscale) applies the same way.
**Not tested by us.**

## SWAG or Nginx Proxy Manager on Unraid

Both give a certificate from Let's Encrypt for a domain of your own. A domain
reachable from the internet means the whole internet can reach Kinboard
([read this first](#the-ways-shortest-first)); with DNS validation (SWAG's
`VALIDATION=dns`, Nginx Proxy Manager's *Use a DNS Challenge*) you can get the
certificate for a name that only resolves on your network instead.

**SWAG**: create `/mnt/user/appdata/swag/nginx/proxy-confs/kinboard.subdomain.conf`:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name kinboard.*;
    include /config/nginx/ssl.conf;
    client_max_body_size 0;

    location / {
        include /config/nginx/proxy.conf;
        include /config/nginx/resolver.conf;
        set $upstream_app 192.168.1.50;   # your Unraid server
        set $upstream_port 3001;          # Kinboard's port on the server
        set $upstream_proto http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }
}
```

then restart SWAG. SWAG's `proxy.conf` sends `X-Forwarded-Proto`.

**Nginx Proxy Manager**: *Hosts → Proxy Hosts → Add Proxy Host*: your domain,
scheme `http`, forward hostname your Unraid server's address, port `3001`.
On the *SSL* tab request a Let's Encrypt certificate and switch on *Force
SSL*. It sends `X-Forwarded-Proto` on its own.

For both: live updates pass through (they honour Kinboard's
`X-Accel-Buffering: no`). `SITE_URL` and moving screens as
[above](#whichever-way-you-choose). **Not tested by us.**

## Synology DSM's reverse proxy

1. **Control Panel → Security → Certificate → Add → Get a certificate from
   Let's Encrypt** for your domain (DSM needs port 80 reachable for this, or
   use a `synology.me` name).
2. **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:
   - Source: protocol `HTTPS`, hostname `kinboard.example.com`, port `443`.
   - Destination: protocol `HTTP`, hostname `localhost`, port `3001`.
   - *Custom Header* tab: add `X-Forwarded-Proto` with the value `https`.
3. Back in **Certificate → Settings**, pick the Let's Encrypt certificate for
   the new reverse proxy entry.

DSM's proxy is nginx and honours `X-Accel-Buffering: no`, so live updates
pass through. `SITE_URL` and moving screens as
[above](#whichever-way-you-choose). **Not tested by us.**

## Cloudflare Tunnel

An HTTPS address on the internet without opening a port on your router. The
full walk-through for a git install is in
[Self-hosting](Self-hosting#reverse-proxied-via-cloudflare-tunnel). For the
all-in-one image or the one-file install, run `cloudflare/cloudflared` with
your tunnel token as its own container and point the tunnel's public
hostname at `http://<your server>:3001`.

Cloudflare sends `X-Forwarded-Proto` and passes live updates through.
Cloudflare Access can put a login in front; exempt the paths an AI assistant
calls if you connect one
([A login page in front of Kinboard](AI-Assistants-Self-Hosting#a-login-page-in-front-of-kinboard)).
`SITE_URL` and moving screens as [above](#whichever-way-you-choose).
**Not tested by us.**

## Caddy

Caddy gets and renews the certificate itself. A `Caddyfile`:

```caddy
kinboard.example.com {
    reverse_proxy 192.168.1.50:3001
}
```

Caddy sends `X-Forwarded-Proto` and passes live updates through on its own.
For a name only your network knows, `tls internal` makes Caddy its own
certificate authority, whose root you then have to trust on every device.
`SITE_URL` and moving screens as [above](#whichever-way-you-choose).
**Not tested by us.**

## Traefik (git installs)

A git install ships a Traefik overlay that sends everything for your domain
to Kinboard, with a Let's Encrypt certificate:
[Self-hosting → Behind Traefik](Self-hosting#behind-traefik), and
[From scratch: Traefik + Let's Encrypt](Self-hosting#from-scratch-traefik--lets-encrypt)
if you don't run Traefik yet. Traefik sends `X-Forwarded-Proto` and passes
live updates through. Set `SITE_URL` to the domain (the overlay's
instructions do), and move screens as [above](#whichever-way-you-choose).
