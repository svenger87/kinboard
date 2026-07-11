# Smart home

Two pages built on top of [Home-Assistant](Home-Assistant):

- **`/home-automation`** — touch-friendly room view of HA entities
- **`/energy`** — solar / battery / grid energy dashboard

This page covers what those surfaces *do*. For connecting HA, see [Home-Assistant](Home-Assistant).

| `/home-automation` | `/energy` |
|---|---|
| ![Home automation — room tabs with live entity cards](images/home-automation-rooms.png) | ![Energy dashboard — live flow + charts + insights](images/energy-flow-diagram.png) |

## Home Automation

`/home-automation` is the kitchen-wall control panel. Designed for one-tap-from-glance interactions, not deep configuration.

### Layout: tabs

The top of the page has a row of room tabs (configured via [Settings → Home Assistant → Rooms](Home-Assistant#room-configuration)):

```
[ Living room ]  [ Kitchen ]  [ Bedroom ]  [ Garden ]  [ Other ]
```

Each room tab shows the entities you've assigned to that room. The **"Other"** tab catches unassigned entities (toggle on/off in the rooms settings).

The active room is remembered per-device in localStorage so the kitchen kiosk defaults to "Kitchen" while a phone defaults to whatever room you last tapped.

### Cards

Inside a room tab: one card per entity. Card type adapts to the entity domain:

| Domain | Card |
|---|---|
| `light` | Brightness slider, color picker, on/off toggle |
| `switch`, `input_boolean` | Toggle |
| `climate` | Set-point dial, mode picker, current temp readout |
| `cover` | Open / close / stop buttons + position slider |
| `fan` | Speed slider |
| `media_player` | Play/pause/volume, source title, artwork |
| `lock` | Lock/unlock |
| `alarm_control_panel` | Arm/disarm with PIN keypad |
| `scene`, `script` | Activate button |
| `vacuum` | Start/stop/dock |
| `weather` | Conditions + forecast |
| `person`, `device_tracker` | Avatar + location label |
| `camera` | MJPEG thumbnail (live tap → fullscreen; also see [Cameras](Cameras) for non-HA cameras) |
| `sensor`, `binary_sensor` | Read-only with device-class icon |

Unsupported domains render a generic card with the raw state.

State updates are real-time — toggle a light from the kiosk, the actual bulb changes within ~200 ms.

### "Floating lights" FAB

Bottom-right floating button: tap → modal showing every `light` entity in the family across all rooms. Useful for "turn off everything" at bedtime — one tap on the master switch.

Tap individual lights to toggle, or use the master "all off" / "all on" buttons at the top of the modal.

> TODO: screenshot of the floating lights FAB modal

### Dashboards (custom card grids)

Beyond rooms, [dashboards](Home-Assistant#dashboards) let you curate a flat grid of cards across rooms. Use cases:

- A "morning routine" dashboard with the bedroom light, coffee maker, and weather
- A "media room" dashboard with TV media player + ambient lights + Roku scenes
- A "security check" dashboard with all locks + alarm + cameras

Dashboards are the legacy surface (predates rooms in the codebase). The room view is the recommended primary surface; dashboards work but are slated for consolidation in v1.2.

## Energy

`/energy` is the solar / battery / grid power dashboard. Pulls live data from HA sensors mapped in [Settings → HA → Energy](Home-Assistant#optional-configure-the-energy-dashboard).

### Live energy flow

Top of the page: a real-time **flow diagram** showing four corners:

- ☀️ **Solar** (top-left) — current production W
- 🏠 **Home consumption** (top-right) — current draw W
- ⚡ **Grid** (bottom-left) — import (positive) / export (negative) W
- 🔋 **Battery** (bottom-right) — charge (positive) / discharge (negative) W + state-of-charge %

Animated arrows between the corners show direction of power flow:

```
Solar ────────► Home
   │
   ├──► Battery (charging)
   │
   └──► Grid (export)
```

When solar is exporting and battery is full, you see arrows from Solar → both Home and Grid. When the sun's down, arrows reverse: Battery → Home, Grid → Home.

### Charts

Below the flow: configurable line charts, one per timeframe:

| Chart | Period | Data |
|---|---|---|
| **Power** | Last 24 h | Live W readings (solar, battery, grid, home) |
| **Energy** | Today / 7d / 30d / 1y | Cumulative kWh delta per source |
| **Battery state-of-charge** | Last 24 h / 7 d | Battery % over time |

Each chart's series are configurable in [Settings → HA → Energy → Chart configuration](Home-Assistant#optional-configure-the-energy-dashboard) — pick which entities show up, label them, color them.

### Daily / weekly / monthly aggregates

Sidebar widgets:

- **Today's solar production** in kWh
- **Today's home consumption**
- **Today's grid import / export**
- **Today's battery throughput**
- **Cost** (if you've set €/kWh tariffs in settings)

The cost calculation is approximate — uses simple `import × cost - export × feed-in-tariff`. Doesn't model time-of-use tariffs (planned for v1.2).

### Screensaver integration

If you toggle **Show on screensaver** in the energy settings, the screensaver overlays a small live solar production widget on top of the photo carousel. Useful when the kitchen kiosk is in screensaver mode but you want to glance at "are we exporting right now?" before turning on the dishwasher.

## Patterns that work well

- **Bedtime routine**: open the floating lights FAB → master "all off". Saves tapping each room.
- **Solar-aware appliances**: glance at the energy dashboard → if exporting > 1.5 kW, run the dishwasher
- **Visit-prep**: open `/home-automation` → guest room tab → set the bedside light + thermostat before guests arrive

## What's not supported

- **Editing automations / scripts** — Kinboard surfaces them as triggers (tap to run) but doesn't edit them. Edit in HA's UI.
- **History timeline / logbook** — see HA's UI for that
- **Energy time-of-use tariffs** — single flat rate per direction. v1.2 wishlist.
- **Multi-instance HA** — one HA per family. Multiple HA instances would need per-room-tab sourcing, not implemented.

## Related

- [Home-Assistant](Home-Assistant) — connecting HA, configuring rooms / dashboards / energy
- [Cameras](Cameras) — for cameras outside the HA ecosystem (direct go2rtc)
