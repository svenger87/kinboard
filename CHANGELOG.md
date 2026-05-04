# Changelog

All notable changes to Familyboard land here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-05-04

Initial public release.

### Added
- Built-in real-time shopping list with offline support (PWA + IndexedDB
  queue), separately installable as its own home-screen icon
- Two-way Google Calendar sync: events created in Familyboard now push
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
  `ghcr.io/svenger87/familyboard` on push to main and tagged releases
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

[Unreleased]: https://github.com/svenger87/familyboard/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/svenger87/familyboard/releases/tag/v1.0.0
