<div align="center">

<img src="assets/logos/kinboard-banner.png" alt="Kinboard" width="600"/>

**A self-hosted family dashboard for the kitchen wall.**
Calendar · weather · photos · shopping list · smart-home — one screen, every device, real-time sync.

[![License: MIT](https://img.shields.io/github/license/svenger87/kinboard?style=flat-square&color=blue&cacheSeconds=300)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/svenger87/kinboard/ci.yml?branch=main&style=flat-square&label=CI&cacheSeconds=300)](https://github.com/svenger87/kinboard/actions/workflows/ci.yml)
[![Docker image](https://img.shields.io/badge/ghcr.io-kinboard-blue?logo=docker&logoColor=white&style=flat-square)](https://github.com/svenger87/kinboard/pkgs/container/kinboard)
[![Release](https://img.shields.io/github/v/release/svenger87/kinboard?style=flat-square&include_prereleases&cacheSeconds=300)](https://github.com/svenger87/kinboard/releases)
[![Stars](https://img.shields.io/github/stars/svenger87/kinboard?style=flat-square&logo=github&cacheSeconds=300)](https://github.com/svenger87/kinboard/stargazers)
[![Issues](https://img.shields.io/github/issues/svenger87/kinboard?style=flat-square&cacheSeconds=300)](https://github.com/svenger87/kinboard/issues)

<br/>

### **[▶ Try the live demo](https://demo.kinboard.app)** &nbsp;·&nbsp; **[Visit kinboard.app](https://kinboard.app)**

<sub>The landing page at **[kinboard.app](https://kinboard.app)** has the pitch, screenshots, and install path. The demo at **[demo.kinboard.app](https://demo.kinboard.app)** runs the latest tagged release with mock integrations — use join code **`DEMO01`** to load a populated household, or create your own family from scratch. Demo data resets daily.</sub>

<br/>

<img src="docs/wiki/images/dashboard-portrait.png" alt="Kinboard dashboard — kitchen kiosk portrait view" width="420"/>

<sub>Built for kiosk-style touchscreens but works on any phone, tablet, or browser. Multi-device, multi-person, no cloud account required.</sub>

</div>

---

## Table of contents

- [Why](#why)
- [Features](#features)
- [Quick start](#quick-start)
- [Screenshots](#screenshots)
- [Integrations](#integrations)
- [Tech stack](#tech-stack)
- [Reference hardware build](#reference-hardware-build)
- [Documentation](#documentation)
- [Status & roadmap](#status--roadmap)
- [Contributing](#contributing)
- [Support development](#support-development)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## Why

Family logistics are scattered across calendars, chat threads, sticky notes, and "did you check the shopping list?" Kinboard consolidates the daily-driver stuff into one always-on display, so the family knows what's happening without opening apps.

- **Self-hosted.** Your data stays on your hardware. No SaaS, no telemetry, no account gating.
- **Real-time.** Edit a shopping item on your phone, it appears on the kitchen wall in milliseconds (Supabase Realtime over WebSockets).
- **Offline-tolerant.** The shopping list works in the basement supermarket without signal — changes queue locally and replay when the device gets connectivity back.
- **Touch-friendly.** Designed for wall-mounted tablets first; mobile and desktop are first-class too.
- **Modular.** Pick the integrations you actually use; the rest stay invisible.

**How it compares:** Kinboard is *interactive and shared*, not a read-only wall display. Unlike **DAKboard**, there's no subscription and no cloud account — your data stays on your hardware. Unlike **MagicMirror²**, there are no per-module config files to hand-edit; you configure everything in the UI, and edits sync to every device in real time. And unlike a generic **Home Assistant dashboard**, it's built family-first — calendar, shopping, meals, chores, school schedule, and pocket money are first-class features, not entity cards you assemble yourself.

---

## Features

| Feature | Wiki page |
|---|---|
| **Dashboard** — clock, today strip, configurable widget grid | [Dashboard](https://github.com/svenger87/kinboard/wiki/Dashboard) |
| **Calendar** — two-way Google Calendar sync, per-person colors, holidays, waste-pickup widgets | [Calendar](https://github.com/svenger87/kinboard/wiki/Calendar) |
| **Shopping list** — built-in real-time list with **offline support** + dedicated standalone PWA, optional Bring! sync | [Shopping](https://github.com/svenger87/kinboard/wiki/Shopping) |
| **Recipes & meal planning** — Chefkoch.de search + schema.org URL import, weekly meal board, recipe-driven shopping | [Recipes & meals](https://github.com/svenger87/kinboard/wiki/Recipes) |
| **Tasks & todos** — per-person assignment, priorities, daily reminder push | [Tasks & todos](https://github.com/svenger87/kinboard/wiki/Tasks) |
| **Notes** — quick shared sticky notes for the household | [Notes](https://github.com/svenger87/kinboard/wiki/Notes) |
| **Birthdays** — year-ring viz, countdowns, gift-idea tracking | [Birthdays](https://github.com/svenger87/kinboard/wiki/Birthdays) |
| **School schedule** — per-child timetable + auto pack list for tomorrow | [Schedule](https://github.com/svenger87/kinboard/wiki/Schedule) |
| **Smart home** — Home Assistant entities, room tabs, floating-lights master control | [Smart home](https://github.com/svenger87/kinboard/wiki/Smart-Home) |
| **Energy dashboard** — solar / battery / grid live flow + charts | [Smart home → Energy](https://github.com/svenger87/kinboard/wiki/Smart-Home#energy) |
| **Cameras** — live WebRTC streams (via go2rtc) | [Cameras](https://github.com/svenger87/kinboard/wiki/Cameras) |
| **Pocket money** — per-kid virtual accounts with parent-configurable APR, allowance cron, saving goals + parent-approval queue, evolving avatar (5 species × 8 stages) | [Pocket Money](https://github.com/svenger87/kinboard/wiki/Pocket-Money) |
| **Photo screensaver** — Immich monthly album or Unsplash fallback, presence-aware blanking | [Screensaver](https://github.com/svenger87/kinboard/wiki/Screensaver) |
| **Weather** — current + hourly + radar (OpenWeatherMap) | [OpenWeatherMap](https://github.com/svenger87/kinboard/wiki/OpenWeatherMap) |
| **Web push notifications** — shopping items, task assignments, daily todo digest. **PWA install** required on iOS. | [Notifications](https://github.com/svenger87/kinboard/wiki/Notifications) |
| **Multi-device + multi-person** — devices join a family with a 6-char code, per-person color coding everywhere | [Family members](https://github.com/svenger87/kinboard/wiki/Family-Members), [Devices](https://github.com/svenger87/kinboard/wiki/Devices) |
| **Monthly themes** — colors shift through the year automatically | [Themes & locales](https://github.com/svenger87/kinboard/wiki/Themes) |
| **i18n** — English + German, full UI parity | [Themes & locales](https://github.com/svenger87/kinboard/wiki/Themes) |

The full wiki has a page for every feature plus integration setup, kiosk hardware reference build, security model, and database schema.

---

## Quick start

**Prerequisites:** **Docker** (with Compose v2), ~2 GB free disk, ~10 minutes. That's it. `./start.sh up` **pulls the pre-built multi-arch image** (amd64 + arm64) from `ghcr.io` by default — no local build, ~30 seconds to first paint, ~512 MB RAM at runtime. It brings up the Next.js app, a self-hosted Supabase stack, and supporting services.

If you don't have Docker yet:

```bash
curl -fsSL https://get.docker.com | sh
```

Then bring Kinboard up:

```bash
git clone https://github.com/svenger87/kinboard.git
cd kinboard
./setup.sh                # generate random secrets + Supabase JWT keys
cd webapp/docker
./start.sh up             # pulls the pre-built image + starts the stack
```

Open `http://<server-ip>:3001` (or `http://localhost:3001` if local), follow the setup wizard to create your first family, and start adding integrations from `/settings`. Want to look before you install? **[Try the live demo →](https://demo.kinboard.app)** (join code `DEMO01`).

> **Push notifications** need **Node.js 20+** for a one-time VAPID key generation. If `node` isn't on PATH when `setup.sh` runs, push stays disabled (everything else works); install Node.js + re-run `./setup.sh --force` later to enable.

> **Building from source** instead? Remove the [`docker-compose.image.yml`](webapp/docker/docker-compose.image.yml) overlay and the local Next.js build peaks around **4 GB** RAM, plus ~3–4 GB during type-check + static-page generation — on a 4 GB VM add **≥ 8 GB swap** to avoid OOM kills (`fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`). Pulling the pre-built image (the default above) skips all of that.

### Updating

`./start.sh up` reuses the cached image — fast for restarts but won't pick up new code. After pulling source updates, use:

```bash
git pull
cd webapp/docker
./start.sh restart    # rebuilds the webapp image + recreates webapp + cron
```

**Hands-off auto-update** — `cp docker-compose.diun.yml.example docker-compose.diun.yml`, run `./setup.sh --non-interactive` to fill in the required `.env` keys (`DIUN_WEBHOOK_SECRET`, `KINBOARD_PROJECT_DIR`, `COMPOSE_PROJECT_NAME`, `COMPOSE_FILES`), then bring the stack up with `-f docker-compose.diun.yml --build` added. Diun watches GHCR for new `kinboard-webapp` digests; when one lands, a webhook fires `kinboard-self-update.sh` which runs the full upgrade path (`git pull` → `setup.sh --non-interactive` → `compose pull` → `up -d` → `kong restart` if `kong.yml` changed). Replaces the deprecated Watchtower overlay (Watchtower was archived in 2024 and only handles the image step, missing the surrounding config substitutions). See [Self-hosting → Auto-updates](https://github.com/svenger87/kinboard/wiki/Self-hosting#auto-updates) for the full setup including the flat-layout migration.

For production self-hosting (Traefik + custom domain + backups + updates), see [Self-hosting](https://github.com/svenger87/kinboard/wiki/Self-hosting).

---

## Screenshots

A few highlights from the [demo data set](docs/wiki/screenshots/) — see the [wiki](docs/wiki/) for the per-feature pages.

<table>
  <tr>
    <td align="center"><a href="docs/wiki/images/calendar-month-view.png"><img src="docs/wiki/images/calendar-month-view.png" alt="Calendar" width="280"/></a><br/><sub>Calendar</sub></td>
    <td align="center"><a href="docs/wiki/images/energy-flow-diagram.png"><img src="docs/wiki/images/energy-flow-diagram.png" alt="Energy" width="280"/></a><br/><sub>Energy dashboard</sub></td>
    <td align="center"><a href="docs/wiki/images/home-automation-rooms.png"><img src="docs/wiki/images/home-automation-rooms.png" alt="Home automation" width="280"/></a><br/><sub>Home automation</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/wiki/images/shopping-list-mixed.png"><img src="docs/wiki/images/shopping-list-mixed.png" alt="Shopping" width="280"/></a><br/><sub>Shopping</sub></td>
    <td align="center"><a href="docs/wiki/images/birthdays-year-ring.png"><img src="docs/wiki/images/birthdays-year-ring.png" alt="Birthdays" width="280"/></a><br/><sub>Birthdays</sub></td>
    <td align="center"><a href="docs/wiki/images/recipes-library.png"><img src="docs/wiki/images/recipes-library.png" alt="Recipes" width="280"/></a><br/><sub>Recipes</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/wiki/images/meals-week-board.png"><img src="docs/wiki/images/meals-week-board.png" alt="Meal planning" width="280"/></a><br/><sub>Meal planning</sub></td>
    <td align="center"><a href="docs/wiki/images/schedule-week-grid.png"><img src="docs/wiki/images/schedule-week-grid.png" alt="School schedule" width="280"/></a><br/><sub>School schedule</sub></td>
    <td align="center"><a href="docs/wiki/images/todos-overview.png"><img src="docs/wiki/images/todos-overview.png" alt="Todos" width="280"/></a><br/><sub>Tasks & todos</sub></td>
  </tr>
</table>

A light-mode variant of every screenshot is available with `-light` suffix (e.g. `dashboard-portrait-light.png`), and a phone-viewport variant lives in `docs/wiki/images/mobile/`. The full toolchain that produces them — local docker stack with anonymized prod data + mock HA / Tesla / OpenWeatherMap servers + Playwright capture — lives in [`docs/wiki/screenshots/`](docs/wiki/screenshots/).

---

## Integrations

| Service | Purpose | Required? |
| --- | --- | --- |
| Supabase (self-hosted) | Database + realtime sync | Yes (bundled) |
| OpenWeatherMap | Weather forecasts + radar | Optional, free tier OK |
| Google Calendar | Two-way calendar sync | Optional |
| Immich | Photo screensaver and gallery | Optional |
| Home Assistant | Smart-home entities and energy | Optional |
| Bring! | Shopping list sync (built-in list works without it) | Optional |
| go2rtc | WebRTC camera streams | Optional |

Niche integrations (Tesla Fleet, Zendure SolarFlow batteries, etc.) ship as opt-in plugins. See the [plugin authoring guide](https://github.com/svenger87/kinboard/wiki/Plugin-Authoring) to build your own.

---

## Tech stack

- **[Next.js](https://nextjs.org/) 16** (App Router) + **[React](https://react.dev/) 19**
- **[shadcn/ui](https://ui.shadcn.com/)** + **[Tailwind CSS](https://tailwindcss.com/)** for UI
- **[TanStack Query](https://tanstack.com/query)** (server state) + **[Zustand](https://zustand-demo.pmnd.rs/)** (client state)
- **[Supabase](https://supabase.com/)** (Postgres + Realtime) — self-hosted
- **[next-intl](https://next-intl.dev/)** for i18n (EN + DE)
- **[Framer Motion](https://www.framer.com/motion/)** for transitions
- **Service worker + IndexedDB** for offline shopping
- **[Playwright](https://playwright.dev/)** for the screenshot capture suite

---

## Reference hardware build

Kinboard is hardware-agnostic — any HDMI display + any small PC works. For people who want a known-good combination, [Reference build](https://github.com/svenger87/kinboard/wiki/Reference-Build) documents one ~€700 setup with a 27" capacitive touchscreen + a Mele Quieter 4C mini-PC + a custom oak frame, with a complete BOM, wiring, and what didn't work.

For software side of the kiosk install: [Windows 11 (Mele 4C)](https://github.com/svenger87/kinboard/wiki/Kiosk-Windows-11-Mele-4C) walks through Edge `--kiosk` mode + the on-screen keyboard, and [Linux guidance](https://github.com/svenger87/kinboard/wiki/Kiosk-Linux-Guidance) covers Cage / GNOME / X11 alternatives.

---

## Documentation

The wiki is the source of truth for everything beyond this README:

- **Getting started** — [Quick-start](https://github.com/svenger87/kinboard/wiki/Quick-start), [Self-hosting](https://github.com/svenger87/kinboard/wiki/Self-hosting), [Onboarding](https://github.com/svenger87/kinboard/wiki/Onboarding)
- **Architecture** — [Architecture overview](https://github.com/svenger87/kinboard/wiki/Architecture), [Database schema](https://github.com/svenger87/kinboard/wiki/Database-Schema), [Security model](https://github.com/svenger87/kinboard/wiki/Security-and-Threat-Model)
- **Built-in features** — [Dashboard](https://github.com/svenger87/kinboard/wiki/Dashboard) · [Calendar](https://github.com/svenger87/kinboard/wiki/Calendar) · [Shopping](https://github.com/svenger87/kinboard/wiki/Shopping) · [Recipes & meals](https://github.com/svenger87/kinboard/wiki/Recipes) · [Tasks](https://github.com/svenger87/kinboard/wiki/Tasks) · [Notes](https://github.com/svenger87/kinboard/wiki/Notes) · [Birthdays](https://github.com/svenger87/kinboard/wiki/Birthdays) · [Schedule](https://github.com/svenger87/kinboard/wiki/Schedule) · [Smart home](https://github.com/svenger87/kinboard/wiki/Smart-Home) · [Screensaver](https://github.com/svenger87/kinboard/wiki/Screensaver) · [Family members](https://github.com/svenger87/kinboard/wiki/Family-Members) · [Devices](https://github.com/svenger87/kinboard/wiki/Devices) · [Notifications](https://github.com/svenger87/kinboard/wiki/Notifications) · [Themes & locales](https://github.com/svenger87/kinboard/wiki/Themes)
- **Integrations** — [Google Calendar](https://github.com/svenger87/kinboard/wiki/Google-Calendar) · [Home Assistant](https://github.com/svenger87/kinboard/wiki/Home-Assistant) · [Immich](https://github.com/svenger87/kinboard/wiki/Immich) · [Bring!](https://github.com/svenger87/kinboard/wiki/Bring) · [OpenWeatherMap](https://github.com/svenger87/kinboard/wiki/OpenWeatherMap) · [Cameras](https://github.com/svenger87/kinboard/wiki/Cameras)
- **Hardware** — [Reference build (BOM + frame)](https://github.com/svenger87/kinboard/wiki/Reference-Build) · [Windows kiosk](https://github.com/svenger87/kinboard/wiki/Kiosk-Windows-11-Mele-4C) · [Linux guidance](https://github.com/svenger87/kinboard/wiki/Kiosk-Linux-Guidance) · [LD2410 presence sensor](https://github.com/svenger87/kinboard/wiki/Presence-Sensor)
- **Extending Kinboard** — [Vehicles](https://github.com/svenger87/kinboard/wiki/Vehicles) · [Stonks](https://github.com/svenger87/kinboard/wiki/Stonks) · [Pocket Money](https://github.com/svenger87/kinboard/wiki/Pocket-Money) · [Plugin architecture](https://github.com/svenger87/kinboard/wiki/Plugin-Architecture) · [Plugin directory](https://github.com/svenger87/kinboard/wiki/Plugin-Directory)
- **[Troubleshooting](https://github.com/svenger87/kinboard/wiki/Troubleshooting)** — known issues + fixes

---

## Status & roadmap

**v1.0.0 shipped 2026-05-04** — first tagged public release. **Latest: [v1.2.0](https://github.com/svenger87/kinboard/releases/tag/v1.2.0) (2026-06-01).** Live demo running the latest tag at **[demo.kinboard.app](https://demo.kinboard.app)** (auto-updated via Diun + the self-update webhook; data resets daily). The project is single-maintainer and developed in personal time; expect periodic activity rather than a Big Co cadence. See the [`CHANGELOG`](CHANGELOG.md) for what's in each release and the [`RELEASE`](RELEASE.md) doc for how releases are cut.

**Security model:** designed for a trusted home network. Do not expose Kinboard directly to the public internet without putting a reverse proxy and authentication layer in front of it. See [Security & threat model](https://github.com/svenger87/kinboard/wiki/Security-and-Threat-Model) and [`SECURITY.md`](SECURITY.md).

### Recently shipped
- [x] **Pocket Money plugin (Piggy)** (v1.1.0) — per-kid virtual pocket-money accounts with parent-configurable APR (daily accrual + daily commit), scheduled allowance (weekly / biweekly / every 4 weeks), multi-goal saving queue with image lookup + URL paste + upload, kid-proposed withdrawals routed through a parent-approval inbox, and an evolving kid-facing avatar (5 species × 8 stages, driven off `lifetime_saved_cents`). Forecast panel on `/settings/pocket-money` projects balance at 1 / 3 / 6 / 12 months at the current APR + allowance. Fifth registered SurfacePlugin alongside Vehicles + Energy + Cameras + Stonks. See [Pocket Money](https://github.com/svenger87/kinboard/wiki/Pocket-Money)
- [x] **End-to-end auto-update** (v1.1.0) — Diun + webhook overlay runs the full upgrade path (`git pull` → `setup.sh` → `docker compose pull` → `up -d` → conditional Kong + Diun reload) every time a new image lands on GHCR. Replaces the deprecated Watchtower overlay (archived upstream, missing the config-substitution step). See [Self-hosting → Auto-updates](https://github.com/svenger87/kinboard/wiki/Self-hosting#auto-updates)
- [x] **Drag-reorder for the bottom navigation** (v1.1.0) — per-device localStorage at `/settings/navigation`; kitchen kiosk, parent's phone, and kids' tablets each keep their own layout
- [x] **Stonks plugin** (v1.0.19) — track stocks, ETFs, crypto, indices, and forex pairs in a watchlist with proper TradingView candle charts (1d / 1w / 1m / 3m / 1y / max timeframes). Yahoo Finance is the v1 data driver — no API key required, covers every asset class through one source. Per-ticker detail page, rotating dashboard widget, server-side TTL cache (30s spot quotes, 5min charts) so kiosk auto-refresh doesn't rate-limit. Fourth registered SurfacePlugin alongside Vehicles + Energy + Cameras
- [x] **iCalendar (.ics) feed support** (v1.0.19) — read-only calendar feeds via shared `.ics` URLs. Covers iCloud Family Sharing, Google's "secret iCal address", and most CalDAV providers in one feature. Skips the Google Cloud OAuth setup entirely for read-only use. Manual "Sync now" button + 30-min cron with ETag conditional GETs and recurring-event expansion
- [x] **Energy + Cameras migrated onto the plugin contract** (v1.0.18 + v1.0.19) — both surfaces now ship as drivers under the same `SurfacePlugin` model that Vehicles introduced. Per-family enable/disable at `/settings/plugins`. The contract is now validated on four concrete surfaces (Vehicles, Energy, Cameras, Stonks)
- [x] **Calendar event reminders via web push** (v1.0.17) — family devices subscribed to push receive a notification N minutes before each event starts (configurable on `/settings/notifications`, default 30 min). All-day events are skipped. Idempotent scheduling — multiple cron ticks scanning the same window don't double-send
- [x] **Country-aware public holidays** (v1.0.16) — DE / US / UK / NL / FR. Per-family country picker on `/settings/language`; existing families default to DE so behaviour is unchanged
- [x] Pre-built multi-arch (amd64 + arm64) Docker images on `ghcr.io` — self-hosters skip the build step
- [x] CI on every PR — ESLint + i18n bundle parity + shellcheck — plus a full E2E smoke run that boots the docker stack with mock integrations and verifies the dashboard against Playwright
- [x] Public live demo at [demo.kinboard.app](https://demo.kinboard.app) with mock Home Assistant / Tesla / weather / cameras so visitors see the full UI without configuring real integrations
- [x] First-run setup wizard at `/setup/{people,homeassistant,weather,done}` — guides fresh self-hosters through onboarding instead of dropping them on an empty dashboard; dismissible "Finish setting up" banner on the dashboard until completed
- [x] Interactive `setup.sh` — prompts for the optional API keys most self-hosters need (OpenWeatherMap, Google Calendar OAuth, maintainer email) at first-run time, with `--non-interactive` and `--advanced` flags for automation and power users
- [x] Device recognition that survives browser/OS updates — fingerprint-history table so a Safari/Chrome bump doesn't strand the device on `/join` (v1.0.11)
- [x] **Vehicles surface + build-time plugin contract** (v1.0.12) — multi-car, multi-vendor `/vehicles` page. Tesla driver (native UI via Home Assistant Fleet) + Generic-EV driver (any car HA can talk to: VW We Connect, BMW Connected Drive, Polestar, Hyundai BlueLink, OBD2 dongles). First plugin under the `SurfacePlugin` contract. See [Plugin architecture](https://github.com/svenger87/kinboard/wiki/Plugin-Architecture), [Vehicles](https://github.com/svenger87/kinboard/wiki/Vehicles), and the [Plugin directory](https://github.com/svenger87/kinboard/wiki/Plugin-Directory)
- [x] **Image-baked migrations** (v1.0.12) — schema migrations are baked into the webapp Docker image and applied automatically on container start. Self-hoster updates (via the Diun overlay or any other path) pick up new schema without anyone running `start.sh migrate` from the host

### Up next (no fixed dates)
- [ ] Additional Stonks data drivers — paid sources like Polygon or Tiingo for users wanting higher-resolution intraday + cleaner symbol coverage than Yahoo's unofficial endpoints. The driver contract already leaves room; only API-key plumbing and a settings UI need to land
- [ ] News feed per ticker on the Stonks detail page — Yahoo already returns it via `quoteSummary`, just needs UI
- [ ] Per-ticker price alerts via the existing notification queue
- [ ] Drag-reorder for the Stonks watchlist (currently creation-order)
- [ ] Additional locales beyond EN + DE (community PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md#translations))

---

## Contributing

Bug reports, feature requests, translations, and code PRs all welcome. The full guide lives in [`CONTRIBUTING.md`](CONTRIBUTING.md) — it covers dev setup, code conventions, the changelog discipline, and the Conventional Commits format. For where to take questions vs. issues vs. discussions, see [`SUPPORT.md`](SUPPORT.md).

Quick orientation:

- **Bugs** — [open an issue](https://github.com/svenger87/kinboard/issues/new?template=bug_report.yml) with logs + the route that broke
- **Features** — open a [GitHub Discussion](https://github.com/svenger87/kinboard/discussions) before a substantial PR
- **Translations** — `webapp/messages/*.json` is the source of truth; PRs adding new locales (FR, ES, IT, NL…) gladly accepted
- **Plugins** — the plugin system isn't carved in stone yet; open a discussion to help shape it
- **Security** — see [`SECURITY.md`](SECURITY.md) — please don't file public issues for credential / data-access vulnerabilities

CI runs ESLint + i18n bundle parity + shell-syntax checks (`bash -n`) + migration-order lint on every PR, plus the Docker-stack E2E smoke run. The codebase deliberately doesn't run `next build` in CI to keep the dev-server experience predictable; production builds happen in the Docker image workflow.

---

## Support development

Kinboard is built and maintained on personal time. If it's useful to your family and you'd like to keep it healthy:

- **GitHub Sponsors** (recurring) → [github.com/sponsors/svenger87](https://github.com/sponsors/svenger87)
- **Buy Me a Coffee** (one-time tip) → [buymeacoffee.com/sven.7687](https://buymeacoffee.com/sven.7687)
- **Star the repo** — helps others find it
- **Contribute** — bug reports, plugins, translations all welcome
- **Re-run screenshots** — the capture suite is in [`docs/wiki/screenshots/`](docs/wiki/screenshots/) and runs end-to-end against an anonymized demo

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-svenger87-ea4aaa?logo=githubsponsors&logoColor=white&style=flat-square)](https://github.com/sponsors/svenger87)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-sven.7687-FFDD00?logo=buymeacoffee&logoColor=000&style=flat-square)](https://buymeacoffee.com/sven.7687)

---

## Acknowledgements

Kinboard stands on the shoulders of an incredible amount of open-source work:

- **[Supabase](https://supabase.com/)** — the entire self-hosted backend stack (Postgres, Realtime, GoTrue, PostgREST, Storage)
- **[Next.js](https://nextjs.org/)** + **[Vercel](https://vercel.com/)** — the application framework
- **[shadcn/ui](https://ui.shadcn.com/)** — the component primitives. UI quality starts here.
- **[Lucide](https://lucide.dev/)** — every icon in the app
- **[Framer Motion](https://www.framer.com/motion/)** — the smooth, deliberate transitions
- **[next-intl](https://next-intl.dev/)** — i18n done right for App Router
- **[Home Assistant](https://www.home-assistant.io/)** — the smart-home backbone Kinboard talks to
- **[Immich](https://immich.app/)** — the photo backend that powers the screensaver
- **[Bring!](https://www.getbring.com/)** — the shopping list app some of us still want on a phone
- **[go2rtc](https://github.com/AlexxIT/go2rtc)** — the camera streaming bridge
- **[OpenWeatherMap](https://openweathermap.org/)** — weather data
- **[Chefkoch.de](https://www.chefkoch.de/)** — recipe search source
- **[Faker](https://fakerjs.dev/)** — anonymized demo data for the screenshot toolchain
- **[Playwright](https://playwright.dev/)** — automated screenshot capture

For the specific kiosk hardware combination (display + mini-PC + frame), see [Reference build](https://github.com/svenger87/kinboard/wiki/Reference-Build).

---

## License

MIT — see [`LICENSE`](LICENSE).
