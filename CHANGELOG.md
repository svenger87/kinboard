# Changelog

All notable changes to Kinboard land here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Calendar event reminders via web push. Family devices subscribed to push now receive a notification N minutes before each event starts (configurable per family on `/settings/notifications`, default 30 min). All-day events are skipped — they don't have a "30 min before" semantically. New cron `/api/cron/schedule-event-reminders` runs every 5 min and schedules notifications for events in the upcoming window via the existing `scheduled_notifications` queue; the existing `process-notifications` cron then fires them. Idempotent: multiple cron ticks scanning the same event window don't double-schedule.

## [1.0.16] - 2026-05-09 — Country-aware holidays + dashboard spacing

### Added
- Country-aware public holiday support — DE (Germany), US, UK, NL, FR. A new country picker on `/settings/language` lets each family choose which country's public holidays appear on the calendar and the today-strip. Existing families default to `de` (Germany) automatically, so current behavior is unchanged. The holiday engine now lives in `src/lib/holidays/` with per-country files sharing common Easter/weekday utilities; `src/lib/german-holidays.ts` is kept as a deprecated compatibility shim so consumers don't break during migration.

### Fixed
- TodayStrip on the dashboard sat flush against the widget grid below on portrait/short viewports. Added bottom margin matching the existing `mt-12` rhythm above FamilyMembers so the section has breathing room.

## [1.0.15] - 2026-05-09 — Clock detail popover is touch-accessible

### Fixed
- The clock widget's hover-only tooltip showed the full weekday, calendar week, day-of-year, days-remaining, and year-progress bar — but kiosks and phones can't trigger hover, so this rich detail was unreachable on the very devices Kinboard targets first. Both tooltips on the clock (the big one wrapping the digital time, the small one wrapping the week-number badge) now use a shadcn Popover instead. Tap to open, click outside to dismiss — works identically across desktop, touch kiosk, and mobile. The trigger element is a real `<button>` with explicit focus ring + `aria-label` so keyboard and screen-reader users get the same affordance the previous tooltip relied on implicitly.

## [1.0.14] - 2026-05-09 — News reader image-dedup

### Fixed
- News article reader sheet rendered the same hero image twice for some publishers (Spiegel notably) because their HTML embeds the same image at multiple sizes inside a single `<figure>` for art-direction reasons. Mozilla Readability preserved all of them. The article extractor now walks the Readability output and keeps only the first `<img>` per `<figure>` / `<picture>` wrapper — a `<figure>` is semantically one figure regardless of how many `<img>` tags are inside, so this is a structural fix that works across publishers without URL-pattern guessing.

## [1.0.13] - 2026-05-09 — Vehicles dashboard widget polish

### Changed
- Vehicles dashboard widget now renders a compact `WidgetCard` (car image + battery percentage + charging rate or range) instead of the full `/vehicles` Card, so the widget fits the 1/4-grid dashboard layout without dominating it. New `WidgetCard` slot on the `VehicleDriver` contract — both Tesla and Generic-EV drivers ship one. The full Card on `/vehicles` is unchanged; tabs through multiple vehicles, the rotating dashboard widget, and the link to the full page still all work as before.

### Fixed
- Dropped the redundant settings-gear icon from the Tesla `/vehicles` Card's top action row. The `/vehicles` PageHeader already has a "Manage" button pointing at `/settings/vehicles` — the in-card gear was duplicate noise. Empty-state CTAs ("Connect Home Assistant", "Configure this Tesla") still link to the right settings page since they're the only entry point for unconfigured vehicles.

## [1.0.12] - 2026-05-09 — Vehicles plugin + plugin contract v0.1 + Watchtower-safe migrations

### Added
- **`/tesla` becomes `/vehicles`** — supports multiple cars per household and multiple vendors. Existing single-Tesla setups auto-migrate via `migration_vehicles.sql` (reads the existing `tesla_config` blob from `public.settings WHERE key='home_assistant'` into a new `vehicles` table row with `vendor='tesla'`); no action needed by existing self-hosters. The `/tesla` and `/settings/tesla` URLs 308-redirect to the new pages so bookmarks keep working. New Generic-EV driver (config = 5 Home Assistant entity IDs: battery, charging state, range, location, state) supports any car HA can talk to — VW We Connect, BMW Connected Drive, Polestar, Hyundai BlueLink, OBD2 dongles, etc. — without per-vendor maintenance. Dashboard widget rotates through configured vehicles every 8s. `widget_visibility.tesla` saved values auto-migrate to `widget_visibility.vehicles` at read time so users keep seeing the widget after upgrade. See [`docs/wiki/Vehicles.md`](docs/wiki/Vehicles.md) for end-user docs.
- **Build-time plugin contract** — Vehicles is the first surface implemented under the new `SurfacePlugin` interface (`webapp/src/plugins/`). Plugins contribute a nav item, a settings-landing entry, an optional dashboard widget, and a predicate-based gating hook; the registry at `webapp/src/plugins/registry.ts` is the single registration point. Future work migrates Energy and Cameras onto the same model. See [`docs/wiki/Plugin-Architecture.md`](docs/wiki/Plugin-Architecture.md) for the contract and the "copy-Tesla recipe" walkthrough for adding a new vehicle driver, plus [`docs/wiki/Plugin-Directory.md`](docs/wiki/Plugin-Directory.md) for the community-maintained third-party plugin list.
- `/settings/vehicles` settings flow: list page, new-vehicle vendor picker, per-vehicle edit page with shared nickname/color fields + driver-supplied `ConfigForm`. `/settings/tesla` now redirects (308) to `/settings/vehicles`; the old 769-line tesla settings page is replaced by a one-line redirect stub.
- `/settings/plugins` page lists bundled plugins from the registry with a per-family enable/disable toggle. Storage in `family.settings.enabled_plugins` (JSONB `Record<string,boolean>`); default-on when a plugin id is missing from the blob (so new plugins ship enabled and existing families auto-pick them up). Disabled plugins disappear from the bottom nav, the dashboard widget grid, and the settings integrations list. Data is preserved (no rows deleted) — toggling back on restores the plugin exactly. The Vehicles plugin is the only registry-driven plugin shipping today; Energy and Cameras will join when they migrate to the plugin contract.
- Per-vehicle image upload on `/settings/vehicles/[id]` — pick a PNG, JPG, or WebP up to 5 MB and the dashboard widget + `/vehicles` page render it instead of the canned Tesla Model Y silhouette. Stored in a new `vehicle-images` Supabase Storage bucket (public read, family-scoped path); existing Tesla setups without an upload keep falling back to `/images/tesla-model-y.png`. Generic-EV vehicles without an image render no image (avoids showing a misleading vendor render). New idempotent migration `migration_vehicles_image.sql` creates the bucket + adds `vehicles.image_url` column.

### Changed
- **Migrations now apply automatically when the webapp container starts.** Previously, schema migrations lived as `webapp/docker/migration_*.sql` files that only ran when the operator invoked `start.sh up` or `start.sh migrate` from the host. Watchtower-driven self-hoster updates pulled a new webapp image but never re-applied migrations — leaving the new code expecting schema that wasn't there yet. The webapp Docker image now bakes the migration files in and runs them on every container start via a new `webapp-entrypoint.sh` (with `pg_isready` wait + `ON_ERROR_STOP=1` psql + `NOTIFY pgrst` schema reload). Each migration is idempotent so re-running is a no-op. Existing `start.sh run_migrations()` remains the host-driven path and produces identical results — the two paths are kept in sync. **Action for existing self-hosters:** re-run `./setup.sh` (no `--force` needed) once after pulling — the script's `# webapp_origin` rewrite picks up this release's new Kong route's CORS origin from your `SITE_URL`.
- Settings landing page Integrations section: Tesla item replaced by a Vehicles item pointing at `/settings/vehicles`. New Plugins entry under Display points at `/settings/plugins`.
- `webapp/docker/` directory cleanup: deleted `migrations/add_kiosk_mode.sql` (redundant with `init.sql` + `migration.sql`); deleted `migrate-prod.sh` (one-off May-7 templated-compose helper, recoverable from git history); renamed `migration_vehicle_images.sql` → `migration_vehicles_image.sql` so it sorts alphabetically AFTER `migration_vehicles.sql` (the rename fixes a real bug where a fresh-install first boot would try to ALTER the `vehicles` table before the previous migration had created it). The alphabetical-ordering invariant is now documented in `start.sh`'s `run_migrations()` so future contributors don't re-introduce the footgun.

### Fixed
- Public-bucket image URLs returned by `/api/{recipes,vehicles}/upload-image` were unreachable from the browser. `supabase.storage.getPublicUrl()` derived the URL from the admin client's internal `SUPABASE_URL=http://kong:8000` (intentionally internal so server-side calls take the fast in-network path), but the browser can't resolve `kong:8000`. New helper `webapp/src/lib/supabase/public-url.ts` constructs URLs from `NEXT_PUBLIC_SUPABASE_URL` (the external host the browser uses for every other Supabase call); both upload endpoints route through it. Affects anyone who manually uploaded a recipe image (Chefkoch imports were unaffected — they store the upstream `chefkoch-cdn.de` URL directly). Vehicles never shipped before this release so no prior data is broken.
- Kong now serves `/storage/v1/object/public/*` without requiring an API key — public buckets are intentionally world-readable in Supabase, but the catchall `/storage/v1/*` route's `key-auth` plugin was 401-ing every browser request to public-bucket images, breaking image rendering anywhere the Supabase JS client wasn't in the loop (e.g. `<Image>` components, Next.js image optimizer, manual `<img src=...>`). New `storage-v1-public` route splits this off; the more-specific path is matched first and forwards public-object requests through with CORS only.

## [1.0.11] - 2026-05-08 — Device recognition resilience + interactive setup + Shopping PWA fixes

### Added
- Device recognition now survives browser/OS updates that change the fingerprint hash. Three changes work together: (1) `getDeviceFingerprint()` (`webapp/src/lib/device-id.ts`) drops `navigator.userAgent` and `navigator.deviceMemory` from its input set — both drift across browser updates and invalidated every existing match the moment Safari/Chrome shipped a new minor; (2) new `devices.fingerprint_history TEXT[]` column (`migration_fingerprint_history.sql`, idempotent + GIN-indexed, backfilled with each device's current fingerprint) accumulates every fingerprint a device has presented; (3) `useFindDeviceByFingerprint` queries `fingerprint = X OR X = ANY(fingerprint_history)` and appends the current fingerprint on each match. Existing devices need to manually rejoin once via family code after the rollout — after that, future wipes recover automatically. Plus a new recovery-hint card on `/join` when the fingerprint check returns no match, explaining where to find the family code on another device. New wiki page [`Device-Recognition.md`](docs/wiki/Device-Recognition.md) walks through the architecture, what it survives, what it doesn't, and the recovery flow.
- iOS-specific hint on `/shopping` when running inside the installed Kinboard PWA. The shopping install prompt previously detected `display-mode: standalone` and silently returned `null`, leaving users searching for the install prompt with no signal that iOS only allows "Add to Home Screen" from Safari, not from inside another PWA. New blue info card explains the path. Separate dismiss cookie so users can dismiss it independently of the install prompt itself.
- `setup.sh` now walks fresh self-hosters through optional integration keys interactively after the secrets-generation step. Three default prompts: maintainer email (auto-syncs `VAPID_SUBJECT` to `mailto:<email>` when the email is fresh and the subject is still the example default), `OPENWEATHERMAP_API_KEY`, and Google Calendar OAuth (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` with a hint pointing at `console.cloud.google.com/apis/credentials` + a wiki walkthrough). Each prompt is skip-with-Enter; idempotent re-runs only prompt for keys that are still empty. New flags: `--non-interactive` (CI / Docker entrypoint use; never prompts), `--advanced` (also prompts for Immich, Bring!, camera credentials, and SMTP server config — keys that have per-family in-app UIs but can be defaulted at the stack level). The post-setup "Next steps" output now lists exactly which keys are still empty so users know what to come back and fill in via `./setup.sh` or by editing `webapp/docker/.env` directly.

### Changed
- **`/einkaufen` and `/shopping` are deliberately distinct pages, not aliases.** Earlier in this cycle the historic 793-line `/einkaufen/page.tsx` was deleted under the (wrong) assumption it had silently diverged from `/shopping/page.tsx`. It hadn't — it was the kiosk-optimized offline-first shopping surface that the standalone Shopping PWA's `start_url` deliberately landed on, built on `useOfflineShopping` (offline queue + service-worker sync), `OfflineBanner`, and a leaner UI without the Bring!/popovers/dialogs found on `/shopping`. Restored from git history (`webapp/src/app/einkaufen/page.tsx`); `next.config.mjs` no longer rewrites the URL. `/shopping` remains the full-featured desktop page; `/einkaufen` is the kiosk page that the Shopping PWA opens at. `manifest-shopping.json` keeps `start_url` + `scope` at `/einkaufen` (unchanged), so installed Shopping PWAs continue to land on the kiosk view as intended. Push-notification URLs still point at `/einkaufen` so notification taps open the installed PWA via the iOS scope-match banner.
- `/api/settings?family_id=X&key=Y` GET now returns HTTP 200 with `{ value: null }` when no setting row exists, instead of 404. The hooks that consume this endpoint (`use-google-calendar`, `use-cameras`, `use-home-assistant`, etc.) all already converted 404→null internally — but the browser still logged "Failed to load resource: 404" to the console on every page load while integrations were unconfigured (which is the default state for fresh self-host installs and the demo overlay). Caught by the E2E smoke workflow on `/calendar` where `google_calendar` isn't seeded.
- `/api/cities` now degrades gracefully on **any** non-200 from OpenWeatherMap (invalid/expired key, rate-limited, OWM outage), not just on a missing key. v1.0.9 added the missing-key path; this extends it to all error paths so the dashboard's reverse-geocode call never produces "Failed to load resource: 500" console errors regardless of OWM's mood. Also adds an `OPENWEATHERMAP_GEO_URL` env override so the demo overlay (which routes weather to mock containers) can intercept geo lookups without disturbing real-OWM-using stacks. Caught by the new E2E smoke workflow on its first real CI run.

## [1.0.10] - 2026-05-08 — Setup wizard + Leave family fix

### Added
- First-run setup wizard at `/setup/{people,homeassistant,weather,done}`. Fresh self-host installs that come through `/join` → "Create family" now route into a guided onboarding (add 1+ family members, optional Home Assistant URL+token with live test, optional city for the weather widget) instead of dropping the user on an empty dashboard. Each step is individually skippable. After completion, a new `families.setup_completed` flag (idempotent migration `migration_setup_completed.sql`, existing rows backfilled to TRUE so existing self-hosters never see the wizard) suppresses the dashboard's "Finish setting up Kinboard" banner. Banner is also dismissible per-device via localStorage. The OpenWeatherMap API key step is documentation-only because it's an env var (`OPENWEATHERMAP_API_KEY` in `webapp/docker/.env`) the browser can't write — wizard surfaces it as a hint when `/api/weather` returns `{ configured: false }`. `NO_NAV_PATHS` now uses prefix-aware matching via `isNoNavPath()` to suppress the bottom nav across all wizard sub-routes (also fixes a latent `/joiner` matching `/join` bug). See `webapp/src/app/setup/`.

### Fixed
- "Leave family" in `/settings` now actually leaves: the device row is deleted server-side via `useDeleteDevice` *before* the local cookie is cleared. Previously the handler called `clearSession()` only — local state cleared, but the device fingerprint stayed in the `devices` table, so visiting `/join` immediately matched the device by fingerprint and showed a "Welcome back, *Device* in *Family*" rejoin card. The leave looked silently broken because users were one click away from being right back in the family they just left. Cookie-loss-without-leave (browser update, cleared privacy data, fresh profile) still gets the rejoin card — that's the intended use of fingerprint detection. The two flows are now properly differentiated by what's in the DB, not by client-side state.
- AuthGuard's "authenticated user on /join → /" redirect now respects `setup_completed`: families just created via /join's "Create family" form are routed to `/setup` (the wizard), not `/`. Previously the guard's effect re-fired the moment Zustand picked up the new family, racing /join's `router.push("/setup/people")` and winning, dropping fresh-install users on an empty dashboard. The strict `setup_completed === false` check means pre-1.0.10 stored families that lack the field still default to the dashboard, preserving legacy behavior for upgraders.

## [1.0.9] - 2026-05-08 — Meal-plan upsert + chunk-reload recovery + E2E smoke

### Added
- New `webapp/docker/docker-compose.override.yml.example` documents the per-host override pattern, including the Intel-iGPU device passthrough (`/dev/dri/renderD128`) needed for VAAPI hardware-accelerated HEVC→H.264 transcoding on the go2rtc service. Copy to `docker-compose.override.yml` (gitignored) and edit for your hardware. Wiki [Cameras](https://github.com/svenger87/kinboard/wiki/Cameras#performance--hardware-accelerated-transcode) page updated with the full enable-procedure + verification commands + new troubleshooting rows for HEVC tiles staying black and ICE failures from a port mismatch.
- E2E smoke suite at `webapp/e2e/smoke.spec.ts` — behavior assertions (route 200s, PWA manifest + icons resolve, no console errors on key authenticated pages) distinct from the existing `visual-audit.spec.ts` screenshot capture. Run via `npm run test:e2e:smoke`. Anonymous tests run without setup; authenticated tests require `FAMILY_CODE` pointing at a join code on the target stack. `PLAYWRIGHT_AUTOSTART_DEV=1` makes Playwright spawn `next dev` itself for fresh-checkout runs. CI integration tracked separately. See `webapp/e2e/README.md`.

### Fixed
- Meal-plan upsert (and any other PostgREST `on_conflict=` write that targets `meal_plans`, `item_catalog`, or `recipe_tags`) failed with HTTP 400 on installs that pre-date the `UNIQUE` clauses landing in `init.sql`. Root cause: `init.sql`'s `CREATE TABLE IF NOT EXISTS` skips the table on a re-run, so any `UNIQUE` clause that was added to the schema after the table was first created never got applied. New `migration_unique_constraints.sql` backfills the three missing constraints idempotently (no-op if already present), and `NOTIFY pgrst` reloads the schema cache so PostgREST sees them without a container restart. `start.sh up` runs migrations on every boot, so existing self-hosters are healed automatically on next stack restart.
- `ChunkLoadError` after Watchtower auto-updates (or any in-place webapp redeploy) no longer leaves users on a broken page. New `<ChunkErrorRecovery>` listens at the window level for failed chunk loads and triggers a one-shot reload (gated by `sessionStorage` to avoid loops). On reload, the service-worker caches are cleared first so the fresh bootstrap doesn't bounce off the same stale chunks. **Plus** the service worker's `CACHE_NAME` now embeds the `package.json` version (substituted at Docker build time via `sed` against the `__KINBOARD_VERSION__` placeholder), so each release's `activate` event evicts the previous release's chunk cache automatically.
- Push-notification badge (`/icons/badge-72.png`, referenced by `webapp/public/sw.js` for every push payload) was a full-color resize of the Kinboard icon, which Android renders as a featureless white blob in the status bar — the OS notification spec only consumes the alpha channel and applies its own tint, discarding RGB. Regenerated as a proper monochrome white-on-transparent silhouette so notifications display the actual house outline.
- `/api/cities` now follows the documented degrade-gracefully pattern (`{ configured: false }` with HTTP 200) when `OPENWEATHERMAP_API_KEY` is unset, instead of returning HTTP 500. Found by the new E2E smoke suite running against `demo.kinboard.app`: the dashboard's reverse-geocode call (`/api/cities?q=Hamburg&limit=1` from `useWeatherMapConfig`) fired on every load and produced two `Failed to load resource: 500` console errors per page view on stacks without a configured OWM key. Both callers (`useWeatherMapConfig` in `use-weather.ts`, suggestion autocomplete in `settings/weather/page.tsx`) now tolerate the new response shape via an `Array.isArray` guard.

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
