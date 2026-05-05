# Wiki source

This directory holds the Markdown sources for the project's GitHub Wiki. They live in the main repo (rather than the wiki's own git repo) so they're versioned, reviewed, and PR-able alongside the code.

## Conventions

- One Markdown file per wiki page. Filenames become URL slugs.
- GitHub wikis are **flat** — no subdirectories. Use prefix-style names instead (`Integration-Google-Calendar.md`, `Kiosk-Windows-11-Mele-4C.md`).
- `_Sidebar.md` and `_Footer.md` render on every wiki page.
- `Home.md` is the landing page.
- Internal links use the `[[Page-Name]]` shorthand on GitHub wikis. In this repo they render as broken links (deliberate — viewing the wiki on GitHub is the canonical view).
- Images live in `docs/wiki/images/` and are copied across when publishing.

## Publishing

GitHub creates a sibling git repo for the wiki at `https://github.com/<owner>/<repo>.wiki.git`. To publish:

```bash
# One-time clone of the wiki repo
git clone https://github.com/svenger87/kinboard.wiki.git /tmp/wiki

# Sync from this directory
cp docs/wiki/*.md /tmp/wiki/
mkdir -p /tmp/wiki/images
cp -r docs/wiki/images/* /tmp/wiki/images/ 2>/dev/null || true

# Commit + push
cd /tmp/wiki
git add -A
git commit -m "Sync from main repo"
git push
```

A small `docs/wiki/sync.sh` script can be added later to make this a one-liner.

## Page index

| Page | Status |
|---|---|
| [Home](Home.md) | Authored |
| [Quick-start](Quick-start.md) | Authored |
| [Architecture](Architecture.md) | Authored |
| [Self-hosting](Self-hosting.md) | Authored |
| [Onboarding](Onboarding.md) | Authored |
| [Security-and-Threat-Model](Security-and-Threat-Model.md) | Authored |
| [Database-Schema](Database-Schema.md) | Authored |
| [Integration-Google-Calendar](Integration-Google-Calendar.md) | Authored — TODO screenshots |
| [Integration-Home-Assistant](Integration-Home-Assistant.md) | Authored — TODO screenshots |
| [Integration-Immich](Integration-Immich.md) | Authored — TODO screenshots |
| [Integration-Bring](Integration-Bring.md) | Authored — TODO screenshots |
| [Integration-OpenWeatherMap](Integration-OpenWeatherMap.md) | Authored |
| [Integration-Cameras](Integration-Cameras.md) | Authored |
| [Reference-Build](Reference-Build.md) | Authored — BOM, frame, photos, vendor links |
| [Kiosk-Windows-11-Mele-4C](Kiosk-Windows-11-Mele-4C.md) | Authored from production capture |
| [Kiosk-Linux-Guidance](Kiosk-Linux-Guidance.md) | Authored as guidance |
| [Presence-Sensor](Presence-Sensor.md) | Authored |
| [Notifications](Notifications.md) | Authored — PWA install + iOS quirks |
| [Themes-and-Locales](Themes-and-Locales.md) | Authored |
| [Troubleshooting](Troubleshooting.md) | Authored — grow as bugs surface |
| [Plugin-Authoring](Plugin-Authoring.md) | Stub — v1.1 workstream |
| [Dashboard](Dashboard.md) | Authored — TODO screenshots |
| [Calendar](Calendar.md) | Authored — two-way Google sync — TODO screenshots |
| [Shopping](Shopping.md) | Authored — built-in offline + optional Bring — TODO screenshots |
| [Recipes-and-Meals](Recipes-and-Meals.md) | Authored — Chefkoch + schema.org URL import — TODO screenshots |
| [Tasks-and-Todos](Tasks-and-Todos.md) | Authored — TODO screenshots |
| [Notes](Notes.md) | Authored — TODO screenshots |
| [Birthdays](Birthdays.md) | Authored — TODO screenshots |
| [Schedule](Schedule.md) | Authored — TODO screenshots |
| [Smart-Home](Smart-Home.md) | Authored — TODO screenshots |
| [Screensaver](Screensaver.md) | Authored — TODO screenshots |
| [Family-Members](Family-Members.md) | Authored — TODO screenshots |
| [Devices](Devices.md) | Authored — TODO screenshots |
| [Screenshots-needed](Screenshots-needed.md) | Master list of every TODO screenshot |
