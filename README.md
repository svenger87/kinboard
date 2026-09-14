<div align="center">

<img src="assets/logos/kinboard-banner.png" alt="Kinboard" width="600"/>

### Your family's day, on one screen

Calendar, weather, meals, shopping, tasks, photos, and your smart home in a
self-hosted dashboard built for the kitchen wall and every phone in the house.

[![License: MIT](https://img.shields.io/github/license/svenger87/kinboard?style=flat-square&color=blue&cacheSeconds=300)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/svenger87/kinboard/ci.yml?branch=main&style=flat-square&label=CI&cacheSeconds=300)](https://github.com/svenger87/kinboard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/svenger87/kinboard?style=flat-square&include_prereleases&cacheSeconds=300)](https://github.com/svenger87/kinboard/releases)

[Website](https://kinboard.app) · [Live demo](https://demo.kinboard.app) ·
[Documentation](https://github.com/svenger87/kinboard/wiki) ·
[Community](https://github.com/svenger87/kinboard/discussions)

<br/>

<img src="docs/wiki/images/dashboard-portrait.png" alt="Kinboard dashboard — kitchen kiosk portrait view" width="420"/>

<sub>Built for an always-on touchscreen. Works on phones, tablets, and desktop browsers too.</sub>

</div>

---

## Install

Kinboard needs Linux, Git, OpenSSL, and Docker with Compose v2. The installer
downloads the current configuration, generates unique local secrets, walks you
through the public URL and optional integrations, and starts the stable
multi-architecture image:

```bash
curl -fsSL https://raw.githubusercontent.com/svenger87/kinboard/main/install.sh | bash
```

The default location is `./kinboard`. Pass `KINBOARD_DIR` to choose another
path, or `KINBOARD_URL` for a headless install:

```bash
curl -fsSL https://raw.githubusercontent.com/svenger87/kinboard/main/install.sh | KINBOARD_DIR="$HOME/kinboard" KINBOARD_URL=http://192.168.1.50:8100 bash
```

Open the URL printed at the end and create your family. The first device receives
a six-character join code for the other phones, tablets, and wall displays.
Optional services are configured later in **Settings → Integrations**.

The installer will never modify an existing `kinboard` directory. Existing
installations keep their `.env`, secrets, data, compose overlays, and current
upgrade path.

### Update an existing installation

From its checkout:

```bash
git pull --ff-only
./setup.sh --non-interactive
cd webapp/docker
./start.sh up
```

That is the image-based path used by the one-line installer. If your existing
installation intentionally builds a modified webapp from source, keep using
`COMPOSE_FILES="-f docker-compose.yml" ./start.sh restart`; the installer does
not change that checkout or its configuration.

**Trying a release candidate** — set `KINBOARD_TAG=next` in `webapp/docker/.env` and bring the stack up again. That follows the pre-release channel; remove the line (or set `latest`) to go back to stable. Release candidates are announced on the [Releases](https://github.com/svenger87/kinboard/releases) page and are where feedback is most useful. See [Self-hosting → Pre-release channel](https://github.com/svenger87/kinboard/wiki/Self-hosting#pre-release-channel).

**Hands-off auto-update** — an optional Diun + webhook overlay watches GHCR for new `kinboard-webapp` images and runs the full upgrade path (pull, migrate, restart) automatically when one lands. Replaces the deprecated Watchtower overlay. See [Self-hosting → Auto-updates](https://github.com/svenger87/kinboard/wiki/Self-hosting#auto-updates) for setup.

For production self-hosting (Traefik + custom domain + backups + updates), see [Self-hosting](https://github.com/svenger87/kinboard/wiki/Self-hosting).

---

## What you get

- A shared dashboard for calendars, weather, meals, tasks, notes, birthdays,
  school schedules, shopping, and photos.
- Real-time updates across the wall display and every family device, with an
  offline-capable shopping list for poor mobile coverage.
- Optional Home Assistant, Google Calendar, CalDAV, Immich, DLNA, iCloud,
  OpenWeatherMap, Bring!, and camera integrations.
- Local data in a bundled Supabase stack, with backups and no hosted account or
  telemetry.
- Touch-first layouts, installable PWAs, English, German, and French.

[Explore every feature in the wiki](https://github.com/svenger87/kinboard/wiki).

---

## Screenshots

A few highlights from the [demo data set](docs/wiki/screenshots/). See the [wiki](docs/wiki/) for the per-feature pages.

> These were captured before the 1.7.0 interface work (larger type and navigation for wall displays, opaque dialogs, themed device colours). They still show the app faithfully, but the current build looks a little different — [the live demo](https://demo.kinboard.app) is always the newest thing.

### On your phone

The wall display is the point, but you're not always in front of it. The whole app is responsive and installs as a PWA, so the shopping list you edit in the supermarket is on the kitchen wall before you get home, and push notifications reach you when you're out.

<table>
  <tr>
    <td align="center"><a href="docs/wiki/images/mobile/shopping-list-mixed.png"><img src="docs/wiki/images/mobile/shopping-list-mixed.png" alt="Shopping list on a phone" width="200"/></a><br/><sub><b>Shopping list</b><br/>Add with your thumb,<br/>tick off in the aisle</sub></td>
    <td align="center"><a href="docs/wiki/images/mobile/settings-notifications.png"><img src="docs/wiki/images/mobile/settings-notifications.png" alt="Notification settings on a phone" width="200"/></a><br/><sub><b>Notifications</b><br/>Per device, so the<br/>wall stays quiet</sub></td>
    <td align="center"><a href="docs/wiki/images/mobile/calendar-month-view.png"><img src="docs/wiki/images/mobile/calendar-month-view.png" alt="Calendar on a phone" width="200"/></a><br/><sub><b>Calendar</b><br/>Same data, laid out<br/>for a thumb</sub></td>
    <td align="center"><a href="docs/wiki/images/mobile/dashboard-portrait.png"><img src="docs/wiki/images/mobile/dashboard-portrait.png" alt="Dashboard on a phone" width="200"/></a><br/><sub><b>Dashboard</b><br/>The same board,<br/>pocket-sized</sub></td>
  </tr>
</table>

### On the wall

<table>
  <tr>
    <td align="center"><a href="docs/wiki/images/shopping-list-mixed.png"><img src="docs/wiki/images/shopping-list-mixed.png" alt="Shopping" width="280"/></a><br/><sub>Shopping</sub></td>
    <td align="center"><a href="docs/wiki/images/calendar-month-view.png"><img src="docs/wiki/images/calendar-month-view.png" alt="Calendar" width="280"/></a><br/><sub>Calendar</sub></td>
    <td align="center"><a href="docs/wiki/images/home-automation-rooms.png"><img src="docs/wiki/images/home-automation-rooms.png" alt="Home automation" width="280"/></a><br/><sub>Home automation</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/wiki/images/energy-flow-diagram.png"><img src="docs/wiki/images/energy-flow-diagram.png" alt="Energy" width="280"/></a><br/><sub>Energy dashboard</sub></td>
    <td align="center"><a href="docs/wiki/images/birthdays-year-ring.png"><img src="docs/wiki/images/birthdays-year-ring.png" alt="Birthdays" width="280"/></a><br/><sub>Birthdays</sub></td>
    <td align="center"><a href="docs/wiki/images/recipes-library.png"><img src="docs/wiki/images/recipes-library.png" alt="Recipes" width="280"/></a><br/><sub>Recipes</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/wiki/images/meals-week-board.png"><img src="docs/wiki/images/meals-week-board.png" alt="Meal planning" width="280"/></a><br/><sub>Meal planning</sub></td>
    <td align="center"><a href="docs/wiki/images/schedule-week-grid.png"><img src="docs/wiki/images/schedule-week-grid.png" alt="School schedule" width="280"/></a><br/><sub>School schedule</sub></td>
    <td align="center"><a href="docs/wiki/images/todos-overview.png"><img src="docs/wiki/images/todos-overview.png" alt="Todos" width="280"/></a><br/><sub>Tasks & todos</sub></td>
  </tr>
</table>

Every screenshot has a light-mode variant with a `-light` suffix, and the phone-viewport captures live in [`docs/wiki/images/mobile/`](docs/wiki/images/mobile/). The full toolchain that produces them — local docker stack with anonymized prod data + mock HA / Tesla / OpenWeatherMap servers + Playwright capture — lives in [`docs/wiki/screenshots/`](docs/wiki/screenshots/).

---

## Integrations

| Service | Purpose | Required? |
| --- | --- | --- |
| Supabase (self-hosted) | Database + realtime sync | Yes (bundled) |
| OpenWeatherMap | Weather forecasts + radar | Optional, free tier OK |
| Google Calendar | Two-way calendar sync | Optional |
| CalDAV (Nextcloud, Radicale, Fastmail, iCloud, …) | Two-way calendar sync without Google | Optional |
| Immich | Photos: screensaver, album viewer and dashboard widget | Optional |
| DLNA media server (MiniDLNA, Jellyfin, Plex, Synology, QNAP) | The same photos off a NAS you already run — no account, no API key | Optional |
| iCloud Shared Album | The same, from a public album link on an iPhone — no Apple ID | Optional |
| Unsplash | Curated stock photos for the screensaver when you have no library of your own | Optional, free tier OK |
| Home Assistant | Smart-home entities and energy — **and, since 1.9.0, [the other way round](https://github.com/svenger87/kinboard-homeassistant): Kinboard's calendar, lists and family state as Home Assistant entities** | Optional |
| Bring! | Shopping list sync (built-in list works without it) | Optional |
| go2rtc | WebRTC camera streams | Optional |

### Kinboard *in* Home Assistant

Most dashboards read Home Assistant. Kinboard also **feeds it** — the family's
day becomes entities you can automate on, in an installation that already runs
your house.

Install from HACS as a custom repository
([svenger87/kinboard-homeassistant](https://github.com/svenger87/kinboard-homeassistant)),
paste a token from **Settings → Integrations**, and you get:

| | |
|---|---|
| **20 entities** | next appointment (with the person's name and start time), what's on today, whose birthday is next, which children have school tomorrow, what's for dinner, open and overdue tasks, pocket money per child, saving-goal progress, and **the next bin collection** |
| **Two real to-do lists** | shopping and tasks as `todo` entities — tick one in Home Assistant and it ticks in Kinboard, add one in Kinboard and it appears there. The To-do card, voice assistants and `todo.*` services all work with no glue |
| **A calendar** | `calendar.kinboard_family_calendar`, including events that merely overlap the day you're looking at |
| **Services** | add a shopping item, create a task, write a note, credit pocket money, dismiss a hint, force a refresh |
| **Events** | a task ticked, a shopping item added, an appointment created, a device joined, a saving goal reached, the day's context changing |

The events come from **database triggers**, not the API layer — so a task ticked
on the kitchen tablet fires one exactly as an automation does. Delivery is
resumable: a restart of either system loses nothing.

```yaml
# The night before: tell everyone what tomorrow's lessons need.
- alias: "Pack the school bag"
  triggers:
    - trigger: time
      at: "19:30:00"
  conditions:
    - condition: template
      value_template: "{{ states('sensor.kinboard_school_tomorrow') not in ['unknown','unavailable',''] }}"
  actions:
    - action: notify.notify
      data:
        message: >-
          {{ states('sensor.kinboard_school_tomorrow') }} has school tomorrow —
          first lesson {{ state_attr('sensor.kinboard_school_tomorrow','first_lesson') }}.
```

Eleven more, ready to paste, in
[`examples/`](https://github.com/svenger87/kinboard-homeassistant/tree/main/examples) —
each one loaded into a real Home Assistant by CI on every run, with every
entity, service and event checked against the integration, so an example cannot
quietly rot.

Permissions are per-token and nothing is implied: a token that may add shopping
items cannot create tasks, and a read-only token cannot write at all.


Niche integrations (Tesla Fleet, Zendure SolarFlow batteries, etc.) ship as opt-in plugins. See the [Plugin development guide](https://github.com/svenger87/kinboard/wiki/Plugin-Development) to write your own.

---

## Tech stack

- **[Next.js](https://nextjs.org/) 16** (App Router) + **[React](https://react.dev/) 19**
- **[shadcn/ui](https://ui.shadcn.com/)** + **[Tailwind CSS](https://tailwindcss.com/)** for UI
- **[TanStack Query](https://tanstack.com/query)** (server state) + **[Zustand](https://zustand-demo.pmnd.rs/)** (client state)
- **[Supabase](https://supabase.com/)** (Postgres + Realtime) — self-hosted
- **[next-intl](https://next-intl.dev/)** for i18n (EN/DE/FR)
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

- **Getting started** — [Quick-start](https://github.com/svenger87/kinboard/wiki/Quick-start), [Self-hosting](https://github.com/svenger87/kinboard/wiki/Self-hosting)
- **Architecture** — [Architecture overview](https://github.com/svenger87/kinboard/wiki/Architecture), [Security model](https://github.com/svenger87/kinboard/wiki/Security-and-Threat-Model)
- **Built-in features** — [Dashboard](https://github.com/svenger87/kinboard/wiki/Dashboard) · [Calendar](https://github.com/svenger87/kinboard/wiki/Calendar) · [Shopping](https://github.com/svenger87/kinboard/wiki/Shopping) · [Recipes & meals](https://github.com/svenger87/kinboard/wiki/Recipes) · [Tasks](https://github.com/svenger87/kinboard/wiki/Tasks) · [Notes](https://github.com/svenger87/kinboard/wiki/Notes) · [Messages](https://github.com/svenger87/kinboard/wiki/Messages) · [Timers](https://github.com/svenger87/kinboard/wiki/Timers) · [Media players](https://github.com/svenger87/kinboard/wiki/Media-Players) · [Birthdays](https://github.com/svenger87/kinboard/wiki/Birthdays) · [Schedule](https://github.com/svenger87/kinboard/wiki/Schedule) · [Smart home](https://github.com/svenger87/kinboard/wiki/Smart-Home) · [Screensaver](https://github.com/svenger87/kinboard/wiki/Screensaver) · [People & devices](https://github.com/svenger87/kinboard/wiki/People-and-Devices) · [Notifications](https://github.com/svenger87/kinboard/wiki/Notifications) · [Themes & locales](https://github.com/svenger87/kinboard/wiki/Themes)
- **Integrations** — [Google Calendar](https://github.com/svenger87/kinboard/wiki/Google-Calendar) · [CalDAV](https://github.com/svenger87/kinboard/wiki/CalDAV) · [Home Assistant](https://github.com/svenger87/kinboard/wiki/Home-Assistant) · [Immich](https://github.com/svenger87/kinboard/wiki/Immich) · [Bring!](https://github.com/svenger87/kinboard/wiki/Bring) · [OpenWeatherMap](https://github.com/svenger87/kinboard/wiki/OpenWeatherMap) · [Cameras](https://github.com/svenger87/kinboard/wiki/Cameras)
- **Hardware** — [Reference build (BOM + frame)](https://github.com/svenger87/kinboard/wiki/Reference-Build) · [Windows kiosk](https://github.com/svenger87/kinboard/wiki/Kiosk-Windows-11-Mele-4C) · [Linux guidance](https://github.com/svenger87/kinboard/wiki/Kiosk-Linux-Guidance) · [LD2410 presence sensor](https://github.com/svenger87/kinboard/wiki/Presence-Sensor)
- **Extending Kinboard** — [Vehicles](https://github.com/svenger87/kinboard/wiki/Vehicles) · [Stonks](https://github.com/svenger87/kinboard/wiki/Stonks) · [Pocket Money](https://github.com/svenger87/kinboard/wiki/Pocket-Money) · [Plugin development](https://github.com/svenger87/kinboard/wiki/Plugin-Development) · [Plugin directory](https://github.com/svenger87/kinboard/wiki/Plugin-Directory)
- **[Troubleshooting](https://github.com/svenger87/kinboard/wiki/Troubleshooting)** — known issues + fixes

---

## Project status

Kinboard is actively developed by one maintainer. See the
[release history](https://github.com/svenger87/kinboard/releases) for shipped
versions and [`CHANGELOG.md`](CHANGELOG.md) for the next release. The
[live demo](https://demo.kinboard.app) follows the release channel and resets
its sample data hourly.

Kinboard is designed for a trusted home network. Use a reverse proxy with
authentication before exposing it to the internet. Read the
[security model](https://github.com/svenger87/kinboard/wiki/Security-and-Threat-Model)
and [`SECURITY.md`](SECURITY.md) before a public deployment.

---

## Contributing

Bug reports, feature requests, translations, and code PRs all welcome. The full guide lives in [`CONTRIBUTING.md`](CONTRIBUTING.md) — it covers dev setup, code conventions, the changelog discipline, and the Conventional Commits format. For where to take questions vs. issues vs. discussions, see [`SUPPORT.md`](SUPPORT.md).

Quick orientation:

- **Bugs** — [open an issue](https://github.com/svenger87/kinboard/issues/new?template=bug_report.yml) with logs + the route that broke
- **Features** — open a [GitHub Discussion](https://github.com/svenger87/kinboard/discussions) before a substantial PR
- **Translations** — `webapp/messages/*.json` is the source of truth; PRs adding new locales (FR, ES, IT, NL…) gladly accepted
- **Plugins** — the plugin system isn't carved in stone yet; open a discussion to help shape it
- **Security** — see [`SECURITY.md`](SECURITY.md) — please don't file public issues for credential / data-access vulnerabilities

CI runs ESLint + i18n bundle parity + shellcheck on every PR. The codebase deliberately doesn't run `next build` in CI to keep the dev-server experience predictable; production builds happen in the Docker image workflow.

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
