<img src="images/kinboard-banner.png" alt="Kinboard" width="600"/>

> A self-hosted family dashboard for the kitchen wall. Calendar, weather, photos, shopping list, smart-home — one screen, every device, real-time sync.

![Kinboard dashboard — kitchen-kiosk portrait view](images/dashboard-portrait.png)

Kinboard runs on your hardware, in your house. No cloud account, no telemetry, no subscription. The kitchen-wall display, your phone, the kids' tablets — they all show the same family state, kept in sync by a self-hosted Supabase Realtime backend.

## Start here

1. **[Quick-start](Quick-start)** — bring up the stack with one Docker command, create your first family, add devices
2. **[Self-hosting](Self-hosting)** — deeper deployment guide (Traefik, override files, backups)

## Pick the integrations you actually use

Kinboard's integrations are all opt-in and configured per-family in the in-app `/settings` UI — see the [README's integrations table](https://github.com/svenger87/kinboard#integrations) for the full list, or jump straight to a page: [Google-Calendar](Google-Calendar), [Home-Assistant](Home-Assistant), [Immich](Immich), [Bring](Bring), [OpenWeatherMap](OpenWeatherMap), [Cameras](Cameras).

## Kiosk setups

The reference deployment is a wall-mounted touchscreen running in browser kiosk mode:

- **[Reference-Build](Reference-Build)** — full hardware BOM (touchscreen, mini PC, oak frame), vendor links, photos, assembly notes
- **[Kiosk-Windows-11-Mele-4C](Kiosk-Windows-11-Mele-4C)** — software setup on top of the reference hardware, captured down to the registry keys and scheduled-task definitions
- **[Kiosk-Linux-Guidance](Kiosk-Linux-Guidance)** — guidance for self-hosters who want to run on Linux
- **[Presence-Sensor](Presence-Sensor)** — optional LD2410 radar presence sensor for screen-on/off automation

## Ops

- **[Security-and-Threat-Model](Security-and-Threat-Model)** — what Kinboard expects of your network and what it doesn't
- **[Architecture](Architecture#database-schema)** — tables, why RLS is off, migration story
- **[Notifications](Notifications)** — web push setup, server-side cron, quiet hours
- **[Themes](Themes)** — monthly themes, EN/DE/FR
- **[Troubleshooting](Troubleshooting)** — common breakages and fixes

## Status

Kinboard is single-maintainer, MIT-licensed, and supported on best-effort. Bug reports and PRs welcome — see [`CONTRIBUTING.md`](https://github.com/svenger87/kinboard/blob/main/CONTRIBUTING.md). Security issues to **security@kinboard.app** (see [Security-and-Threat-Model](Security-and-Threat-Model)).

If Kinboard is useful to your family and you'd like to help keep it healthy: [GitHub Sponsors](https://github.com/sponsors/svenger87) (recurring) or [Buy Me a Coffee](https://buymeacoffee.com/sven.7687) (one-time tip).
