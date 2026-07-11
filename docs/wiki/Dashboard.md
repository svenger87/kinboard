# Dashboard

The home screen at `/` — the page that's on the kitchen wall ~99% of the time.

![Dashboard in portrait, kitchen-kiosk view: clock, family avatars, weather + schedule + birthdays + notes widgets](images/dashboard-portrait.png)

> TODO: landscape variant on desktop · light-mode variant in `images/dashboard-portrait-light.png`

## Layout

The dashboard is a **monthly-themed clock + widget grid** designed to glance at, not interact with. From top to bottom:

1. **Logo + nav drawer trigger** (top corner)
2. **Today strip** — one row summarizing today: birthdays, event count, pending todos, waste pickups, next holiday
3. **Clock** — large centered, time + day + date + family-members avatars (with status)
4. **Widget grid** — the configurable section, see below

The clock follows the [monthly theme](Themes) color. Date format follows the active locale.

## Today strip

A single horizontal row that summarizes today at a glance:

| Element | When shown |
|---|---|
| 🎂 Birthday name(s) | If anyone has a birthday today |
| 📅 N events | Count of today's events |
| ✓ N tasks | Count of pending todos due today or earlier |
| 🗑 Waste type | If a tracked waste calendar pickup is today |
| ⭐ Next holiday | If a holiday is within 14 days |

Each badge tap-deep-links into the relevant page. Hidden when empty (no clutter).

## Widget grid

The main dashboard area. Widgets are toggle-able per family in **Settings → Widgets**.

| Widget | What |
|---|---|
| **Weather** | Current temperature, wind, 6-day forecast. Tap → full weather modal. See [OpenWeatherMap](OpenWeatherMap). |
| **Upcoming events** | Next 3-5 calendar events (today + future). Tap → `/calendar`. |
| **Schedule** | Today's school periods for selected child. Tap → `/schedule`. See [Schedule](Schedule). |
| **Birthdays** | Closest 3 upcoming birthdays with countdown. Tap → `/birthdays`. See [Birthdays](Birthdays). |
| **Week overview** | 7-day strip with event/task density per day. |
| **Meal plan** | Today's planned meals (breakfast / lunch / dinner / snack). See [Recipes](Recipes). |
| **Waste collection** | Next pickups grouped by waste type. Reads any Google Calendar marked as a "waste pickup" calendar. |
| **Tasks** | Open todos, sorted by priority + due date. See [Tasks](Tasks). |
| **Notes** | Latest 3 family notes + "+ new note" pinned to bottom. See [Notes](Notes). |
| **Tesla** | Battery, range, charging status (only if Tesla integration configured — slated for plugin extraction in v1.1). |

Each widget independently toggleable in **Settings → Widgets**. The toggle has a live mini-preview so you can see what each looks like before enabling.

## Family members row

Below the clock: row of family-member avatars with their colors. Each member's avatar is rendered from either:
- An emoji (👨 👩 👦 👧 etc.)
- An uploaded image (cropped + stored as data URL)
- A linked external URL
- A generic person icon when none of the above

Tapping an avatar surfaces upcoming events / pending todos for that person specifically.

Configure people in [Settings → Family members](People-and-Devices).

## Real-time sync

Every value on the dashboard updates within ~100 ms of a database change anywhere — events synced from Google, todos checked off on a phone, shopping items ticked at the supermarket. See [Architecture](Architecture#real-time-invalidation).

## Behavior on the kiosk

The dashboard is what the [kiosk](Kiosk-Windows-11-Mele-4C) shows when it's idle. The screensaver kicks in after the configured timeout (or when the LD2410 detects no presence — see [Presence-Sensor](Presence-Sensor)).

## Customization

- **Hide individual widgets** in Settings → Widgets
- **Re-theme** monthly themes auto-rotate; manual override in Settings → Theme
- **Show seconds / 24h vs 12h** in Settings → Theme
- **Light vs dark mode** in Settings → Theme

The widget *order* is fixed for now (defined in `webapp/src/app/page.tsx`). Drag-to-reorder is on the v1.2 wishlist.

## Related

- [Themes](Themes) — the monthly color cycle
- [People-and-Devices](People-and-Devices) — per-person colors and avatars
- [Notifications](Notifications) — what shows up as a push when widgets change
