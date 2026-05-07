# Changelog

All notable changes to Kinboard land here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
