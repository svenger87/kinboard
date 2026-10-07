# RFC-018 — The API at the address the app was opened from

| | |
|---|---|
| **Status** | Accepted 2026-10-06 (§8); implemented in #376, shipped in v1.13.0-rc.17 |
| **Prompted by** | Discussion #349 (a household running Kinboard behind a Cloudflare Tunnel) |

## 1. Why

A browser talks to two parts of Kinboard: the webapp, and the API gateway
(Kong) that every piece of data comes from. The browser finds the gateway
through **one fixed address**, `API_EXTERNAL_URL`. It is set by `setup.sh` and
reaches the browser as `NEXT_PUBLIC_SUPABASE_URL` (`window.__ENV`). Kong's CORS
then accepts exactly one origin, `SITE_URL`.

That single address has to fit every device. As soon as Kinboard is reachable
from outside, through Traefik or a Cloudflare Tunnel, it has to be the public
address. Then:

- **A device on the home network goes out and back in.** A tablet next to the
  server loads every task, event and photo via Cloudflare or the public IP.
  It's slower than it needs to be, and **it stops working when the internet is
  down**, although everything it needs is in the same room. This is what the
  household in #349 noticed: "I have to go from my local device out through
  Cloudflare back into my local network, because the API address has to be the
  domain."
- **A screen opened by its local address gets CORS errors**, because Kong only
  accepts the public origin. The Cloudflare guide (step 6) has to tell
  households to either always use the domain or hand-edit `kong.yml`.
- **Setup is the most common failure.** The wiki's longest section ("What URL
  should I use?") exists because the address is easy to get wrong: a page that
  loads but stays empty, `ERR_CONNECTION_REFUSED`, CORS. A wrong address also
  took production down once (2026-08-06).
- **The address is baked into stored data.** Uploaded images (recipes,
  catalogue items, vehicles, savings goals, birthdays) are saved with a full URL
  built from `NEXT_PUBLIC_SUPABASE_URL` (`lib/supabase/public-url.ts`). Change
  the address, or open Kinboard from another one, and those images break.

## 2. Proposal

**The browser always talks to the API at the address it opened Kinboard
from.** `/rest/v1`, `/auth/v1`, `/storage/v1` and `/realtime/v1` are served
on the same origin as the app. At home that's `http://192.168.1.10:3001`, away
from home `https://kinboard.example.com`, and each device simply uses its own.

- The browser client uses `window.location.origin` as its API base.
  `API_EXTERNAL_URL` becomes optional, for setups that really need a separate
  API host.
- Same origin means no CORS. Kong's CORS allow-list stays for the optional
  separate-host setup.
- One address to give out, one route in a reverse proxy or tunnel, and no
  `setup.sh` question about "where will the API be".

## 3. How the same origin is served

The requests have to reach Kong, including the realtime WebSocket. Three ways:

| | Option | For | Against |
|---|---|---|---|
| **A** | **Kong is the front door.** A catch-all Kong route sends everything that isn't `/rest`, `/auth`, `/storage` or `/realtime` to the webapp. Households open Kong's port, and the webapp's port stays as it is for now. | No new container or dependency. Kong already proxies WebSockets, and its path routing is what the Traefik overlay and the tunnel guide already do by hand. | `kong.yml` changes. On existing installs that file holds real secrets and is rewritten by `setup.sh`, so the new route must be added safely to files that already exist. Next.js's own dev features (HMR socket) must pass through Kong in development. |
| **B** | **The webapp proxies.** Next.js rewrites `/rest`, `/auth` and `/storage` to `http://kong:8000`, and a small custom server in the image upgrades `/realtime` WebSockets to Kong. | Households keep opening the app's port, so nothing changes for them. | Next.js rewrites don't proxy WebSockets, so a custom server wraps the standalone build. Every API request takes one more hop through Node. |
| **C** | **A small proxy container** (Caddy) in front of both, as the default stack's entry point. | Clean separation; WebSockets and HTTP/2 handled well. | A new container in every install, compose changes, and one more thing to update. |

**Recommendation: A.** It uses what the stack already has, and the Traefik
overlay plus the Cloudflare guide already prove the routing. The open work is
updating `kong.yml` on existing installs without touching their secrets.

## 4. Stored image URLs

New uploads store a **relative** path (`/storage/v1/object/public/<bucket>/<path>`),
which resolves against whatever address the page was opened from. A migration
rewrites existing rows whose `image_url` starts with the configured
`API_EXTERNAL_URL` (or a known internal host) to the relative form. Rows
pointing elsewhere (an image a person pasted from the web) are left alone. The
affected columns: `recipes.image_url`, `catalogue_items.image_url`,
`vehicles.image_url`, `birthdays.image_url` and `pocket_money_goals.image_url`.

## 5. Migration for existing installs

- **No change unless the household opts in.** An install keeps working with
  its `API_EXTERNAL_URL` exactly as today. Same-origin mode turns on when
  `API_EXTERNAL_URL` is empty or set to `same-origin`. `setup.sh` offers it on
  new installs and on a re-run.
- **The Traefik overlay and the Cloudflare guide shrink to one route** (the
  host to Kong) once same-origin is on. The two-route versions stay documented
  for installs that keep a separate API host.
- **The Kong route (option A)** is added by `setup.sh` and the self-update in a
  way that leaves every existing line, and every secret, as it is. A spec checks
  the merge on a copy of a real `kong.yml`.

## 6. Testing

- A device opened at a LAN address and one opened at a public address, against
  one stack, both load data and realtime without CORS errors (two Playwright
  contexts with different base URLs).
- Realtime works through the same origin, in Chromium **and WebKit**.
- Uploaded images resolve from both addresses. The image-URL migration
  rewrites only the configured host's URLs and is idempotent.
- `kong.yml` merging: an existing file with real-looking secrets keeps every
  byte except the added route.
- Separate-host mode (today's behaviour) keeps passing the existing suite.

## 7. Decisions (2026-10-06)

1. **Option A**: Kong is the front door.
2. **Same-origin is the default for new installs** straight away.
3. **Kong takes port 3001**, the address households already know, and the
   webapp is only reachable inside the stack.

## 8. Rolling it out without breaking existing installs

The port swap is the dangerous part. If an existing install's Kong moved onto
3001 while its `kong.yml` lacked the catch-all route, every bookmark would land
on a Kong 404, which is a full outage. So:

- **The switch is a single setting**, `KINBOARD_ENTRY=kong` (new installs)
  versus `webapp` (today's layout, the default for existing installs). It
  decides which container publishes `WEBAPP_PORT` (3001) and whether the
  browser uses `window.location.origin` or `API_EXTERNAL_URL`.
- **`setup.sh` and the self-update add the catch-all route to `kong.yml` first**,
  leaving every other line and every secret untouched. They switch an existing
  install to `kong` only after a check confirms the route is present: a
  request through Kong to `/` returns the app.
- **If the check fails, the install stays on `webapp`** and logs why. Nothing
  changes for it.
- **Kong keeps its own port (8100) as well**, so an existing
  `API_EXTERNAL_URL` keeps working during and after the switch.
- **Installs behind Traefik** (the overlay routes to the containers inside the
  stack) are unaffected by host ports. They get the simpler one-route overlay
  as an option.
- **In development** (`next dev` outside Docker), the browser keeps using
  `NEXT_PUBLIC_SUPABASE_URL`; same-origin is a property of the containerised
  stack.
