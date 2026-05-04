# Screensaver

When the kiosk is idle, Familyboard switches to a fullscreen screensaver — a slow photo carousel with a clock overlay, optional news ticker, and presence-aware activation.

> TODO: screenshot of the screensaver in idle state
> TODO: screenshot of the screensaver showing a news article overlay

## What's on the screensaver

Top → bottom:

1. **Background photo** — fades between images from the configured photo source ([[Integration-Immich|Immich]] or Unsplash)
2. **Clock + date** (bottom-left) — large, low-contrast white-on-photo
3. **Photo credit** (bottom-center) — photographer name + location, small text
4. **Birthdays today** — if anyone has a birthday today
5. **Upcoming events / next 7 days** — small overlay top-right showing the next 5 events
6. **Solar widget** — if energy integration on screensaver is toggled, current solar production
7. **Tesla widget** — if Tesla integration on screensaver is toggled (battery, range)
8. **News headlines** — RSS-fed news headlines, slowly rotating
9. **"Touch to unlock" hint** — subtle, top-center

Tapping anywhere dismisses the screensaver and returns to the dashboard.

## Photo sources

Two configurable sources, picked in [[Integration-Immich|Settings → Photos]]:

### Immich

If you have a self-hosted [Immich](https://immich.app/) instance, point Familyboard at it + pick an album. Two album modes:

- **Specific album** — always the same one
- **Automatic monthly album** — Familyboard searches for an album named like the current month (e.g. `2026-05`, `May 2026`, `Mai 2026`) and uses it. Falls back to a default if none match.

The "monthly album" mode pairs nicely with a Smart Album in Immich that filters photos taken in this month across all years — your kitchen wall shows mid-May 2024 photos in mid-May 2026.

See [[Integration-Immich]] for the connection setup.

### Unsplash

If you don't have Immich (or don't want to share family photos with the wall display), Unsplash is the fallback. Per-month "search terms" generate a curated stream:

| Month | Default search terms |
|---|---|
| January | winter landscape, frost architecture, frozen lake, snowy forest |
| April | cherry blossom, tulip field, blooming orchard, raindrops |
| July | beach sunset, milky way, mediterranean alley, alpine lake |
| December | christmas market, snow factory, candles cozy, fireplace |

(See `webapp/src/lib/unsplash-defaults.ts` for the full list.)

The terms rotate **hourly** — every hour, the screensaver picks a fresh term and refreshes the photo. Customize per-month terms in [[Integration-Immich|Settings → Photos]].

## Photo rotation

Every **30 seconds** by default (configurable 10 s – 5 min), the photo cross-fades to the next one in the source. Smooth `framer-motion` transition, dimmed so the clock overlay stays readable.

## Presence-aware activation

If you've configured an [[Presence-Sensor|LD2410 presence sensor]] for this device, screensaver behavior changes:

- **No presence detected for N seconds** (default 30) → screensaver activates immediately (or display blacks out, depending on mode)
- **Presence detected** → screensaver dismisses, dashboard returns

Without a presence sensor, the screensaver activates after the configured **inactivity timeout** (default 5 minutes; configurable 1 / 2 / 5 / 10 minutes / off).

Configure in [[Integration-Immich|Settings → Screensaver]].

## Two presence modes

When a sensor is present, you choose what "no presence" does:

| Mode | Behavior |
|---|---|
| **Screensaver only** | Show photos, keep display backlight on |
| **Display off (DPMS)** | Turn the display off entirely (saves power, longer panel life) |

Use **Screensaver only** if you like the kitchen wall showing photos as ambient art when the room is empty. Use **Display off** for max efficiency — typical setup for nighttime when no one's in the kitchen anyway.

## News ticker

The screensaver pulls headlines from an RSS feed (configured family-wide). When a news article rotates in:

- Headline + source + relative time ("3 hr ago")
- Image (if the feed includes one) for the latest 1-2 articles
- Tap → expands into a modal with the full description and a "Read article" button that opens the source in the browser

Tapping the screensaver doesn't dismiss it when a news modal is open — only the modal close button does.

> Auto-close: news modals close themselves after 5 minutes of inactivity to prevent the kitchen wall from being stuck on a news article forever.

## Configuration cheat sheet

| Setting | Path |
|---|---|
| Photo source | Settings → Photos |
| Inactivity timeout | Settings → Screensaver |
| Presence mode (Screensaver only / Display off) | Settings → Screensaver |
| Presence delay | Settings → Screensaver |
| Photo rotation interval | Settings → Screensaver |
| Show solar / Tesla widgets on screensaver | Settings → Home Assistant → Energy / Settings → Tesla |

## Patterns that work well

- **Family photo nostalgia mode**: Immich monthly album → kitchen wall shows photos from this same time of year, every year. "Oh look, that was when she was tiny."
- **Ambient art mode**: Unsplash with curated month terms, presence "Screensaver only". The kitchen wall is wallpaper when the room is empty.
- **Power saver mode**: presence sensor + "Display off" → wall is dark unless someone walks up.

## What's not supported

- **Multiple photo sources mixed.** Pick one — Immich or Unsplash, not both.
- **Audio/music on the screensaver.** Photos only.
- **Per-room or per-time-of-day photo sets.** One source per family.
- **Custom widgets on the screensaver.** Solar, Tesla, news, clock are the only overlays. Adding your own would be a code change.

## Related

- [[Integration-Immich]] — Immich photo source setup
- [[Presence-Sensor]] — LD2410 hardware + script
- [[Themes-and-Locales]] — locale-aware date formatting on the screensaver
