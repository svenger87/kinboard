<div align="center">

# Familyboard

**A self-hosted family dashboard for the kitchen wall.**
Calendar · weather · photos · shopping list · smart-home — one screen, every device, real-time sync.

[![License: MIT](https://img.shields.io/github/license/svenger87/familyboard?style=flat-square&color=blue)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/svenger87/familyboard/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/svenger87/familyboard/actions/workflows/ci.yml)
[![Docker image](https://img.shields.io/badge/ghcr.io-familyboard-blue?logo=docker&logoColor=white&style=flat-square)](https://github.com/svenger87/familyboard/pkgs/container/familyboard)
[![Release](https://img.shields.io/github/v/release/svenger87/familyboard?style=flat-square&include_prereleases)](https://github.com/svenger87/familyboard/releases)
[![Stars](https://img.shields.io/github/stars/svenger87/familyboard?style=flat-square&logo=github)](https://github.com/svenger87/familyboard/stargazers)
[![Issues](https://img.shields.io/github/issues/svenger87/familyboard?style=flat-square)](https://github.com/svenger87/familyboard/issues)

[![Sponsor](https://img.shields.io/badge/Sponsor-svenger87-ea4aaa?logo=githubsponsors&logoColor=white&style=flat-square)](https://github.com/sponsors/svenger87)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-sven.7687-FFDD00?logo=buymeacoffee&logoColor=000&style=flat-square)](https://buymeacoffee.com/sven.7687)

<br/>

<img src="docs/wiki/images/dashboard-portrait.png" alt="Familyboard dashboard — kitchen kiosk portrait view" width="420"/>

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

Family logistics are scattered across calendars, chat threads, sticky notes, and "did you check the shopping list?" Familyboard consolidates the daily-driver stuff into one always-on display, so the family knows what's happening without opening apps.

- **Self-hosted.** Your data stays on your hardware. No SaaS, no telemetry, no account gating.
- **Real-time.** Edit a shopping item on your phone, it appears on the kitchen wall in milliseconds (Supabase Realtime over WebSockets).
- **Offline-tolerant.** The shopping list works in the basement supermarket without signal — changes queue locally and replay when the device gets connectivity back.
- **Touch-friendly.** Designed for wall-mounted tablets first; mobile and desktop are first-class too.
- **Modular.** Pick the integrations you actually use; the rest stay invisible.

---

## Features

| Feature | Wiki page |
|---|---|
| **Dashboard** — clock, today strip, configurable widget grid | [Dashboard](docs/wiki/Dashboard.md) |
| **Calendar** — two-way Google Calendar sync, per-person colors, holidays, waste-pickup widgets | [Calendar](docs/wiki/Calendar.md) |
| **Shopping list** — built-in real-time list with **offline support** + dedicated standalone PWA, optional Bring! sync | [Shopping](docs/wiki/Shopping.md) |
| **Recipes & meal planning** — Chefkoch.de search + schema.org URL import, weekly meal board, recipe-driven shopping | [Recipes & meals](docs/wiki/Recipes-and-Meals.md) |
| **Tasks & todos** — per-person assignment, priorities, daily reminder push | [Tasks & todos](docs/wiki/Tasks-and-Todos.md) |
| **Notes** — quick shared sticky notes for the household | [Notes](docs/wiki/Notes.md) |
| **Birthdays** — year-ring viz, countdowns, gift-idea tracking | [Birthdays](docs/wiki/Birthdays.md) |
| **School schedule** — per-child timetable + auto pack list for tomorrow | [Schedule](docs/wiki/Schedule.md) |
| **Smart home** — Home Assistant entities, room tabs, floating-lights master control | [Smart home](docs/wiki/Smart-Home.md) |
| **Energy dashboard** — solar / battery / grid live flow + charts | [Smart home → Energy](docs/wiki/Smart-Home.md#energy) |
| **Cameras** — live WebRTC streams (via go2rtc) | [Cameras](docs/wiki/Integration-Cameras.md) |
| **Photo screensaver** — Immich monthly album or Unsplash fallback, presence-aware blanking | [Screensaver](docs/wiki/Screensaver.md) |
| **Weather** — current + hourly + radar (OpenWeatherMap) | [OpenWeatherMap](docs/wiki/Integration-OpenWeatherMap.md) |
| **Web push notifications** — shopping items, task assignments, daily todo digest. **PWA install** required on iOS. | [Notifications](docs/wiki/Notifications.md) |
| **Multi-device + multi-person** — devices join a family with a 6-char code, per-person color coding everywhere | [Family members](docs/wiki/Family-Members.md), [Devices](docs/wiki/Devices.md) |
| **Monthly themes** — colors shift through the year automatically | [Themes & locales](docs/wiki/Themes-and-Locales.md) |
| **i18n** — English + German, full UI parity | [Themes & locales](docs/wiki/Themes-and-Locales.md) |

The full wiki has a page for every feature plus integration setup, kiosk hardware reference build, security model, and database schema.

---

## Quick start

You need **Docker** (with Compose v2), ~2 GB free disk, and ~10 minutes. The bundled `docker-compose.yml` brings up the Next.js app, a self-hosted Supabase stack, and supporting services.

> **RAM**: the local Next.js build peaks around **4 GB**, plus another ~3-4 GB during type-check and static-page generation. On a 4 GB VM you'll need **≥ 8 GB total swap** to avoid OOM kills during build (`fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`). Or — recommended — skip the build entirely by using the pre-built image at [`docker-compose.image.yml`](webapp/docker/docker-compose.image.yml). That drops bring-up to ~30 sec and needs only ~512 MB at runtime.

If you don't have Docker yet:

```bash
curl -fsSL https://get.docker.com | sh
```

Then bring Familyboard up:

```bash
git clone https://github.com/svenger87/familyboard.git
cd familyboard
./setup.sh                # generate random secrets + Supabase JWT keys
cd webapp/docker
./start.sh up             # docker compose up -d
```

Open `http://<server-ip>:3001` (or `http://localhost:3001` if local), follow the setup wizard to create your first family, and start adding integrations from `/settings`.

> **Push notifications** require Node.js for VAPID key generation. If `node` isn't on PATH when `setup.sh` runs, push stays disabled (everything else works); install Node.js + re-run `./setup.sh --force` later to enable.

> Once published images are live (see [Status & roadmap](#status--roadmap)), self-hosters will be able to skip the local build by pointing their compose at `ghcr.io/svenger87/familyboard:latest`.

### Updating

`./start.sh up` reuses the cached image — fast for restarts but won't pick up new code. After pulling source updates, use:

```bash
git pull
cd webapp/docker
./start.sh restart    # rebuilds the webapp image + recreates webapp + cron
```

For production self-hosting (Traefik + custom domain + backups + updates), see [Self-hosting](docs/wiki/Self-hosting.md).

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

Niche integrations (Tesla Fleet, Zendure SolarFlow batteries, etc.) ship as opt-in plugins. A plugin authoring guide is in the works.

---

## Tech stack

- **[Next.js](https://nextjs.org/) 14** (App Router) + **[React](https://react.dev/) 18**
- **[shadcn/ui](https://ui.shadcn.com/)** + **[Tailwind CSS](https://tailwindcss.com/)** for UI
- **[TanStack Query](https://tanstack.com/query)** (server state) + **[Zustand](https://zustand-demo.pmnd.rs/)** (client state)
- **[Supabase](https://supabase.com/)** (Postgres + Realtime) — self-hosted
- **[next-intl](https://next-intl.dev/)** for i18n (EN + DE)
- **[Framer Motion](https://www.framer.com/motion/)** for transitions
- **Service worker + IndexedDB** for offline shopping
- **[Playwright](https://playwright.dev/)** for the screenshot capture suite

---

## Reference hardware build

Familyboard is hardware-agnostic — any HDMI display + any small PC works. For people who want a known-good combination, [Reference build](docs/wiki/Reference-Build.md) documents one ~€700 setup with a 27" capacitive touchscreen + a Mele Quieter 4C mini-PC + a custom oak frame, with a complete BOM, wiring, and what didn't work.

For software side of the kiosk install: [Windows 11 (Mele 4C)](docs/wiki/Kiosk-Windows-11-Mele-4C.md) walks through Edge `--kiosk` mode + the on-screen keyboard, and [Linux guidance](docs/wiki/Kiosk-Linux-Guidance.md) covers Cage / GNOME / X11 alternatives.

---

## Documentation

The wiki is the source of truth for everything beyond this README:

- **Getting started** — [Quick-start](docs/wiki/Quick-start.md), [Self-hosting](docs/wiki/Self-hosting.md), [Onboarding](docs/wiki/Onboarding.md)
- **Architecture** — [Architecture overview](docs/wiki/Architecture.md), [Database schema](docs/wiki/Database-Schema.md), [Security model](docs/wiki/Security-and-Threat-Model.md)
- **Built-in features** — [Dashboard](docs/wiki/Dashboard.md) · [Calendar](docs/wiki/Calendar.md) · [Shopping](docs/wiki/Shopping.md) · [Recipes & meals](docs/wiki/Recipes-and-Meals.md) · [Tasks](docs/wiki/Tasks-and-Todos.md) · [Notes](docs/wiki/Notes.md) · [Birthdays](docs/wiki/Birthdays.md) · [Schedule](docs/wiki/Schedule.md) · [Smart home](docs/wiki/Smart-Home.md) · [Screensaver](docs/wiki/Screensaver.md) · [Family members](docs/wiki/Family-Members.md) · [Devices](docs/wiki/Devices.md) · [Notifications](docs/wiki/Notifications.md) · [Themes & locales](docs/wiki/Themes-and-Locales.md)
- **Integrations** — [Google Calendar](docs/wiki/Integration-Google-Calendar.md) · [Home Assistant](docs/wiki/Integration-Home-Assistant.md) · [Immich](docs/wiki/Integration-Immich.md) · [Bring!](docs/wiki/Integration-Bring.md) · [OpenWeatherMap](docs/wiki/Integration-OpenWeatherMap.md) · [Cameras](docs/wiki/Integration-Cameras.md)
- **Hardware** — [Reference build (BOM + frame)](docs/wiki/Reference-Build.md) · [Windows kiosk](docs/wiki/Kiosk-Windows-11-Mele-4C.md) · [Linux guidance](docs/wiki/Kiosk-Linux-Guidance.md) · [LD2410 presence sensor](docs/wiki/Presence-Sensor.md)
- **[Troubleshooting](docs/wiki/Troubleshooting.md)** — known issues + fixes

---

## Status & roadmap

This project is in active development as it's being prepared for its first public release. Expect rough edges.

**Security model:** designed for a trusted home network. Do not expose Familyboard directly to the public internet without putting a reverse proxy and authentication layer in front of it. See [Security & threat model](docs/wiki/Security-and-Threat-Model.md).

Near-term roadmap:

- [ ] Pre-built multi-arch (amd64 + arm64) Docker images on `ghcr.io` so self-hosters skip the build step
- [ ] CI on PRs (lint + typecheck)
- [ ] First tagged release (v1.0.0)
- [ ] Plugin authoring guide + extracted Tesla / Zendure plugins
- [ ] Country-aware holiday support (currently DE only)
- [ ] Calendar event reminders via web push
- [ ] iCalendar (.ics) feed support beyond Google Calendar

---

## Contributing

Bug reports, feature requests, and PRs all welcome. A formal `CONTRIBUTING.md` lands with the first tagged release; in the meantime:

1. **Bugs** — open an issue with [the bug template](.github/ISSUE_TEMPLATE/bug_report.md), include logs + the route that broke
2. **Features** — open a discussion before a PR if it's substantial
3. **Translations** — `webapp/messages/*.json` is the source of truth; PRs adding new locales (FR, ES, IT, NL…) gladly accepted
4. **Plugins** — wait for the plugin authoring guide (see roadmap), or open a discussion to influence its design

The codebase passes `npm run lint` cleanly. Per `CLAUDE.md` we don't run `next build` against the dev server, so CI will lint-only.

---

## Support development

Familyboard is built and maintained on personal time. If it's useful to your family and you'd like to keep it healthy:

- **GitHub Sponsors** (recurring) → [github.com/sponsors/svenger87](https://github.com/sponsors/svenger87)
- **Buy Me a Coffee** (one-time tip) → [buymeacoffee.com/sven.7687](https://buymeacoffee.com/sven.7687)
- **Star the repo** — helps others find it
- **Contribute** — bug reports, plugins, translations all welcome
- **Re-run screenshots** — the capture suite is in [`docs/wiki/screenshots/`](docs/wiki/screenshots/) and runs end-to-end against an anonymized demo

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-svenger87-ea4aaa?logo=githubsponsors&logoColor=white&style=flat-square)](https://github.com/sponsors/svenger87)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-sven.7687-FFDD00?logo=buymeacoffee&logoColor=000&style=flat-square)](https://buymeacoffee.com/sven.7687)

---

## Acknowledgements

Familyboard stands on the shoulders of an incredible amount of open-source work:

- **[Supabase](https://supabase.com/)** — the entire self-hosted backend stack (Postgres, Realtime, GoTrue, PostgREST, Storage)
- **[Next.js](https://nextjs.org/)** + **[Vercel](https://vercel.com/)** — the application framework
- **[shadcn/ui](https://ui.shadcn.com/)** — the component primitives. UI quality starts here.
- **[Lucide](https://lucide.dev/)** — every icon in the app
- **[Framer Motion](https://www.framer.com/motion/)** — the smooth, deliberate transitions
- **[next-intl](https://next-intl.dev/)** — i18n done right for App Router
- **[Home Assistant](https://www.home-assistant.io/)** — the smart-home backbone Familyboard talks to
- **[Immich](https://immich.app/)** — the photo backend that powers the screensaver
- **[Bring!](https://www.getbring.com/)** — the shopping list app some of us still want on a phone
- **[go2rtc](https://github.com/AlexxIT/go2rtc)** — the camera streaming bridge
- **[OpenWeatherMap](https://openweathermap.org/)** — weather data
- **[Chefkoch.de](https://www.chefkoch.de/)** — recipe search source
- **[Faker](https://fakerjs.dev/)** — anonymized demo data for the screenshot toolchain
- **[Playwright](https://playwright.dev/)** — automated screenshot capture

For the specific kiosk hardware combination (display + mini-PC + frame), see [Reference build](docs/wiki/Reference-Build.md).

---

## License

MIT — see [`LICENSE`](LICENSE).
