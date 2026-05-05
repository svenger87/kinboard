# Screenshots needed

Master tracking list for every `> TODO: screenshot` marker in the wiki + main README.

> **Status (2026-05-04):** the [automated capture toolchain](screenshots/) is up. ~13 hero shots × 2 themes × 2 viewports = ~50 screenshots captured against an anonymized prod-data demo. The list below tracks the remaining markers — modals, settings sub-pages, mid-state shots, hardware photos that need a real device.

> **Format guidance** — capture at native panel resolution where possible (1920×1200 for the kiosk-style UI), PNG, drop into `docs/wiki/images/<page-slug>-<short-name>.png`, and replace the `> TODO: screenshot` line with `![alt text](images/<file>.png)`.

## Top-priority (these are the hero screenshots — pick 3-4 for the README + Home page)

- [ ] **Dashboard at full screen** — clock + family avatars + widget grid, ideally on the actual kiosk in the kitchen
- [ ] **/calendar month view** with multi-person events visible
- [ ] **/home-automation room view** with a few entity cards
- [ ] **/energy live flow diagram** with arrows mid-animation
- [ ] **Screensaver in action** — photo + clock overlay

## Per-page TODOs

### Dashboard
- [ ] dashboard-landscape.png — full landscape view on desktop or kiosk
- [ ] dashboard-portrait.png — portrait orientation (phone or vertically-mounted kiosk)
- [ ] dashboard-family-members-row.png — close-up of avatar row

### Calendar
- [ ] calendar-month-view.png — month view with mixed events
- [ ] calendar-week-view.png — week view with hourly grid
- [ ] calendar-day-detail-panel.png — tapping a day, side panel open
- [ ] calendar-mapping-rule-editor.png — settings → Google Calendar → mapping rules

### Shopping
- [ ] shopping-list-mixed.png — list with checked + unchecked items
- [ ] shopping-offline-banner.png — when offline indicator banner is showing
- [ ] shopping-quick-add-chips.png — top-of-page favorites chips
- [ ] shopping-bring-sync-indicator.png — sync status badge in header
- [ ] shopping-install-prompt.png — green install banner mid-page
- [ ] shopping-pwa-icon.png — phone home screen showing the green shopping-cart icon next to the Kinboard icon (both PWAs side-by-side)
- [ ] shopping-pwa-launched.png — the standalone shopping-only PWA in standalone mode

### Recipes & meals
- [ ] recipes-library.png — `/recipes` tile grid
- [ ] recipes-detail.png — single recipe view
- [ ] recipes-chefkoch-search.png — `/recipes/search` Chefkoch import dialog
- [ ] recipes-url-import.png — paste-URL import dialog with a foreign recipe site
- [ ] meals-week-board.png — `/meals` two-week grid filled in
- [ ] meals-recipe-drag.png — mid-drag of a recipe tile onto a cell

### Tasks & todos
- [ ] todos-overview.png — `/todos` with mixed states + section grouping
- [ ] todos-priority-badges.png — close-up of urgent / high / normal indicators

### Notes
- [ ] notes-page.png — `/notes` with multiple colored notes

### Birthdays
- [ ] birthdays-year-ring.png — full year-ring visualization
- [ ] birthdays-list-card.png — single upcoming-birthday card

### Schedule
- [ ] schedule-week-grid.png — `/schedule` filled-in week
- [ ] schedule-pack-list.png — pack list for tomorrow

### Smart home
- [ ] home-automation-rooms.png — `/home-automation` with tabs visible
- [ ] home-automation-cards.png — entity cards (light, climate, cover)
- [ ] floating-lights-fab.png — the lights-everywhere modal
- [ ] energy-flow-diagram.png — `/energy` four-corner flow
- [ ] energy-charts.png — line charts panel

### Cameras
- [ ] cameras-grid.png — `/cameras` with a few live feeds

### Screensaver
- [ ] screensaver-idle.png — photo + clock overlay
- [ ] screensaver-news-modal.png — expanded news article
- [ ] screensaver-energy-overlay.png — solar production widget on top

### Family members & devices
- [ ] settings-people.png — `/settings/people` list
- [ ] settings-people-edit-dialog.png — adding/editing a person
- [ ] settings-devices.png — `/settings/devices` list

### Notifications
- [ ] settings-notifications.png — `/settings/notifications` with subscription state
- [ ] ios-add-to-home-screen.png — Safari Share menu mid-flow
- [ ] ios-pwa-installed.png — home-screen icon + standalone launch

### Settings (general — not per-page but useful)
- [ ] settings-overview.png — `/settings` index page
- [ ] settings-google.png — `/settings/google` with connected account
- [ ] settings-homeassistant.png — `/settings/homeassistant` with rooms
- [ ] settings-immich.png — `/settings/immich` with album picker
- [ ] settings-bring.png — `/settings/bring` connection state

### Kiosk + reference build
- [ ] kiosk-mounted-on-wall.png — front-facing photo of the kitchen install (already partially covered by Reference-Build photos)
- [ ] kiosk-frame-detail.png — close-up of the oak frame corners
- [ ] kiosk-cabling.png — cable management at the back

### Onboarding
- [ ] onboarding-setup-wizard.png — first-run `/setup` flow
- [ ] onboarding-join-code.png — join screen with 6-char code

## How to capture

For UI screenshots:

```bash
# In a browser at full kiosk resolution (1920x1200):
# Use DevTools "Capture full size screenshot" or the OS screenshot tool.
# Save into docs/wiki/images/ with the suggested filename above.
```

For photos of the physical kiosk:

- Take with phone in good (kitchen overhead) lighting
- Consider also a "wide" + "close-up" pair so the README hero shot has options
- Crop to remove distracting clutter; downscale to ~1600px wide max

After saving, replace the `> TODO: screenshot of X` line in the source page with the embed:

```markdown
![Description](images/page-name-screenshot.png)
```

## Tracking commit

When publishing a batch of screenshots, prefer one commit per logical group ("dashboard screenshots", "energy screenshots") so the diff stays reviewable. Update this page's checkboxes in the same commit.
