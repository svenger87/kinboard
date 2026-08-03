# Changelog

All notable changes to Kinboard land here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CalDAV calendars (Settings → Calendar → CalDAV): connect Nextcloud, Radicale, Baïkal, SOGo, Synology, Fastmail, iCloud or any other CalDAV server with a username and password, pick which calendars to sync, and edit events from Kinboard — creations, changes and deletions are written back to the server. Closes the gap left by read-only `.ics` feeds for households outside the Google ecosystem ([#18](https://github.com/svenger87/kinboard/discussions/18)).
- Conflicting calendar edits are now caught rather than silently overwritten: if an event changed on your phone since Kinboard last synced, the save is refused with an explanation instead of discarding the other change.
- CalDAV calendars the server marks as read-only get a badge and are never written to, and a calendar that stops syncing (usually an expired app password) shows the reason in settings.
- Pre-release channel for testers: set `KINBOARD_TAG=next` in `webapp/docker/.env` to run release candidates and try fixes before they ship. `next` always points at the newest candidate, and removing the line returns you to stable. See [Self-hosting → Pre-release channel](https://github.com/svenger87/kinboard/wiki/Self-hosting#pre-release-channel).
- Weather can now be shown in imperial units. **Settings → Weather → Units** switches the whole household between metric (°C, km/h, km, mm) and imperial (°F, mph, mi, in), covering the widget, the detail view and the forecast ([#19](https://github.com/svenger87/kinboard/issues/19)).

### Fixed
- Calendar week view: events happening at the same time no longer cover each other. Overlapping events now share the day's width side by side — as in any calendar app — and widen again as soon as there's room. Previously the second of two parallel events was drawn exactly on top of the first and was invisible.
- Calendar week view: events starting before 6:00 or ending after 22:00 are no longer cut off. The hour grid was fixed to 6:00–22:00, so an early-morning or late-evening event was drawn outside the visible area; the grid now stretches to cover whatever the week actually contains.
- **Shopping list image search no longer returns unrelated or adult images.** The feature scraped Bing's HTML search page with no SafeSearch setting, and fell back to DuckDuckGo when Bing returned nothing. Bing changed what it serves automated clients, so in practice every search fell through to that fallback — which, because its per-query token no longer matched the query, answered with results for something else entirely and with no content filtering. No Kinboard release caused this; it broke underneath us. **Update as soon as you can if children use your board.**
- Image search now requests SafeSearch properly and *verifies* it was applied, and no longer trusts a single source: results also come from Open Food Facts (real product photos) with Openverse and — if you've set a key — Unsplash filling gaps. Every result is checked against a blocklist and, crucially, against the search term itself, so a source that ignores what you typed returns nothing rather than something random.
- Shopping-list image search now actually finds the product: searching "Bananen" returns supermarket listings rather than nutrition-blog headers, and brand searches like "Domestos" or "L'Oréal Haarspray" return the real item. Results follow your interface language.
- The idle screensaver no longer appears on phones, where it rendered distorted and served no purpose. Devices marked as a kiosk keep it regardless of screen size.
- If image search can't return trustworthy results it now shows an empty state instead of falling back to an unfiltered source. Set `KINBOARD_IMAGE_SEARCH=off` to disable web image search entirely.
- CI: the end-to-end smoke suite had been failing on every push since 25 July, before it ran a single test. `npm ci` aborted during dependency install because the workflow used the npm bundled with Node 20 (npm 10) while the lockfile is npm 11 shaped. The npm version is now pinned in one place (`packageManager` in `webapp/package.json`) and activated in CI and the Docker build, so contributors and CI resolve dependencies identically.

## [1.5.0] - 2026-07-11 — Restore from backup, meal-plan digest, notification fixes

*Upgrade notes:* The schema migration (settings write lockdown) applies automatically on `./start.sh up`. Hard-refresh installed-PWA and kiosk devices once after updating.

### Added
- Restore from backup: the join screen can rebuild a family from a Kinboard export file — everything comes back (people, calendar, recipes, lists, plans) under a fresh join code.
- Meal-plan preview push: an optional evening notification (per-device toggle) lists tomorrow's planned meals.
- Undo now also works on the shopping kiosk (/einkaufen), including offline — restored items re-sync when the connection returns.

### Security
- The browser can no longer write settings directly to the database — all changes go through the app server, closing the last path a stale or hostile client on the network could use to plant settings values. Reads and live updates are unchanged.

### Fixed
- Bring!: closed the one remaining case of the v1.4.0 settings-reset fix — changing an option right after app start, before the Bring settings had loaded once, could still reset the others to defaults.
- Event reminders no longer send the same push notification twice; birthday and meal-plan digests can no longer double-send if their schedule re-runs.
- The weather settings Save button now disables again when you revert your edits or after saving.
- Event links: browser back never leaves a stale event address in the URL bar, deleting a deep-linked event can be undone like any other, and shared-link events show the right person color as soon as family data loads.
- "What's new" shows a loading shimmer instead of a blank panel, renders nested release-note lists properly, and retries sooner after a failed fetch.
- Family names are trimmed at creation, so the delete-family confirmation never demands an invisible trailing space.

## [1.4.0] - 2026-07-11 — Security hardening, full-language support, backup & undo

*Upgrade notes:* Hard-refresh installed-PWA and kiosk devices once after updating (pull to reload, or Ctrl+F5). If localhost access misbehaves on an older install, re-run `./setup.sh` and `docker restart kinboard-kong` to regenerate an outdated kong.yml.

### Added
- "What's new": after an update, the app shows a short notice with the release notes, and the version line in Settings opens the changelog anytime.
- A "Live updates paused" pill appears above the navigation when the realtime connection drops, and clears itself on reconnect — a kiosk display never shows stale data without warning.
- Settings → Data & backup can now export everything — events, todos, shopping, recipes, meal plans, notes, birthdays, schedules, settings — as one JSON file, excluding credentials and device data.
- Subscribe to the family calendar from Google Calendar, Apple Calendar, or Outlook via a secret ICS link (Settings → Data & backup), rotatable anytime to revoke access.
- Deleting a note, todo, shopping item, meal-plan entry, event, birthday, or recipe now shows an "Undo" toast that restores it exactly as it was.
- Calendar events are now searchable by title, location, or description, and every event has a shareable link that jumps straight to its date; the back button now closes the event dialog instead of leaving the calendar.
- Families can now be renamed from Settings and deleted entirely from the danger zone, which requires typing the family name and erases all data — export a backup first.
- A new Diagnostics section in Settings shows network, live-updates, push, and integration status at a glance, and the webapp container now reports its health for automated monitoring.
- Birthday reminders now actually send a push notification per the notify-days-before setting, respecting quiet hours, with a per-device toggle in Settings → Notifications.
- A new text-size setting (Settings → Theme) offers three sizes saved per device, so a wall kiosk can be read from across the room without affecting phones.

### Changed
- The setup wizard's weather step now has the same city search, suggestions, coordinates mode, and use-my-location button as the weather settings page; credential fields (Home Assistant token, Immich/Unsplash keys, Bring password) share one show/hide input everywhere, and the wizard's Home Assistant step trims trailing slashes automatically.
- Deleting calendar events, vehicles, Home Assistant rooms, or meal-plan entries now shows the same styled confirmation dialog instead of native browser popups or no confirmation at all.
- Empty pages (vehicles, stocks, pocket money, news, schedule, smart home) now use the same empty-state card as the rest of the app, each with a clear next step.
- Todos, birthdays, and the meal plan now have the same floating add button on phones as calendar, notes, and recipes; vehicles, stocks, pocket money, and schedule show loading skeletons instead of plain text.
- The flat visual theme now covers the remaining app surfaces (todos, news, vehicles, stocks, pocket money, error pages, getting-started checklist, plugin cards, PIN screen), replacing the old glass look and a dark-mode contrast bug in month-colored buttons.
- The school-schedule entry only appears in navigation once a schedule or subjects are configured, matching other optional features; the page stays reachable by direct link and explains setup.
- Fresh installs no longer log a failed request on the notifications settings page when no push notification keys are configured.

### Fixed
- Source builds and CI work again: a dependency-bot update had broken `npm ci` with an out-of-sync lock file (red since July 6); the lock file is regenerated and verified.
- Building the webapp image on a machine that had run the dev server no longer fails, and local dev files — including the stack's `.env` secrets — are no longer bundled into image layers.
- When the server is unreachable, the app now shows a "Can't reach the Kinboard server" screen with a retry button after about 12 seconds instead of spinning forever.
- Settings pages now correctly show success and error toasts (connect, sync, PIN saved, feed changes), and previously-silent failures — weather location, news sources, stonks watchlist, new vehicles, Google Calendar setup without server keys — now show a clear error instead of failing silently.
- The delete-person confirmation now correctly states that the pocket-money account and school schedules are deleted, while birthdays, events, and todos are kept but unassigned.
- Push notifications for shopping, todos, calendar reminders, and birthday reminders now use the family's chosen language and correctly pluralize "in N day(s)" in English, German, and French, instead of always German; families that never pick a language keep German pushes.
- The keyboard-shortcuts help dialog, weather condition labels, and assorted tooltips, labels, and dates now follow the app language (English, German, or French) instead of always showing German.
- Reconnecting or changing one Bring! option no longer silently resets your other Bring! settings (sync direction, list choice) to their defaults.
- Screen readers now announce what every icon-only button does — edit, delete, copy, and more.
- Family data export no longer fails for families with recipes, and now includes vehicles, the stocks watchlist, and pocket-money data.
- Calendar feed subscriptions no longer show whole-day events one day too long.

### Security
- Integration credentials (Home Assistant, Immich, Unsplash, Google, Bring!) are no longer readable from the browser — they moved to server-only storage. Existing installs migrate automatically; integrations keep working without reconnecting.
- The settings PIN is now checked and stored server-side, where devices on the network could previously read it or bypass the check client-side; existing PINs migrate automatically.

## [1.3.0] - 2026-07-10 — Redesign completion, French, join-code expiry

*Upgrade notes:* Join-code expiry is opt-in — existing codes keep working unless you set a TTL.

### Added
- Settings can now rotate the family join code and set it to expire (never / 1 hour / 24 hours / 7 days); expired codes are rejected at join time, and existing installs are unaffected.
- People now support an optional birth date, which shows a parent/child role label ("Parent" or "Child · N years") in the setup wizard and Settings → People.
- Settings → Theme now offers a neutral palette choice — Sand (default), Sage, or Warm grey — that adjusts background warmth while keeping your accent color and monthly themes.
- Birthdays now support a per-birthday gift-ideas list — add, check off, and delete ideas from the edit dialog or the next-birthday hero card.
- Notes can now be attributed to a family member, whose color and name appear on the sticky note.
- Birthdays now support an optional per-birthday photo, shown on the hero card, year-ring dots, and lists instead of the linked person's avatar.
- The screensaver now shows a compact weather chip and displays each family member's avatar next to their upcoming events.
- Home Assistant settings gained a manual re-sync action and a status footer.
- Kinboard now ships a French interface alongside English and German — selectable during onboarding or from Settings → Language, auto-detected from the browser, and applied to date/time and number formatting too (contributed by @Yorkou, #9).
- Calendar now has person-filter chips in the topbar to toggle which family members' events are shown.
- Mobile navigation is now a fixed 4-item bottom bar (Home, Calendar, Shopping, More), with a "More" sheet listing every other route, your per-device order, and unread badges.
- Page navigation now has a brief fade-and-rise transition, simplified to a plain fade in kiosk mode and disabled under reduced-motion settings.
- Shopping list now supports voice input via a microphone button (supported browsers) and gained a mobile floating add button.
- The join code is now entered into six individual cells, supporting paste, backspace-to-previous, and arrow-key navigation.
- The "Who's in your family?" setup step now offers a 10-color swatch picker with a live avatar preview.
- The language switcher now has a localized accessible label (EN/DE/FR).

### Changed
- Weather detail view and the screensaver clock got restyled to the new theme; screensaver section labels (News/Events/Birthdays) are now localized instead of hardcoded German.
- Smart Home entity cards, dashboard tabs, and light-on badges got the new flat theme, and a new Scenes section surfaces your actual Home Assistant scenes.
- Camera live tiles now show a LIVE pill, a scanline overlay, the camera name overlaid on video, and a clear offline state when a stream drops.
- Notes page redesigned as a sticky-note board with slight per-note rotation and a mobile add button.
- Birthdays year-ring now shows each family member's avatar and highlights the next birthday (name, age, days remaining) at its center.
- Onboarding now opens on a welcome screen with clear "Create a family" / "Join a family" options, and the setup wizard adopts the new flat card design.
- Settings hub and integration pages redesigned with live connection-status indicators and a consistent layout across subpages.
- The whole interface got a visual refresh: warm sage-linen colors, a rotating monthly accent color, new typography, and restyled buttons, cards, tabs, and other core UI elements, in both light and dark mode.
- Adding a new language is now much less work, with partial-translation support (untranslated strings fall back to English) and a language picker that shows each language's native name (English / Deutsch / Français).
- Empty states, loading skeletons, and desktop navigation adopted the new flat design, dropping the previous glass/blur look.
- Calendar was redesigned with flat day cells, a highlighted "today" ring, and person-colored event pills, and now shows waste-collection events (with a trash icon) directly on the month grid and day agenda.
- Schedule redesigned with avatar-based child selector pills, a weekly grid highlighting today's column, and a "Pack for tomorrow" card with an interactive packing checklist.
- Shopping list redesigned with colored category headers, quantity and person badges on each row, a strikethrough done state, and a flattened kiosk view.
- Meal planner week board and cards redesigned with the new flat theme; today is highlighted, and "Shopping list" is now the primary header action.
- Energy dashboard redesigned with flat cards, a re-skinned flow diagram, theme-matching chart colors, and a compact mobile Solar→Home→Grid flow with a battery bar; respects reduced-motion.
- Recipes redesigned with filter chips, a photo-header detail view with meta pills, and a checklist ingredient list; URL import now shows a preview (title, photo, ingredients) before saving instead of importing silently.

### Fixed
- Navigation now shows on all devices again, including kiosk and installed PWAs — a prior kiosk-only status bar had left some devices with no way to navigate.
- Fixed several mobile layout issues: overflowing or duplicated controls on birthdays, shopping, calendar, and the schedule widget, plus off-center join-code cells and dashboard elements.
- Long agenda event titles now scroll instead of truncating, unless you've turned on reduced motion.
- The energy page's animated flow diagram now also displays on phones (previously a static row).
- Birthday countdowns and the birthday nav badge now refresh at midnight or when the device wakes, instead of staying stale until a manual reload.
- Meal planner dates now follow your selected language instead of always showing German, and the drag-to-move error message is localized too.

## [1.2.0] - 2026-06-01 — Onboarding completeness + setup/self-host hardening

### Added
- Empty plugin widgets (Vehicles, Stonks, Pocket Money) now show a "discover" card explaining the feature and linking to enable it or add your first item, dismissible per device.
- Settings → Notifications now shows a "push server not configured" hint when no VAPID keys exist, explaining why push doesn't work and linking to the setup guide.
- The weather widget now shows a "set up weather" link to Settings → Weather when no API key is configured, instead of a cryptic error.
- The calendar page now shows an "add a calendar" banner linking to Settings → Calendar when no calendars exist yet.
- The first-run setup wizard gained a Calendar step to connect Google, add an iCal feed, or skip, so new families aren't left with an empty, unguided calendar.
- The dashboard's one-time setup banner is now a persistent, collapsible getting-started checklist that tracks family members, calendar, weather, and Home Assistant setup as you complete them.
- The shopping list header now shows a "Connect Bring!" button when Bring isn't linked yet.
- Settings for Google Calendar and Home Assistant now show a "Reconnect" banner when the saved credentials are rejected, instead of syncing failing silently or showing a misleading "Connected" status.

### Changed
- `setup.sh` no longer silently falls back to localhost when run non-interactively (e.g. over SSH); it now requires a `--url` flag (or `KINBOARD_URL`) and errors clearly if neither is given.
- `setup.sh`'s summary now flags when push notifications are off due to missing VAPID keys, and tells you how to fix it.
- Pocket Money's deposit, withdrawal, and spend-request flows now use a proper dialog instead of browser prompts, with amount and reason in one step.
- The kid-facing Pocket Money view now shows a pending-approval banner when a withdrawal request is awaiting parent sign-off.

### Fixed
- The setup wizard's People step (and several other flows) crashed on plain-HTTP LAN installs because a browser API required a secure context; fixed with a fallback so HTTP-only self-hosts work.
- The storage container's healthcheck falsely reported "unhealthy" forever due to an IPv6/IPv4 mismatch; fixed by pointing the healthcheck at 127.0.0.1.
- A bare `docker compose up` (without `start.sh`) used to crash-loop on database authentication errors; the stack now self-aligns service passwords automatically, so plain `docker compose up -d` works out of the box.
- Pocket Money's allowance schedule now re-anchors correctly when you change the payday mid-cycle, instead of making the next payment wait a full extra cycle.
- Push notification times for calendar events were shown in UTC instead of your local time; the server now defaults to (and lets you configure) your household's timezone.

### Security
- Bumped `next` to clear all 15 known dependency vulnerabilities (7 high, 6 moderate, 2 low) in the webapp; `npm audit` now reports zero.

## [1.1.0] - 2026-05-11 — Pocket Money plugin + end-to-end auto-update overlay

### Added
- Added the Pocket Money plugin (Piggy): per-kid virtual accounts with parent-configurable interest, a scheduled allowance, and a multi-goal savings queue with photo lookup.
- Each kid's Pocket Money avatar visibly evolves through 8 stages (one of five species) as their lifetime savings cross set milestones, with small celebration animations for evolutions, goals reached, and interest paid.
- Kids can view balances, add goals, and request withdrawals; deposits, withdrawals, interest-rate changes, and withdrawal approval stay parent-only in Settings → Pocket Money.
- Added an end-to-end auto-update overlay (Diun + a webhook) that automatically pulls, migrates, and restarts Kinboard when a new image is published, replacing the deprecated Watchtower overlay (which never handled config/migration changes).
- Added `/settings/navigation` — drag-and-drop reordering of the bottom navigation, saved per device, with a reset-to-default option.
- Settings → Pocket Money now shows a full avatar evolution preview when picking a species, and a projected-balance forecast (1/3/6/12 months) to help parents dial in a realistic interest rate.
- The public demo now seeds a sample vehicle and stock watchlist, so visitors see the Vehicles and Stonks pages populated without configuring real integrations.

### Changed
- Pocket Money's goal image search now falls back to a web image search when the curated catalog has too few results, tagging web results distinctly and degrading gracefully if unreachable.
- Pocket Money interest now commits daily instead of weekly, so accrued interest reaches the visible balance within about 24 hours instead of up to 6 days.
- Dashboard widgets in the same row now stretch to equal height, removing dead whitespace under shorter widgets.
- The desktop nav's theme toggle is now a proper pill button with visible contrast in dark mode (previously its icon and border blended into the background).
- `setup.sh` now backfills a missing key into `.env` instead of only replacing empty existing ones, so self-hosts with an older `.env` still get newly introduced keys.

### Deprecated
- The Watchtower auto-update overlay is deprecated in favor of Diun; it still works for existing installs, but see [Watchtower migration](https://github.com/svenger87/kinboard/wiki/Self-hosting#auto-updates) for the swap-out steps.

### Fixed
- The Diun auto-update overlay never actually triggered updates due to a configuration templating bug; re-running `setup.sh` once repairs existing installs.
- Swiping the mobile bottom nav to reach off-screen items no longer fires a stray click on whatever was under your finger at the start of the swipe.
- Newly added Stonks tickers now show the asset's full name (e.g. "Apple Inc.") instead of just the bare symbol; existing tickers keep their label until edited.

## [1.0.19] - 2026-05-09 — Stonks plugin + iCalendar (.ics) feeds + unified calendar settings

### Added
- Add a Stonks plugin to track stocks, ETFs, crypto, indices, and forex in a watchlist via Yahoo Finance (no API key needed), with a dashboard widget and per-ticker chart page (Settings → Stonks).
- Subscribe to read-only calendar feeds via an `.ics` or `webcal://` link — covers iCloud, Google's secret iCal address, and most CalDAV providers — with per-feed name, color, and person assignment (Settings → Calendar).
- Add a manual "Sync now" button (Settings → Calendar) to refresh ICS feeds on demand instead of waiting for the automatic 30-minute sync.

### Changed
- Cameras now follows the same enable/disable plugin pattern as Vehicles and Energy — turning it off at Settings → Plugins hides it from navigation and settings entirely.
- Settings → Calendar is now a single landing page linking to both Google Calendar and ICS feed setup, so you don't need to know which provider you're configuring first.

### Fixed
- Fix the Stonks toggle in Settings → Plugins showing a raw translation key instead of its name and description.
- Fix Settings → Calendar showing Google Calendar as "not connected" when it was already connected.

## [1.0.18] - 2026-05-09 — Energy migrates to SurfacePlugin contract

### Changed
- Energy now follows the same enable/disable plugin pattern as Vehicles — manage it from Settings → Plugins, with old bookmarks to its settings page redirecting automatically.

## [1.0.17] - 2026-05-09 — Calendar push reminders + /shopping nav fix

### Added
- Calendar events can now send a push notification a configurable number of minutes before they start (default 30, Settings → Notifications); all-day events are skipped.

### Fixed
- Fix the Shopping page hiding the bottom navigation bar, leaving users unable to get back to the dashboard; the dedicated kiosk Shopping app keeps its intentional no-nav layout.

## [1.0.16] - 2026-05-09 — Country-aware holidays + dashboard spacing

### Added
- Add a country picker (Settings → Language) so public holidays on the calendar match your country — Germany, US, UK, Netherlands, or France; existing families default to Germany.

### Fixed
- Fix the dashboard's today strip sitting flush against the widgets below it on narrow screens, adding proper spacing.

## [1.0.15] - 2026-05-09 — Clock detail popover is touch-accessible

### Fixed
- Fix the clock widget's detail view (weekday, week number, day progress) being hover-only and unreachable on touch and kiosk devices — tap to open it now, with keyboard and screen-reader support.

## [1.0.14] - 2026-05-09 — News reader image-dedup

### Fixed
- Fix the news reader showing the same hero image twice for some publishers (notably Der Spiegel).

## [1.0.13] - 2026-05-09 — Vehicles dashboard widget polish

### Changed
- Slim down the Vehicles dashboard widget to a compact card (photo, battery percentage, charging rate or range) so it fits the dashboard grid without dominating it.

### Fixed
- Remove a redundant settings icon from the Vehicles page's Tesla card — the page's Manage button already links to vehicle settings.

## [1.0.12] - 2026-05-09 — Vehicles plugin + plugin contract v0.1 + Watchtower-safe migrations

### Added
- Tesla-only support is now Vehicles, supporting multiple cars from different vendors per household; existing Tesla setups migrate automatically and old links keep working.
- Add a Generic-EV vehicle type that works with any car Home Assistant can talk to — VW, BMW, Polestar, Hyundai, OBD2 dongles — not just Tesla; the dashboard widget rotates through all configured vehicles.
- Add a Settings → Vehicles flow to add, edit, and manage multiple vehicles, replacing the single Tesla settings page (which now redirects automatically).
- Add Settings → Plugins to turn optional features on or off per family — disabled plugins disappear from navigation, the dashboard, and settings without deleting any data.
- Upload a custom photo (PNG, JPG, or WebP, up to 5 MB) for each vehicle from its settings page, shown on the dashboard widget and vehicles page instead of the default car image.

### Changed
- Database schema migrations now run automatically when the webapp container starts, so self-hosters using auto-updates no longer end up running new code against an outdated database; re-run `setup.sh` once after upgrading.
- Settings navigation now has a Vehicles entry instead of Tesla, and a new Plugins entry under Display.

### Fixed
- Fix a migration-ordering bug that could make a fresh install fail during its first boot.
- Fix uploaded recipe and vehicle images failing to load in the browser because the generated URL pointed at an internal-only address.
- Fix public image URLs (recipe and vehicle photos) sometimes failing to load because the API gateway required a key for files that should be publicly readable.

## [1.0.11] - 2026-05-08 — Device recognition resilience + interactive setup + Shopping PWA fixes

### Added
- Device recognition now survives browser and OS updates that used to break auto-rejoin — existing devices need to rejoin once via family code, and any device that still isn't recognized sees a hint on the join screen for where to find the code.
- Add an iOS-specific hint when the Shopping app is installed as its own PWA, explaining that "Add to Home Screen" only works from Safari, not from inside another installed app.
- The setup script now interactively prompts for optional integration keys (maintainer email, OpenWeatherMap, Google Calendar OAuth) after generating secrets, with a non-interactive flag for scripted installs and an advanced flag for more integrations.

### Changed
- Unconfigured integrations no longer log a false "404" error to the browser console on every page load for fresh installs and the demo overlay.
- The graceful-degradation handling for a missing OpenWeatherMap key now also covers invalid keys, rate-limiting, and outages, so the dashboard's location lookup never logs an error regardless of the cause.

## [1.0.10] - 2026-05-08 — Setup wizard + Leave family fix

### Added
- New families now go through a guided setup wizard after creating their family — add members, optionally connect Home Assistant, optionally set a city for weather — each step skippable, replacing an empty dashboard.

### Fixed
- Fix "Leave family" leaving the device recognized by the server, so leaving immediately showed a "Welcome back" rejoin prompt for the family you just left.
- Fix newly created families sometimes landing on an empty dashboard instead of the setup wizard due to a race in the post-join redirect.

## [1.0.9] - 2026-05-08 — Meal-plan upsert + chunk-reload recovery + E2E smoke

### Added
- Document how to enable hardware-accelerated video transcoding for camera streams on Intel-GPU hosts, with a template override file and wiki walkthrough.

### Fixed
- Fix meal-plan saves failing with an error on older installs missing a database constraint added after their initial setup; existing installs self-heal automatically on next restart.
- Fix the app getting stuck on a broken page after an auto-update — it now detects the stale files and reloads automatically.
- Fix push notification badges showing a featureless white blob on Android instead of the house icon, caused by a full-color image where Android expects a transparent silhouette.
- Fix the dashboard's location lookup logging server-error messages to the browser console on installs without a configured weather API key.

## [1.0.8] - 2026-05-07 — Demo overlay + auto-update opt-in + nav polish

### Added
- The public demo's camera tiles now show themed animated placeholder video (kitchen, garden, front door) instead of one static image.
- Add an optional demo overlay that runs mock Home Assistant, Tesla, weather, and camera services, so a public-facing demo instance can showcase every feature without real credentials.
- The public demo now shows fictional news articles instead of real RSS content, avoiding copyright issues from displaying real publisher content to anonymous visitors; self-hosted installs are unaffected.

### Changed
- The bottom navigation now hides Smart Home, Energy, Tesla, and Cameras until the matching integration is set up, so fresh installs aren't cluttered with dead links; direct links still work.

### Fixed
- Fix camera streams failing to load when the browser couldn't reach the camera's local network address directly; streams now proxy through the server, which also stops leaking your LAN address.

## [1.0.7] - 2026-05-07 — Live demo + auto-update opt-in

### Added
- Add a live demo link (demo.kinboard.app) to the README with a ready-to-use join code, so visitors can try Kinboard before installing.
- The public demo now ships with realistic sample data — a stocked shopping list, recipes, meal plan, events, birthdays, todos, notes, and school schedules — refreshed nightly to stay current.
- Add a banner on the join screen that shows the demo family's join code with a one-click "use this code" button when running the public demo; self-hosted installs never see it.
- Add an optional Watchtower overlay so self-hosters can auto-update just the webapp container (database and other services stay pinned), with a choice of update cadence via the image tag you track.

## [1.0.6] - 2026-05-07 — Traefik + push-notification papercuts

### Added
- Add a wiki walkthrough for setting up Traefik with Let's Encrypt from scratch, for self-hosters who don't already have a reverse proxy running.
- Add a "requirements" section to the push notifications wiki page listing the four preconditions — HTTPS, a supported browser, iOS PWA install, and server-side keys — so self-hosters know upfront why plain-HTTP setups can't push.
- Note in the self-hosting wiki that push notifications and PWA install need HTTPS even on a closed LAN, with three ways to get there — Cloudflare Tunnel, Traefik with Let's Encrypt, or a self-signed CA.

### Fixed
- Fix wiki cross-page links showing as literal "[[Page]]" text when read from the GitHub repo's file viewer instead of the wiki proper.
- Fix the push-notification Subscribe toggle appearing (but silently failing) on plain-HTTP installs and iOS Safari without a home-screen install; both now show an explanatory hint instead.
- Fix the setup script computing the wrong site URL for reverse-proxy deployments (Traefik, Caddy, Cloudflare Tunnel), which broke every API call in the browser due to a CORS mismatch.
- Fix the setup script's final instructions always telling you to open localhost, even when you'd configured a LAN IP or real domain.
- Fix the Traefik example config referencing a WebRTC entry point most self-hosters haven't defined, which spammed the logs with errors every few seconds.

## [1.0.5] - 2026-05-07 — Self-hoster orientation pass

### Added
- Google Calendar settings now shows a setup hint and disables the Connect button when the server's OAuth credentials aren't configured, instead of failing silently.
- Photos settings now shows a setup hint on fresh installs explaining the choice between self-hosted Immich and curated Unsplash photos.
- Home Assistant settings now shows a setup hint explaining how to generate a long-lived access token, with a link to the wiki walkthrough.

### Fixed
- Fix the weather settings page's setup walkthrough link pointing at a renamed wiki page.

## [1.0.4] - 2026-05-05 — Orphan-session + meal-plan race + CORS fixes

### Fixed
- Fix a wall of console errors appearing briefly when a stored family session pointed at a deleted family, by blocking the dashboard from rendering until the session is verified.
- Fix the meal planner sometimes logging conflict errors when the dashboard widget and the meal-plan page both tried to create the same week at once.
- Fix the app breaking entirely (until reload) whenever a request hit a brief server hiccup, caused by the API gateway rejecting a retry header modern Supabase libraries send; upgrade to 1.0.4+ (or restart the gateway after re-applying config) to pick up the fix.

## [1.0.3] - 2026-05-05 — News reader, version check, brand refresh

### Added
- Add an in-app article reader for news — tap an article to read a clean, distraction-free version inline instead of opening a new tab; if extraction fails, it falls back to an "open original" link.
- News now supports 10 sources to choose from (5 German, 5 English) instead of just Der Spiegel, picked from Settings → News.
- Add a dedicated News page to the main navigation, with search and per-source filtering, independent of the screensaver's news ticker.
- Settings now shows your current version in the footer and a link when a newer release is available, checked against GitHub releases.

### Changed
- Refresh the app icon, favicon, and all PWA icons with new artwork, and add a banner image to the README.

### Fixed
- Fix the app getting stuck showing errors everywhere (instead of redirecting to rejoin) when a browser's saved family no longer exists on the server, such as after restoring a backup.
- Weather settings now explains what to do when no weather API key is configured, instead of silently showing a form with no live preview.

## [1.0.2] - 2026-05-05 — Image-overlay path actually works

*Upgrade notes:* Self-hosters on `1.0.1` using the source-build path need no action — `start.sh restart` picks up the new code on the next pull. Self-hosters on the image-overlay path: pull `:1.0.2` (or `:latest`) and run `docker compose down && docker compose -f docker-compose.yml -f docker-compose.image.yml up -d`; the browser console error goes away.

### Fixed
- The pre-built Docker image now works with any self-hoster's URL — server URLs are injected at request time instead of baked in at build, so the published image no longer ships a broken join page, and `.env` URL changes apply on container restart without a rebuild.
- Quick-start docs now flag that `setup.sh` needs an interactive terminal — piping it over SSH or a script silently defaults to `localhost:8100`, breaking access for every other device, and the docs now point at the `API_EXTERNAL_URL` / `SITE_URL` workaround for non-interactive runs.

### Changed
- Project email addresses moved to the new `@kinboard.app` domain (Cloudflare Email Routing). `security@kinboard.app` (was `security@svenger87.de`) and `conduct@kinboard.app` (was `conduct@svenger87.de`) — referenced from `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `SUPPORT.md`.
- Quick-start now recommends the pre-built image overlay first (~30 sec bring-up, ~512 MB RAM) over a source build (~5–10 min, ~4 GB peak), keeping the source-build path for users who patched the code or want a frozen build.

## [1.0.1] - 2026-05-05 — Renamed to Kinboard

The project was renamed from **Familyboard** to **Kinboard** to avoid namespace overlap with two existing products in the same space (`familyboard.net` is a similarly-positioned family-organizer SaaS, and `familyboard.cz` is a Czech family message-board app). v1.0.1 ships zero functional changes — only branding, container names, image registry path, and badge URLs.

*Upgrade notes:* Image registry path changed from `ghcr.io/svenger87/familyboard` to `ghcr.io/svenger87/kinboard` (old `familyboard` images stay frozen at `1.0.0`). If you're on `:latest`, pointing `image:` at `ghcr.io/svenger87/kinboard:latest` and running `docker compose pull && docker compose up -d` is enough. If you've pinned `:1.0.0`, plan to bump to `:1.0.1` on the new image path — data is preserved either way. Default container name prefix also changed from `familyboard-*` to `kinboard-*`: set `PROJECT_NAME=familyboard` in `webapp/docker/.env` to keep the old names, or run `cd webapp/docker && docker compose down && docker compose -f docker-compose.yml -f docker-compose.image.yml up -d` to recreate under the new ones (volumes are bind-mounted from `${DATA_DIR}`, so the database survives). Repo URL also changed from `github.com/svenger87/familyboard` to `github.com/svenger87/kinboard` — GitHub auto-redirects, but `git remote set-url` is recommended for clarity. First-time installers see only Kinboard branding everywhere; this rename is invisible to them.

### Changed
- **Image registry path changed** from `ghcr.io/svenger87/familyboard` to `ghcr.io/svenger87/kinboard`.
- **Default Docker container name prefix changed** from `familyboard-*` to `kinboard-*`.
- **Repo URL changed** from `github.com/svenger87/familyboard` to `github.com/svenger87/kinboard`.
- Brand: `Familyboard` → `Kinboard` everywhere user-visible (PWA name, push notification title, page titles, settings labels, README, wiki).
- npm package name: `familyboard` → `kinboard` in `webapp/package.json`.
- Domain placeholder in docs and `.env.example` now uses `kinboard.app` / `kinboard.example.com` instead of `familyboard.example.com`.
- All English + German user-facing strings updated (`webapp/messages/en.json`, `webapp/messages/de.json`).

## [1.0.0] - 2026-05-04 — Initial public release

Initial public release.

### Added
- Built-in real-time shopping list with offline support, installable as its own home-screen icon
- Two-way Google Calendar sync — events created in Kinboard now push back to Google
- Recipe import from Chefkoch.de and any schema.org/Recipe URL
- Energy dashboard with live power/energy/battery flow and charts from Home Assistant
- Web push notifications for shopping items, task assignments, and the daily todo digest (PWA install required on iOS)
- LD2410 presence sensor support — the display blanks when no one is in the room
- English and German UI, with monthly themes that rotate colors through the year
- A documented reference hardware build (Mele Quieter 4C mini-PC + 27" touchscreen) for a wall-mounted kiosk
- Multi-arch (amd64 + arm64) Docker images published to `ghcr.io/svenger87/kinboard`, with an optional pre-built-image overlay so self-hosters don't need to build locally

### Changed
- Schema migrations now ship as separate files, keeping the initial schema reserved for fresh installs
- Row-level security is disabled — the device-cookie + family-join-code model is the actual auth boundary
- Dashboard widgets follow locale-specific date, time, and number formatting

### Fixed
- Fresh installs were missing a few columns that production already had; existing installs get patched automatically
- A missing database schema could make the realtime service crash-loop on some Postgres image versions
- Production deploys now keep their Traefik reverse-proxy configuration across container rebuilds
- The energy dashboard no longer shows raw translation-key placeholders instead of text
- Weather routes support a configurable base URL for testing without hitting the real API

### Security
- Demo and documentation screenshots are anonymized before capture, so no real household data appears in them
- VAPID keys, Supabase secrets, and family join codes are generated fresh per install — no shared defaults

---

[Unreleased]: https://github.com/svenger87/kinboard/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/svenger87/kinboard/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/svenger87/kinboard/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/svenger87/kinboard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/svenger87/kinboard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/svenger87/kinboard/compare/v1.0.19...v1.1.0
[1.0.19]: https://github.com/svenger87/kinboard/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/svenger87/kinboard/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/svenger87/kinboard/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/svenger87/kinboard/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/svenger87/kinboard/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/svenger87/kinboard/compare/v1.0.13...v1.0.14
[1.0.13]: https://github.com/svenger87/kinboard/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/svenger87/kinboard/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/svenger87/kinboard/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/svenger87/kinboard/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/svenger87/kinboard/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/svenger87/kinboard/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/svenger87/kinboard/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/svenger87/kinboard/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/svenger87/kinboard/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/svenger87/kinboard/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/svenger87/kinboard/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/svenger87/kinboard/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/svenger87/kinboard/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/svenger87/kinboard/releases/tag/v1.0.0
