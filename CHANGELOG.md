# Changelog

All notable changes to Kinboard land here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `ChunkLoadError` after Watchtower auto-updates (or any in-place webapp redeploy) no longer leaves users on a broken page. New `<ChunkErrorRecovery>` listens at the window level for failed chunk loads and triggers a one-shot reload (gated by `sessionStorage` to avoid loops). On reload, the service-worker caches are cleared first so the fresh bootstrap doesn't bounce off the same stale chunks. **Plus** the service worker's `CACHE_NAME` now embeds the `package.json` version (substituted at Docker build time via `sed` against the `__KINBOARD_VERSION__` placeholder), so each release's `activate` event evicts the previous release's chunk cache automatically.

## [1.0.8] - 2026-05-07 — Demo overlay + auto-update opt-in + nav polish

### Fixed
- Camera streams now always proxy through the webapp's `/api/cameras` endpoint instead of letting the browser fetch the camera URL directly when no auth is configured. Camera URLs are typically on a private LAN (RTSP / MJPEG boxes at `192.168.x.x` or — on the demo overlay — internal Docker hostnames like `go2rtc:1984`); the browser couldn't reach those, producing "Stream konnte nicht geladen werden" / "Stream could not be loaded" with no further hint. As a side benefit, the browser console + DNS no longer leak the LAN address of each camera.

### Changed
- Bottom navigation now hides integration items the family hasn't set up yet. `Smart home`, `Energy`, and `Tesla` are gated on Home Assistant being connected; `Cameras` is gated on at least one camera configured. Direct URL access still works (each page renders its own "Connect this integration first" landing) — the filter only governs the bottom-nav surface, so fresh installs aren't cluttered with dead clickthroughs. Stepping stone toward the plugin-system roadmap item: each integration's "is this available?" predicate is now isolated, ready to formalize as a plugin manifest.

### Added
- Demo camera streams now show scene-themed animated SVG content (kitchen with steam wisps + warm lamp glow, garden with swaying leaves + a flying bird arc + sky gradient, front-door night view with motion-blip pulses + porch light flicker). Replaces the single static placeholder. Routed by `?src=` query param via nginx `map` directive in the mock-go2rtc config.
- New `docker-compose.demo.yml.example` overlay runs lightweight mock servers (Home Assistant, Tesla via HA, OpenWeatherMap, go2rtc cameras) alongside the real Kinboard stack so the demo box's smart-home / energy / Tesla / cameras / weather dashboards render with believable data without configuring real integrations or burning API keys. Same mocks the screenshot pipeline already uses (single source of truth at `docs/wiki/screenshots/mocks/`).
- `seed-demo.sql` now seeds Home Assistant + cameras settings rows pointing at the mock containers (one configured HA dashboard with light/climate cards, three demo camera streams), plus a third kid (Casey) with full school-week schedule, 5 more birthdays, and `period` numbers on every schedule slot so the schedule page renders pill-by-pill correctly.
- Synthetic news feed for public demo deployments. When `KINBOARD_DEMO_FAMILY_CODE` is set on the server, `/api/news` and `/api/news/article` short-circuit with 10 fictional human-interest articles (food, lifestyle, tech, family) instead of fetching real RSS feeds. Eliminates copyright exposure from re-displaying publisher content to anonymous demo visitors. Self-hosters running their own household never hit this branch — real RSS still works as before.

## [1.0.7] - 2026-05-07 — Live demo + auto-update opt-in

### Added
- README hero **"Try the live demo at demo.kinboard.app"** link with the demo family's join code so visitors can see Kinboard before they install. Status & roadmap section also notes the demo box.
- Comprehensive **`seed-demo.sql`** populating Demo Family with: calendars + events for the next 2 weeks, birthdays in the next 30 days, a stocked shopping list across 6 categories, 5 recipes with ingredients, a current-week meal plan, a mix of todos with priorities/assignments/completion states, pinned + unpinned notes, and school-week schedules for two kids. Idempotent — wipes the demo family before re-insert, so it can run nightly to keep dates current.
- Optional **demo-mode banner**: when `KINBOARD_DEMO_FAMILY_CODE` is set on the server, the `/join` page surfaces a banner showing the demo family's join code with a one-click "Use this code" button to pre-fill it. Self-hosters running their own household leave the env var unset and the banner never renders. Powers `https://demo.kinboard.app`. EN + DE strings added.
- Optional `docker-compose.watchtower.yml.example` overlay for self-hosters who'd rather not type `docker compose pull && ./start.sh up` after every release. Label-enabled so **only kinboard-webapp** gets auto-updated — database/kong/auth/realtime stay on whatever versions docker-compose.yml pins (auto-bumping Postgres is not safe). Pairs with a tag strategy in `webapp/docker/.env`: `KINBOARD_TAG=latest` (every release), `1.0` (minor + patch only — recommended default), or `1.0.6` pinned (no auto-bumps). Polls GHCR every hour by default; tunable via `WATCHTOWER_POLL_INTERVAL`. Documented in the new `Self-hosting > Auto-updating with Watchtower` wiki section, including the trust-boundary trade-off (Watchtower needs `/var/run/docker.sock`).

## [1.0.6] - 2026-05-07 — Traefik + push-notification papercuts

### Added
- New `Self-hosting > From scratch: Traefik + Let's Encrypt` wiki section walks through standing up Traefik on a bare box with HTTP-01 ACME challenges. Covers the standalone compose, the `proxy` external network, UFW port handling, the `DOCKER_API_VERSION=1.45` workaround for Docker Engine 29 + Traefik <3.7, and a verification curl chain. Closes the gap that the previous "Behind Traefik" section assumed a Traefik instance was already running. Surfaced while bringing up `https://demo.kinboard.app`.
- New "Requirements (read this first)" section near the top of the Notifications wiki page lists the four hard preconditions for web push — HTTPS / secure context, supported browser, iOS PWA install, server-side VAPID keys — so self-hosters know up front why a plain-HTTP LAN deployment can't push.
- Self-hosting wiki "LAN-only on a NAS" deployment shape now calls out the trade-off: push notifications and PWA install don't work without HTTPS, with three concrete paths (Cloudflare Tunnel, Traefik + Let's Encrypt, self-signed CA) for self-hosters who want them on a closed network.

### Fixed
- Wiki "Related" footers and cross-page links rendered as literal `[[Page]]` text in the GitHub repo `.md` viewer (where the README's feature table sends visitors). The wiki engine renders `[[Page]]` syntax, but the regular Markdown viewer doesn't — so every Related section, Self-hosting → Notifications link, etc. was a dead end for anyone reading the docs from the repo instead of the wiki. Converted to standard `[Display](Page.md)` across 32 wiki page bodies; works in both contexts (GitHub Wiki strips `.md` when resolving, repo view follows the file). `_Sidebar.md` / `_Footer.md` keep wiki-only `[[X]]` syntax since they only render in the wiki.
- Push-notifications settings page no longer shows an inert Subscribe toggle on plain-HTTP LAN deployments or in iOS Safari without a PWA install. The capability check now requires `window.isSecureContext` (Service Worker + Push API are gated on it) and explicitly detects iOS-Safari-without-Add-to-Home-Screen — both surface dedicated hint copy with a link to the wiki walkthrough instead of letting the user toggle a switch that silently fails. EN + DE strings added (`unsupportedHttpsTitle`/`Description`, `unsupportediOSTitle`/`Description`).
- `setup.sh` SITE_URL derivation broke Traefik / reverse-proxy configs. The fallback `[[ "$site_url" == "$api_url" ]] && site_url="http://localhost:3001"` forced SITE_URL back to localhost whenever API_EXTERNAL_URL didn't end in `:8100` — including the common case where both URLs are the same `https://yourdomain.tld`. The wrong SITE_URL then pinned Kong's CORS allow-list to localhost, blocking every API call from the browser. New logic: swap `:8100`→`:3001` for legacy two-port deployments; reuse `api_url` unchanged for port-less or custom-port deployments (Traefik / Caddy / Cloudflare Tunnel front both behind the same hostname).
- `setup.sh` "Next steps" message now echoes the configured `SITE_URL` instead of the hardcoded `http://localhost:${WEBAPP_PORT:-3001}`. Self-hosters who set up at a LAN IP or real domain no longer get told to open `localhost` at the end of setup.
- `docker-compose.traefik.yml.example` `go2rtc` TCP router referenced a `webrtc` Traefik entrypoint that has to be defined separately in static config. Most self-hosters don't define it and got `EntryPoint doesn't exist` log spam every ~10 seconds. Block is now commented out with a note explaining when to enable it.

## [1.0.5] - 2026-05-07 — Self-hoster orientation pass

### Added
- Google Calendar settings page now shows an `<IntegrationConfigHint>` card (same pattern as Weather) when the self-hoster hasn't set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Backed by a tiny new `/api/google/configured` probe that returns `{ configured: bool }` based on env-var presence. The Connect button is disabled while unconfigured, replacing the silent 500 from `/api/google/auth` that used to confuse new self-hosters. EN + DE strings added.
- Photos settings page now shows an `<IntegrationConfigHint>` card on fresh installs where neither Immich nor Unsplash is connected, orienting the self-hoster on which provider to pick (self-hosted vs. curated stock) and linking to the Immich wiki walkthrough. EN + DE strings added.
- Home Assistant settings page now shows an `<IntegrationConfigHint>` card on the disconnected branch with a one-liner about generating a long-lived token in Profile → Security, plus a link to the wiki walkthrough. EN + DE strings added.

### Fixed
- Weather settings page's "Setup walkthrough" link pointed at the old `Integration-OpenWeatherMap` wiki URL — updated to the renamed `OpenWeatherMap` page.

## [1.0.4] - 2026-05-05 — Orphan-session + meal-plan race + CORS fixes

### Fixed
- AuthGuard now blocks protected-page rendering until the orphan-session check (`useValidateStoredFamily`) resolves. Previously, a stored `family_id` cookie pointing at a deleted family (DB wipe, restored backup, etc.) would let the dashboard mount and fire dozens of REST calls with the stale ID before the orphan-redirect landed — producing a wall of `409 Conflict` FK-violation errors in the browser console. The redirect-to-`/join` flow already existed; this fix gates child rendering so the cascade can't start in the first place.
- Meal-planner hooks no longer cascade into 409 conflicts when multiple components race to create the same week's `meal_plans` row. The previous SELECT-then-INSERT pattern raced across the dashboard widget, the `/meals` page, and adjacent-week prefetches; the first INSERT won, every other parallel hook got `409 Conflict` against the `(family_id, week_start)` unique constraint and surfaced as a wall of console errors. Replaced with `.upsert(..., { onConflict: "family_id,week_start" })` at all three call sites in `webapp/src/hooks/use-meal-planner.ts`.
- CORS preflight rejected the `X-Retry-Count` header that recent versions of `@supabase/postgrest-js` set on retried requests (status 503/520). The header wasn't in Kong's CORS allow-list, so any request that hit a transient 503 (PostgREST schema cache warm-up, storage briefly unhealthy, etc.) would cascade into a wall of `has been blocked by CORS policy: Request header field x-retry-count is not allowed` errors and the UI stopped working until reload. Added `X-Retry-Count` to all 5 CORS plugin blocks in `webapp/docker/kong.yml`. Self-hosters need to either pull `:1.0.4`+ or hot-patch + `docker restart kinboard-kong` (`kong reload` doesn't fully re-parse declarative config).


## [1.0.3] - 2026-05-05 — News reader, version check, brand refresh

### Added
- **In-app news reader.** Replaces the "Read article" → new tab flow on both `/news` and the screensaver with a server-side reader-mode pipeline. New `/api/news/article?url=…` endpoint fetches the article HTML, parses it through Mozilla Readability (the same library powering Firefox Reader View), sanitizes the result with DOMPurify against an allowlist of tags + attrs + URI schemes, and returns clean HTML the client renders in a Sheet. Server-side cache: 1 hour per URL. Host allowlist matches the news provider catalog so the endpoint can't be abused as an open proxy. Failure modes degrade gracefully — when extraction fails (paywall, unusual layout, or the publisher blocks our user-agent) the Sheet renders an "Open original" CTA. Articles styled via `@tailwindcss/typography` (new dep). Sheet is portal-rendered with bumped z-index when opened above the screensaver overlay so it actually appears on top. EN + DE translations added.
- **News expanded from one hardcoded RSS feed to a multi-source picker.** The RSS-fetcher used to hardcode Der Spiegel as the only news source; now the catalog at `webapp/src/lib/news-providers.ts` ships 10 sources out of the box (5 German: Der Spiegel, Tagesschau, Die Zeit, heise online, Süddeutsche; 5 English: BBC, The Guardian, NYT, Hacker News, Ars Technica) and self-hosters pick a subset on the new **`/settings/news`** page. The `/api/news` route now accepts `?sources=spiegel,tagesschau,bbc`, fetches in parallel with per-source 10-min cache, dedupes by canonical URL, and merges newest-first. Default falls back to Der Spiegel for fresh installs (matches v1.0.x behavior).
- **Dedicated `/news` page.** New top-level route in the main nav (Newspaper icon), independent of the screensaver/idle screen. Full-page article list with cover images, source pills, search, and per-source filtering. Reuses the `useNews()` hook; no extra API roundtrips. Empty-state CTA links straight to `/settings/news`.
- **Version check on the Settings page.** The footer now shows the live `Kinboard v{X.Y.Z}` from `package.json` (replacing the hardcoded `v1.0.0` translation key) and surfaces a small "update to vY.Z.W available" link when the GitHub releases API reports a newer tag. Backed by a new `/api/version-check` endpoint that polls `api.github.com/repos/svenger87/kinboard/releases/latest`, caches the response in-process for 6 hours, and tolerates the GitHub API being unreachable (falls back to "current only, no badge"). Per-client TanStack Query staleTime is 1h. EN + DE translations added.
- Reusable `<IntegrationConfigHint>` card component for integration settings pages — surfaces "needs configuration" state with the required env-var name, the `.env` path, and an optional docs link. First adopter is the Weather settings page; pattern carries over to the other integration pages as their TODOs land.

### Changed
- Brand assets refreshed from new source artwork in `assets/incoming/`: regenerated all main + shopping PWA icons, favicon, apple-touch-icon, and badge from the new house-with-widget-grid logo. Added a 1200×300 Kinboard banner (`assets/logos/kinboard-banner.png`) and wired it into the README hero. The `assets/logos/` directory holds the canonical icon + maskable variants at 192 and 512.

### Fixed
- **Stale-session orphan-cookie redirect.** Self-hosters who restored a backup, ran `docker compose down -v`, or otherwise wiped the database while a browser still held a `family_id` cookie were stuck on a UI that 404'd / 409'd everywhere with no recovery path (FK violations on the settings table look like 409s in the browser console). `AuthGuard` now validates the stored family against the live database via a new `useValidateStoredFamily()` query; if the row doesn't exist, the session is cleared, a one-shot toast surfaces ("Your previous session was reset on the server. Joining again — your data may need to be re-imported."), and the user lands on `/join`. Transient network errors don't trigger the redirect (the query returns `null` and retries on the 5-min schedule).
- Weather settings page now shows an `IntegrationConfigHint` card explaining what to do when `OPENWEATHERMAP_API_KEY` is unset (instead of silently rendering the form with no current-weather preview and no idea why). EN + DE strings added.

## [1.0.2] - 2026-05-05 — Image-overlay path actually works

### Fixed
- **Pre-built Docker image now works for any self-hoster's URL.** The `1.0.1` published image (`ghcr.io/svenger87/kinboard:1.0.1`) had `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` baked into the browser bundle as empty strings (CI built without these env vars set), causing every fresh self-hoster using the image-overlay path to see `@supabase/ssr: Your project's URL and API key are required to create a Supabase client!` in the browser console + a non-functional `/join` page. Source-build path was unaffected because `docker compose build` passed the user's URL via build-arg. Fix: `app/layout.tsx` now renders a server-side `<script>window.__ENV=…</script>` populated from `process.env` at request time. The browser-side supabase client (`lib/supabase/client.ts`) reads from `window.__ENV` first and falls back to `process.env.*` (the build-time bake). Both paths now work; the image-overlay path picks up `webapp/docker/.env` changes on container restart, no rebuild needed.
- Quick-start prerequisites now flag the **interactive-terminal requirement** for `setup.sh`. The URL prompt only fires when `stdin` is a TTY; piping over SSH or scripting silently defaults to `localhost:8100`, which leaves anyone not on the same box with a broken install. Doc now points at the `API_EXTERNAL_URL` / `SITE_URL` pre-set workaround for non-interactive runs.

### Changed
- Project email addresses moved to the new `@kinboard.app` domain (Cloudflare Email Routing). `security@kinboard.app` (was `security@svenger87.de`) and `conduct@kinboard.app` (was `conduct@svenger87.de`) — referenced from `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `SUPPORT.md`.
- `docs/wiki/Quick-start.md` section 2 now surfaces the **pre-built image overlay** as the primary recommendation (~30 sec bring-up + ~512 MB RAM, vs ~5–10 min source build + ~4 GB peak). Path B (source build) kept for users who patched the code or want a frozen build. Validated end-to-end on a fresh Hetzner box.

### Migration
- Self-hosters on `1.0.1` who used the **source-build path** (`./start.sh up`): no action needed; `start.sh restart` will pick up the new code on next pull.
- Self-hosters on `1.0.1` who used the **image-overlay path**: pull `:1.0.2` (or `:latest`) → `docker compose down && docker compose -f docker-compose.yml -f docker-compose.image.yml up -d`. The browser console error goes away.

## [1.0.1] - 2026-05-05 — Renamed to Kinboard

The project was renamed from **Familyboard** to **Kinboard** to avoid namespace overlap with two existing products in the same space (`familyboard.net` is a similarly-positioned family-organizer SaaS, and `familyboard.cz` is a Czech family message-board app). v1.0.1 ships zero functional changes — only branding, container names, image registry path, and badge URLs.

### Breaking
- **Image registry path changed** from `ghcr.io/svenger87/familyboard` to `ghcr.io/svenger87/kinboard`. The old `familyboard` images stay frozen at `1.0.0` for anyone already running them; new pulls and tags publish under the `kinboard` name.
- **Default Docker container name prefix changed** from `familyboard-*` to `kinboard-*`. Self-hosters already running v1.0.0 will need to either:
  - Set `PROJECT_NAME=familyboard` in their `webapp/docker/.env` to keep the old container names, or
  - Run `cd webapp/docker && docker compose down && docker compose -f docker-compose.yml -f docker-compose.image.yml up -d` to recreate under the new names. Volumes are mount-bind based on `${DATA_DIR}` (default `./data/`), so the database survives the container recreation.
- **Repo URL changed** from `github.com/svenger87/familyboard` to `github.com/svenger87/kinboard`. GitHub auto-redirects the old URL, but `git remote set-url` is recommended for clarity.

### Changed
- Brand: `Familyboard` → `Kinboard` everywhere user-visible (PWA name, push notification title, page titles, settings labels, README, wiki).
- npm package name: `familyboard` → `kinboard` in `webapp/package.json`.
- Domain placeholder in docs and `.env.example` now uses `kinboard.app` / `kinboard.example.com` instead of `familyboard.example.com`.
- All English + German user-facing strings updated (`webapp/messages/en.json`, `webapp/messages/de.json`).

### Migration notes for self-hosters
- **If you're on `:latest`**, a `docker compose pull && docker compose up -d` after pointing `image:` at `ghcr.io/svenger87/kinboard:latest` (the new `docker-compose.image.yml` already does this) is enough.
- **If you've pinned `:1.0.0`**, plan to bump to `:1.0.1` on the new image path. Your data is preserved either way.
- **First-time installers** see only Kinboard branding everywhere; this rename is invisible to them.

## [1.0.0] - 2026-05-04

Initial public release.

### Added
- Built-in real-time shopping list with offline support (PWA + IndexedDB
  queue), separately installable as its own home-screen icon
- Two-way Google Calendar sync: events created in Kinboard now push
  back to Google
- Recipe import from Chefkoch.de + any schema.org/Recipe URL
- Energy dashboard live flow + power/energy/battery charts pulling
  from Home Assistant via the existing HA integration
- Web push notifications for shopping items, task assignments, and
  the daily todo digest (PWA install required on iOS)
- LD2410 presence sensor support — display blanks when no one is in
  the room
- Multi-locale UI (English + German) via `next-intl`, with monthly
  themes that rotate colors through the year
- Reference hardware build: Mele Quieter 4C + 27" Novomatic
  open-frame touchscreen, with full BOM in the wiki
- Automated screenshot capture toolchain (`docs/wiki/screenshots/`):
  local docker stack with anonymized prod data + mock HA/Tesla/
  OpenWeatherMap/go2rtc + Playwright suite covering 13 routes × 2
  themes × 2 viewports = 50 screenshots
- GitHub Actions CI pipeline: lint + i18n parity + shellcheck on PRs
- Multi-arch (amd64 + arm64) Docker images published to
  `ghcr.io/svenger87/kinboard` on push to main and tagged releases
- Optional `docker-compose.image.yml` overlay so self-hosters can pull
  pre-built images instead of building locally

### Changed
- Schema migrations now ship as separate `migration_*.sql` files; the
  monolithic `init.sql` is reserved for fresh installs
- Row-level security disabled in the canonical schema; the device-cookie
  + family-join-code model is the actual auth boundary, RLS at the
  postgres level was aspirational and never reliably enforced
- Dashboard widgets accept locale-specific date / time / number
  formatting via the active `next-intl` bundle

### Fixed
- `init.sql` was missing `people.is_child`, `events.person_id`, and
  `birthdays.person_id` — fresh installs now match what production has
  been running. Existing installs get patched up by
  `migration_person_assignment.sql`.
- `_realtime` schema now created up-front in `init.sql` — some
  `supabase/postgres` image versions don't auto-create it, causing the
  realtime container to crash-loop with "no schema has been selected"
- `webapp/deploy.sh` chains `docker-compose.traefik.yml` overlay on
  every recreate, so Traefik labels survive container rebuilds
- The full `energy` translation namespace (58 keys) — the page was
  rendering literal `energy.title` placeholders before
- Weather routes now accept `OPENWEATHERMAP_BASE_URL` env override
  (defaults unchanged) so the screenshot toolchain can mock OWM

### Security
- Demo screenshot toolchain anonymizes prod data exhaustively before
  any capture — see `docs/wiki/screenshots/scripts/4-anonymize.mjs`
- VAPID keys, Supabase secrets, and family join codes are generated
  fresh per install via `setup.sh`; no shared defaults

---

[Unreleased]: https://github.com/svenger87/kinboard/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/svenger87/kinboard/releases/tag/v1.0.2
[1.0.1]: https://github.com/svenger87/kinboard/releases/tag/v1.0.1
[1.0.0]: https://github.com/svenger87/kinboard/releases/tag/v1.0.0
