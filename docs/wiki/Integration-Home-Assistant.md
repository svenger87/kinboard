# Home Assistant

Familyboard talks to Home Assistant via its REST + WebSocket API to display entities, run room-based dashboards, and power the energy widget.

![Home automation — room tabs with live entity cards](images/home-automation-rooms.png)

## What it does

- Browse all your HA entities, group them into Familyboard "Rooms" + "Dashboards"
- Real-time entity state (lights, switches, sensors, climate, covers, locks, alarms, media players, scenes, vacuums, weather, person trackers)
- Cards per entity domain with appropriate controls (slider for lights, set-point for climate, etc.)
- Dedicated **energy dashboard** wiring solar / battery / grid / home-consumption sensors → live power flow, charts, daily/weekly/monthly aggregates

## What it does not

- Doesn't replace the HA UI — it surfaces a curated, family-friendly subset
- Doesn't store entity history — that lives in HA itself, queried via REST when needed
- No automations / scripts / blueprints UI

## Setup

### 1. Generate a long-lived access token in HA

In Home Assistant: your profile (bottom-left avatar) → **Long-Lived Access Tokens** → **Create Token**. Name it `familyboard` and copy the token — you only see it once.

### 2. Connect from Familyboard

1. Open Settings → Home Assistant
2. **Home Assistant URL** — the URL your browser uses to reach HA. If both Familyboard and HA are on the same LAN: `http://<ha-ip>:8123`. If HA is behind your reverse proxy: `https://homeassistant.example.com`.
3. **Long-Lived Access Token** — paste the value
4. Click **Connect**. The app verifies the URL + token, then saves.

> TODO: screenshot of /settings/homeassistant connect dialog

### 3. Configure dashboards

A **dashboard** is a curated grid of entity cards. Familyboard auto-creates a default one on first connect. To customize:

- Settings → Home Assistant → **Add** (next to the dashboard selector)
- Browse / search HA entities; tap to add. Each card uses the appropriate domain control.
- Reorder by dragging the grip handle.

> TODO: screenshot of dashboard cards

### 4. Configure rooms

Rooms group entities for the touch-friendly room view at `/home-automation`:

- Settings → Home Assistant → **Manage** (next to Rooms)
- Create a room (name + icon + optional color)
- Tap **Add entities** on each room card and pick the relevant lights / switches / sensors

> TODO: screenshot of /settings/homeassistant/rooms

### 5. Optional: configure the energy dashboard

If you have solar / battery / grid sensors in HA, Familyboard can render a live energy-flow diagram + 24h / 7d / 30d / 1y charts:

- Settings → Home Assistant → **Configure** (next to Energy)
- Map your power-W and energy-kWh sensors to the slots: Solar, Battery (charge/discharge), Grid (import/export), Home consumption
- Set tariffs per kWh for cost calculations
- Toggle **Show on screensaver** if you want the screensaver to surface live solar production

![Energy dashboard — live flow diagram + power chart + battery insights](images/energy-flow-diagram.png)

The energy backend uses HA's `/api/history/period` and `/api/statistics` endpoints; all aggregation happens in Familyboard, not in HA.

## Entity domain support

| Domain | Card |
|---|---|
| `light` | Brightness slider, color picker, on/off |
| `switch`, `input_boolean` | Toggle |
| `sensor`, `binary_sensor` | Read-only with device-class icon |
| `climate` | Set-point, mode, current temp |
| `cover` | Open/close/stop, position slider |
| `fan` | Speed slider, on/off |
| `media_player` | Play/pause/volume, source title, artwork |
| `lock` | Lock/unlock |
| `alarm_control_panel` | Arm/disarm with PIN keypad |
| `scene`, `script` | Activate button |
| `vacuum` | Start/stop/dock |
| `weather` | Current + forecast (used by widget) |
| `person`, `device_tracker` | Avatar + location label |
| `camera` | MJPEG stream (also see [[Integration-Cameras]] for non-HA cameras) |

Unsupported domains render a generic card with the raw state.

## Disconnecting

Settings → Home Assistant → **Disconnect**. All configured dashboards, rooms, and the energy config stay in the database (so you can reconnect later without redoing the work).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| **"Connection failed"** | URL or token wrong, or HA's CORS settings reject the origin. HA defaults are open enough for Familyboard but if you've tightened them, allow the Familyboard origin. |
| **State updates lag by 30s** | Familyboard uses 15 s polling for entities not on its WebSocket subscription list. If you need real-time on a specific sensor, add it to a dashboard card (those subscribe). |
| **Energy chart is blank** | Sensors not yet configured — visit `/settings/homeassistant/energy` and wire them up. Chart needs at least 24h of history. |
| **Token works in HA UI but fails here** | Long-lived tokens have a 10-year expiry; not the issue. More likely: URL must match exactly (`https://` vs `http://`, trailing slash, port). |

## Related

- [[Integration-Cameras]] — cameras direct to go2rtc, bypassing HA
- [[Themes-and-Locales]] — entity-state strings localize via `homeAutomation.entityState.*`
