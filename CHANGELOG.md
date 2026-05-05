# Changelog

All notable changes to Kinboard land here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
