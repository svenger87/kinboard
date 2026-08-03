# Wiki source

This directory holds the Markdown sources for the project's GitHub Wiki. They live in the main repo (rather than the wiki's own git repo) so they're versioned, reviewed, and PR-able alongside the code.

## Conventions

- One Markdown file per wiki page. Filenames become URL slugs.
- GitHub wikis are **flat** — no subdirectories. Use prefix-style names instead (`Google-Calendar.md`, `Kiosk-Windows-11-Mele-4C.md`).
- `_Sidebar.md` and `_Footer.md` render on every wiki page.
- `Home.md` is the landing page.
- Internal links must be **extensionless**: `[Quick start](Quick-start)`, NOT `(Quick-start.md)`. On a GitHub wiki the `.md` suffix makes GitHub serve the raw file (`raw.githubusercontent.com/wiki/...`) instead of the rendered page, so `.md` links are broken navigation. (In-repo these extensionless links don't resolve — the rendered wiki is the canonical view.)
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
| [Home](Home) | Authored |
| [Quick-start](Quick-start) | Authored — absorbed Onboarding |
| [Architecture](Architecture) | Authored — absorbed Database-Schema |
| [Self-hosting](Self-hosting) | Authored |
| [Onboarding](Onboarding) | Merged into Quick-start |
| [Security-and-Threat-Model](Security-and-Threat-Model) | Authored |
| [Device-Recognition](Device-Recognition) | Merged into Security-and-Threat-Model |
| [Database-Schema](Database-Schema) | Merged into Architecture |
| [Google-Calendar](Google-Calendar) | Authored — TODO screenshots |
| [CalDAV](CalDAV) | Authored — two-way sync, provider URLs, troubleshooting |
| [Home-Assistant](Home-Assistant) | Authored — TODO screenshots |
| [Immich](Immich) | Authored — TODO screenshots |
| [Bring](Bring) | Authored — TODO screenshots |
| [OpenWeatherMap](OpenWeatherMap) | Authored |
| [Cameras](Cameras) | Authored |
| [Reference-Build](Reference-Build) | Authored — BOM, frame, photos, vendor links |
| [Kiosk-Windows-11-Mele-4C](Kiosk-Windows-11-Mele-4C) | Authored from production capture |
| [Kiosk-Linux-Guidance](Kiosk-Linux-Guidance) | Authored as guidance |
| [Presence-Sensor](Presence-Sensor) | Authored |
| [Notifications](Notifications) | Authored — PWA install + iOS quirks |
| [Themes](Themes) | Authored |
| [Troubleshooting](Troubleshooting) | Authored — grow as bugs surface |
| [Plugin-Development](Plugin-Development) | Authored — absorbed Plugin-Architecture + Plugin-Authoring |
| [Plugin-Authoring](Plugin-Authoring) | Merged into Plugin-Development |
| [Plugin-Architecture](Plugin-Architecture) | Merged into Plugin-Development |
| [Dashboard](Dashboard) | Authored — TODO screenshots |
| [Calendar](Calendar) | Authored — two-way Google + CalDAV sync — TODO screenshots |
| [Shopping](Shopping) | Authored — built-in offline + optional Bring — TODO screenshots |
| [Recipes](Recipes) | Authored — Chefkoch + schema.org URL import — TODO screenshots |
| [Tasks](Tasks) | Authored — TODO screenshots |
| [Notes](Notes) | Authored — TODO screenshots |
| [Birthdays](Birthdays) | Authored — TODO screenshots |
| [Schedule](Schedule) | Authored — TODO screenshots |
| [Smart-Home](Smart-Home) | Authored — TODO screenshots |
| [Screensaver](Screensaver) | Authored — TODO screenshots |
| [People-and-Devices](People-and-Devices) | Authored — absorbed Family-Members + Devices |
| [Family-Members](Family-Members) | Merged into People-and-Devices |
| [Devices](Devices) | Merged into People-and-Devices |
