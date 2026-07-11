**Internal planning document — not user documentation.**

# Screenshots backlog

Master tracking list for wiki screenshot capture. Moved out of the public wiki (`docs/wiki/Screenshots-needed.md`) since it's a maintainer TODO list, not reference content for self-hosters.

> **Status (2026-05-07):** 14 of the original 35 markers are captured (40%). The [automated capture toolchain](../wiki/screenshots/) covers desktop landscape + mobile portrait × dark + light themes against an anonymized prod-data demo, so each captured surface comes in 4 variants. The list below tracks remaining markers — modals, settings sub-pages, mid-state shots, hardware photos that need a real device — plus the bonus surfaces the toolchain captured beyond the original list.

> **Format guidance** — capture at native panel resolution where possible (1920×1200 for the kiosk-style UI), PNG, drop into `docs/wiki/images/<page-slug>-<short-name>.png`, and embed with `![alt text](images/<file>.png)` on the source wiki page.

## Top-priority (these are the hero screenshots — pick 3-4 for the README + Home page)

- [x] **Dashboard at full screen** — `dashboard-portrait-full.png` (anonymized demo) + `kitchen-wall-mounted.jpg` (real kiosk in the kitchen). Light variant: `dashboard-portrait-full-light.png`
- [x] **/calendar month view** with multi-person events — `calendar-month-view.png` + light
- [x] **/home-automation room view** with entity cards — `home-automation-rooms.png` + light
- [x] **/energy live flow diagram** — `energy-flow-diagram.png` + light
- [ ] **Screensaver in action** — photo + clock overlay (still needs an in-action capture; the screensaver bypasses the deterministic capture script because it's idle-triggered)

## Per-page TODOs

### Dashboard
- [ ] dashboard-landscape.png — full landscape view on desktop or kiosk (we have portrait-full but not landscape)
- [x] dashboard-portrait.png — `dashboard-portrait.png` + light (also `dashboard-portrait-full.png` for the full-bleed variant)
- [ ] dashboard-family-members-row.png — close-up of avatar row

### Calendar
- [x] calendar-month-view.png — `calendar-month-view.png` + light
- [ ] calendar-week-view.png — week view with hourly grid
- [ ] calendar-day-detail-panel.png — tapping a day, side panel open
- [ ] calendar-mapping-rule-editor.png — settings → Google Calendar → mapping rules

### Shopping
- [x] shopping-list-mixed.png — `shopping-list-mixed.png` + light
- [ ] shopping-offline-banner.png — offline indicator banner showing
- [ ] shopping-quick-add-chips.png — top-of-page favorites chips
- [ ] shopping-bring-sync-indicator.png — sync status badge in header
- [ ] shopping-install-prompt.png — green install banner mid-page
- [ ] shopping-pwa-icon.png — phone home screen showing the green shopping-cart icon next to the Kinboard icon (both PWAs side-by-side)
- [x] shopping-pwa-launched.png — `shopping-pwa-mobile.PNG` (standalone-mode PWA on iOS)

### Recipes & meals
- [x] recipes-library.png — `recipes-library.png` + light
- [ ] recipes-detail.png — single recipe view
- [ ] recipes-chefkoch-search.png — `/recipes/search` Chefkoch import dialog
- [ ] recipes-url-import.png — paste-URL import dialog with a foreign recipe site
- [x] meals-week-board.png — `meals-week-board.png` + light
- [ ] meals-recipe-drag.png — mid-drag of a recipe tile onto a cell

### Tasks & todos
- [x] todos-overview.png — `todos-overview.png` + light
- [ ] todos-priority-badges.png — close-up of urgent / high / normal indicators

### Notes
- [x] notes-page.png — `notes-page.png` + light

### Birthdays
- [x] birthdays-year-ring.png — `birthdays-year-ring.png` + light
- [ ] birthdays-list-card.png — single upcoming-birthday card

### Schedule
- [x] schedule-week-grid.png — `schedule-week-grid.png` + light
- [ ] schedule-pack-list.png — pack list for tomorrow

### Smart home
- [x] home-automation-rooms.png — `home-automation-rooms.png` + light
- [ ] home-automation-cards.png — entity cards close-up (light, climate, cover); the rooms shot covers most but a card-detail crop would be nicer
- [ ] floating-lights-fab.png — the lights-everywhere modal
- [x] energy-flow-diagram.png — `energy-flow-diagram.png` + light
- [ ] energy-charts.png — line charts panel

### Cameras
- [x] cameras-grid.png — `cameras-grid.png` + light

### Screensaver
- [ ] screensaver-idle.png — photo + clock overlay
- [ ] screensaver-news-modal.png — expanded news article
- [ ] screensaver-energy-overlay.png — solar production widget on top

### Family members & devices
- [x] settings-people.png — `settings-people.png` + light
- [ ] settings-people-edit-dialog.png — adding/editing a person
- [x] settings-devices.png — `settings-devices.png` + light

### Notifications
- [x] settings-notifications.png — `settings-notifications.png` + light
- [ ] ios-add-to-home-screen.png — Safari Share menu mid-flow
- [ ] ios-pwa-installed.png — home-screen icon + standalone launch

### Settings (general — not per-page but useful)
- [x] settings-overview.png — `settings-overview.png` + light
- [x] settings-google.png — `settings-google.png` + light
- [x] settings-homeassistant.png — `settings-homeassistant.png` + light (also `settings-homeassistant-rooms.png` for the rooms editor)
- [x] settings-immich.png — captured as `settings-photos.png` + light (same surface; renamed in-app to "photos")
- [x] settings-bring.png — `settings-bring.png` + light

### Kiosk + reference build
- [x] kiosk-mounted-on-wall.png — `kitchen-wall-mounted.jpg` (front-facing photo of the kitchen install)
- [~] kiosk-frame-detail.png — `wooden-frame-back-top.jpg` (back-corner detail; would still benefit from a front-facing oak-corner close-up)
- [~] kiosk-cabling.png — `wooden-frame-back-side.jpg` (cable management visible from the back)

### Onboarding
- [ ] onboarding-setup-wizard.png — first-run `/setup` flow
- [ ] onboarding-join-code.png — join screen with 6-char code

## Captured beyond the original list

These weren't on the original markers list but the capture toolchain produced them too — useful to have for new wiki pages, README reshuffles, or per-feature deep-dives.

### Additional settings pages (all dark + light)
- `settings-cameras.png` — go2rtc + camera selector
- `settings-language.png` — EN/DE locale switcher
- `settings-news.png` — RSS feed manager
- `settings-schedule.png` — schedule editor
- `settings-screensaver.png` — screensaver feature toggles
- `settings-tesla.png` — Tesla integration setup
- `settings-theme.png` — monthly theme override
- `settings-weather.png` — OpenWeatherMap key + units
- `settings-widgets.png` — dashboard widget reordering

### Tesla
- `tesla-dashboard.png` + light — full Tesla page (no separate marker existed)
- `tesla-mobile.PNG` — phone-formatted Tesla card

### News
- `news-feed.png` + light — news widget feed view

### Mobile portrait variants (`docs/wiki/images/mobile/`)
12 main pages have a mobile-portrait variant in dark + light:
`birthdays-year-ring`, `calendar-month-view`, `cameras-grid`, `dashboard`, `energy-flow-diagram`, `home-automation-rooms`, `meals-week-board`, `notes-page`, `recipes-library`, `schedule-week-grid`, `shopping-list-mixed`, `todos-overview`. Each as `<name>.png` (dark) and `<name>-light.png`.

## How to capture

### Toolchain (preferred, deterministic)

```bash
cd docs/wiki/screenshots
./scripts/capture.mjs                    # full set, both themes, both viewports
./scripts/capture.mjs --pages dashboard  # subset
```

The capture script bootstraps a fresh anonymized demo via `/join` with `DEMO01`, switches theme via `localStorage`, navigates each page, and writes PNGs into `docs/wiki/images/`. See `docs/wiki/screenshots/README.md` for the full list of accepted args.

### Manual (for shots the script can't reach)

For things like the screensaver, mid-drag interactions, dialogs, hardware photos — capture by hand:

```bash
# Browser at full kiosk resolution (1920x1200):
# DevTools "Capture full size screenshot", or the OS screenshot tool.
# Save into docs/wiki/images/ with the suggested filename above.
```

For physical kiosk photos:

- Take with phone in good (kitchen overhead) lighting
- Capture both wide + close-up so the README hero shot has options
- Crop distractions; downscale to ~1600px wide max

After saving, replace the `> TODO: screenshot of X` line (if any remain) on the source page with the embed:

```markdown
![Description](images/page-name-screenshot.png)
```

## Tracking commit

When publishing a batch of screenshots, prefer one commit per logical group ("dashboard screenshots", "energy screenshots") so the diff stays reviewable. Update this page's checkboxes in the same commit.

## Legend

- [x] captured — file present in `docs/wiki/images/`
- [~] partially captured — adjacent shot exists but doesn't fully match the original spec
- [ ] still needed
