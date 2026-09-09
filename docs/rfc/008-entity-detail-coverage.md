# RFC-008 — Entity detail: a coverage matrix for every domain Home Assistant has

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-09-09 |
| **Branch** | `fix/automation-detail-sheet` |
| **Depends on** | RFC-007 (the room-by-room screen), `entity-detail-sheet.tsx`, `use-home-assistant.ts`, `/api/homeassistant/{services,history,states}` |
| **Source** | HA `core@dev` — `homeassistant/components/<domain>/{const.py,__init__.py,services.yaml}`, read 2026-09-09; the REST API contract from developers.home-assistant.io/docs/api/rest |

---

## 1. What this is for

The RFC-007 rebuild made `/home-automation` browsable room by room and, in doing
so, dropped a capability. Before it, every tile opened
`entity-detail-sheet.tsx`: a 24-hour graph, per-domain formatted attributes, and
domain actions. After it, only `media_player`, `climate` and `vacuum` are
tappable (`DETAIL_DOMAINS`, `page.tsx:89`), and they open an inline sheet that
dumps `Object.entries(detailEntity.attributes)` raw. The rich sheet is orphaned
— nothing in the app renders it.

The ask is to restore it *and* widen it: "meet all features we can deliver for
all entity types HA can have." This document is the matrix that says what "all"
means, domain by domain, with the exact service names and feature bits, so that
nobody ships a button that silently does nothing.

It is a design document. It contains no plan and no code.

---

## 2. What exists today

### 2.1 The sheet

`entity-detail-sheet.tsx` already has the skeleton worth keeping: header with a
domain/device-class icon and colour, a current-state card, an actions block, a
24h `MiniChart`, and an attributes list driven by `IMPORTANT_ATTRIBUTES` (8
domains: light, switch, sensor, climate, cover, fan, vacuum, media_player).

What it does not have:

- `renderActions()` handles `light`, `switch`, `input_boolean`, `scene`,
  `script`, `automation`; `sensor`/`binary_sensor` return `null` explicitly and
  **`default:` returns `null`**. Every other domain in this document — roughly
  forty of them — currently gets no actions at all.
- It takes `card: DashboardCard` and reads exactly one field, `card.display_name`.
  The new screen has `CatalogueItem`, not `DashboardCard`. **The prop should
  become `displayName?: string` (plus `imageUrl?: string`, which the catalogue
  has and the sheet would render better than a Lucide glyph).** Nothing else in
  the component needs `DashboardCard`.

### 2.2 The hooks, exactly as they are

`use-home-assistant.ts`. Every one of these is `useCallService` underneath, with
the same query invalidation; a "needs `useCallService`" verdict below means only
that no convenience wrapper exists, not that the call is unavailable.

| Hook | Returns | Services it wraps |
|---|---|---|
| `useCallService()` | `useMutation` — `mutateAsync({domain, service, entity_id, service_data})`, `isPending` | anything |
| `useToggleEntity()` | `toggle(entityId, currentState)`, `isPending` | `<domain>.turn_on` / `turn_off`, chosen from `currentState === "on"` |
| `useLightControl()` | `turnOn(id, {brightness?, color_temp?})`, `turnOff(id)`, `setBrightness(id, 0-255)`, `setColorTemp(id, kelvin)`, `isPending` | `light.turn_on` / `light.turn_off` |
| `useCoverControl()` | `open(id)`, `close(id)`, `stop(id)`, `setPosition(id, 0-100)`, `isPending` | `cover.open_cover` / `close_cover` / `stop_cover` / `set_cover_position` |
| `useMediaPlayerControl()` | `play`, `pause`, `stop`, `next`, `previous`, `setVolume(id, 0-1)`, `mute(id, bool)`, `selectSource(id, src)`, `isPending` | `media_player.media_play` / `media_pause` / `media_stop` / `media_next_track` / `media_previous_track` / `volume_set` / `volume_mute` / `select_source` |
| `useVacuumCommand()` | `start`, `pause`, `stop`, `returnToBase`, `setFanSpeed(id, speed)`, `isPending` | `vacuum.start` / `pause` / `stop` / `return_to_base` / `set_fan_speed` |
| `useLockControl()` | `lock(id)`, `unlock(id)`, `isPending` | `lock.lock` / `lock.unlock` |
| `useFanControl()` | `turnOn`, `turnOff`, `setSpeed(id, pct)`, `setOscillating(id, bool)`, `setPresetMode(id, mode)`, `isPending` | `fan.turn_on` / `turn_off` / `set_percentage` / `oscillate` / `set_preset_mode` |
| `useAlarmControl()` | `disarm(id, code?)`, `armHome`, `armAway`, `armNight`, `isPending` | `alarm_control_panel.alarm_disarm` / `alarm_arm_home` / `alarm_arm_away` / `alarm_arm_night` |
| `useActivateScene()` | `activate(id)`, `isPending` | `<domain>.turn_on`, domain taken from the entity id |
| `useEntityHistory(id, startTime, endTime?, {enabled})` | react-query — `data: EntityHistory \| null` | `GET /api/homeassistant/history` |

There is **no** climate hook, no valve/siren/remote/lawn_mower hook, no
number/select/text hook, no button hook, and no update hook.

### 2.3 The copy that exists

Under `homeAutomation` in `messages/{en,de,fr}.json`: `entityState`,
`lockState` (5), `hvacMode` (7), `hvacAction` (5), `alarmState` (10),
`coverState` (4), `mediaPlayerState` (6), `weatherCondition` (15),
`vacuumStatus` (7), `binarySensorState` (17 device-class pairs),
`sensorDeviceClass` (20), `domainLabels` (21), `entityDetail` (22 strings +
`attributes` 21 + `deviceClasses` 16). All three locales are at parity today.

---

## 3. Five rules the whole matrix obeys

**R1 — the reading gate, and its exceptions.** `page.tsx` will not offer a
control for an entity whose state is `undefined`, `unavailable`, `unknown` or
`""` (`NO_READING`, `hasReading`). That rule is right for devices and wrong for
a class of domains whose *resting* state is legitimately `unknown`: `button` and
`input_button` before their first press, `event` before its first event,
`image` before its first frame, `date`/`time`/`datetime`/`number`/`text` before
a value is set, and `scene` before its first activation. Applying `hasReading`
unchanged would permanently grey out the Press button on a doorbell nobody has
rung. **These domains need "no value yet" copy, not the unavailable notice, and
their actions stay enabled.** `unavailable` still disables everything, everywhere.

**R2 — feature gating.** Where a domain has an `IntFlag`, test
`((entity.attributes.supported_features ?? 0) & BIT) !== 0`. A missing
`supported_features` attribute is `0` — offer only the domain's ungated
services. Two domains gate on something other than a bitmask and are the usual
source of wrong buttons: **light brightness is not a feature bit** (it is
`supported_color_modes` being anything other than exactly `["onoff"]`), and
**climate's mode list is `hvac_modes`**, not a bit.

**R3 — history is only honest for numbers.**
`/api/homeassistant/history/route.ts` maps every sample through
`parseFloat(state)` and, on `NaN`, falls back to `state === "on" ? 1 : 0`. So a
`heat_cool`, `docked` or `locked` history arrives as a flat line at zero, and
`MiniChart` draws it as if it were data. The 24h column below therefore reads:

- `area` — the state parses as a number. Chart it.
- `band` — the state is `on`/`off` (or open/closed, locked/unlocked). A step
  band is honest; the current area chart is not.
- `none` — the state is an enum, a timestamp or free text. Omit the section
  entirely rather than draw zeros.

Note the trap this creates for `climate` and `humidifier`: the interesting
series (`current_temperature`, `current_humidity`) is an *attribute*, and the
history proxy appends `&no_attributes`. Charting them needs a different request,
not a different renderer.

**R4 — response services are unreachable through our proxy.**
`/api/homeassistant/services/route.ts` POSTs to
`${url}/api/services/${domain}/${service}` and returns `{success,
affected_entities}`. It never sends `?return_response`. Home Assistant's REST
API: *"If you don't use `return_response` when calling a service that must
return data, the API will return a 400."* Every `SupportsResponse.ONLY` service
is therefore a guaranteed 400 today — confirmed for `weather.get_forecasts`,
`todo.get_items`, `calendar.get_events` and `schedule.get_schedule`. Anything in
this matrix that would need one is marked as blocked on a proxy change, not as
unsupported by HA.

**R5 — a raw HA state never reaches the household.** `heat_cool`, `not_home`,
`above_horizon` and `armed_custom_bypass` are identifiers, not words. Every
enum-stated domain either reuses an existing namespace or gets a new one; the
Copy column says which. German is **du**, never *ihr*.

---

## 4. The matrix

`sf` = `supported_features` bit. `—` = the domain has no feature flags at all,
so nothing is gated and every service listed is always offered.

### 4.1 Core controllable domains

| Domain | State shown as | Attributes worth surfacing | Actions → service (hook) | Gate | 24h | Copy | Verdict |
|---|---|---|---|---|---|---|---|
| `light` | `entityState.on/off`, plus brightness % | `brightness`, `color_temp_kelvin`, `supported_color_modes`, `effect`, `effect_list` | `light.turn_on` / `light.turn_off` (`useLightControl`); brightness → `light.turn_on {brightness}` (`setBrightness`); colour temp → `light.turn_on {color_temp_kelvin}` (`setColorTemp`); effect → `light.turn_on {effect}` (`useCallService`) | brightness/colour: **not a bit** — `supported_color_modes ≠ ["onoff"]`, `color_temp` in the list for the temp slider. `EFFECT = 4` (`LightEntityFeature`) | band | have; + `effect` | **full** |
| `switch` | `entityState.on/off`; `device_class` `outlet`/`switch` colours the icon | `current_power_w`, `today_energy_kwh` (Tasmota-style, not standard) | `switch.turn_on` / `turn_off` (`useToggleEntity`) | — | band | have | **full** |
| `input_boolean` | `entityState.on/off` | none | `input_boolean.turn_on` / `turn_off` (`useToggleEntity`) | — | band | have | **full** |
| `fan` | `entityState.on/off` + speed % + preset | `percentage`, `percentage_step`, `preset_mode`, `preset_modes`, `oscillating`, `direction` | `fan.turn_on` / `turn_off` (`useFanControl`); `fan.set_percentage` (`setSpeed`); `fan.oscillate` (`setOscillating`); `fan.set_preset_mode` (`setPresetMode`); `fan.set_direction` (`useCallService`) | `SET_SPEED=1`, `OSCILLATE=2`, `DIRECTION=4`, `PRESET_MODE=8`, `TURN_OFF=16`, `TURN_ON=32` | band | + `speed`, `oscillate`, `direction`, `preset` | **full** |
| `cover` | `coverState` (4 keys, have) + position % | `current_position`, `current_tilt_position`, `device_class` (blind/curtain/garage/gate/shutter/awning/damper/door/shade/window) | `cover.open_cover` / `close_cover` / `stop_cover` / `set_cover_position` (`useCoverControl`); tilt → `open_cover_tilt` / `close_cover_tilt` / `stop_cover_tilt` / `set_cover_tilt_position` (`useCallService`) | `OPEN=1`, `CLOSE=2`, `SET_POSITION=4`, `STOP=8`, `OPEN_TILT=16`, `CLOSE_TILT=32`, `STOP_TILT=64`, `SET_TILT_POSITION=128` | area if `current_position` present, else band | have `open`/`close`; + `stop`, `position`, tilt trio | **full** (`SPEED=256` left out — new, near-unimplemented) |
| `lock` | `lockState` (5 keys, have) | `changed_by`, `code_format` | `lock.lock` / `lock.unlock` (`useLockControl`); `lock.open` (`useCallService`) | `LockEntityFeature.OPEN = 1` for the latch | band | have; + `openLatch` + confirm strings | **full** — see §6 |
| `media_player` | `mediaPlayerState` (6 keys, have); title/artist above it | `media_title`, `media_artist`, `entity_picture` (artwork), `volume_level`, `is_volume_muted`, `source`, `source_list`, `sound_mode`, `shuffle`, `repeat` | `media_play` (`play`) / `media_pause` (`pause`) / `media_stop` (`stop`) / `media_next_track` (`next`) / `media_previous_track` (`previous`) / `volume_set` (`setVolume`) / `volume_mute` (`mute`) / `select_source` (`selectSource`) — all `useMediaPlayerControl`; `turn_on` / `turn_off` / `shuffle_set` / `repeat_set` / `select_sound_mode` via `useCallService` | `PAUSE=1`, `VOLUME_SET=4`, `VOLUME_MUTE=8`, `PREVIOUS_TRACK=16`, `NEXT_TRACK=32`, `TURN_ON=128`, `TURN_OFF=256`, `SELECT_SOURCE=2048`, `STOP=4096`, `PLAY=16384`, `SHUFFLE_SET=32768`, `SELECT_SOUND_MODE=65536`, `REPEAT_SET=262144` | none | have media\*; + `volume`, `mute`, `source`, `shuffle`, `repeat`, `soundMode` | **partial** — `BROWSE_MEDIA=131072`, `PLAY_MEDIA=512`, `SEEK=2`, `GROUPING=524288`, `MEDIA_ANNOUNCE=1048576`, `SEARCH_MEDIA=4194304` excluded: each needs its own screen, and RFC-003 owns media browsing |
| `climate` | `hvacAction` when present, else `hvacMode` (both namespaces have all keys) — **never the raw `heat_cool`**; current temp large, target beneath | `current_temperature`, `temperature`, `target_temp_low`/`_high`, `min_temp`, `max_temp`, `target_temp_step`, `hvac_modes`, `preset_mode(s)`, `fan_mode(s)`, `swing_mode(s)`, `current_humidity`, `humidity` | `climate.set_temperature {temperature}` or `{target_temp_low, target_temp_high}`; `climate.set_hvac_mode {hvac_mode}`; `climate.set_humidity`; `climate.set_fan_mode`; `climate.set_preset_mode`; `climate.set_swing_mode`; `climate.set_swing_horizontal_mode`; `climate.turn_on` / `turn_off` — **all `useCallService`; no climate hook exists** | `TARGET_TEMPERATURE=1`, `TARGET_TEMPERATURE_RANGE=2`, `TARGET_HUMIDITY=4`, `FAN_MODE=8`, `PRESET_MODE=16`, `SWING_MODE=32`, `TURN_OFF=128`, `TURN_ON=256`, `SWING_HORIZONTAL_MODE=512`. Mode buttons come from `hvac_modes`, not a bit | none for the state (R3); a temperature chart needs an attribute series | `hvacMode`/`hvacAction` have; + `setTemperature`, `presetMode`, `fanMode`, `swingMode`; **delete `climateReadOnly`** | **full** — this is the domain the current sheet apologises for |
| `vacuum` | `vacuumStatus` (7 keys, have; HA's own `VacuumActivity` is 6 — `charging` is a vendor extra, harmless) | `battery_level`, `fan_speed`, `fan_speed_list`, `status` | `vacuum.start` / `pause` / `stop` / `return_to_base` / `set_fan_speed` (`useVacuumCommand`); `vacuum.locate`, `vacuum.clean_spot` (`useCallService`) | `PAUSE=4`, `STOP=8`, `RETURN_HOME=16`, `FAN_SPEED=32`, `LOCATE=512`, `CLEAN_SPOT=1024`, `START=8192`. `TURN_ON=1`/`TURN_OFF=2`/`STATUS=128` are deprecated on `StateVacuumEntity` — do not offer them | none | have start/pause/return; + `stop`, `locate`, `cleanSpot`, `fanSpeed` | **full** (`SEND_COMMAND=256`, `MAP=2048`, `CLEAN_AREA=16384` excluded — vendor-specific payloads) |
| `humidifier` | `entityState.on/off` + `action` (`humidifying`/`drying`/`idle`/`off`) | `current_humidity`, `humidity` (target), `mode`, `available_modes`, `min_humidity`, `max_humidity` | `humidifier.turn_on` / `turn_off` / `toggle`; `humidifier.set_humidity {humidity}`; `humidifier.set_mode {mode}` — `useCallService` | on/off and `set_humidity` ungated; `MODES = 1` for the mode picker | band | + `humidifierAction` (4 keys) | **full** |
| `water_heater` | `waterHeaterOperation` — the state *is* the operation mode (`eco`, `electric`, `performance`, `high_demand`, `heat_pump`, `gas`, `off`) | `current_temperature`, `temperature`, `operation_list`, `away_mode`, `min_temp`, `max_temp` | `water_heater.set_temperature`, `set_operation_mode`, `set_away_mode`, `turn_on` / `turn_off` — `useCallService` | `TARGET_TEMPERATURE=1`, `OPERATION_MODE=2`, `AWAY_MODE=4`, `ON_OFF=8` | none | + `waterHeaterOperation` (7 keys), `awayMode` | **full** |
| `valve` | reuse `coverState` — the four states are identical (`open`/`opening`/`closed`/`closing`) | `current_position`, `device_class` (`water`/`gas`) | `valve.open_valve` / `close_valve` / `stop_valve` / `set_valve_position` — `useCallService` | `OPEN=1`, `CLOSE=2`, `SET_POSITION=4`, `STOP=8` | area if positioned, else band | reuse `coverState`, `open`, `close` — **no new state keys** | **full** — gas valves: see §6 |
| `lawn_mower` | `lawnMowerActivity` (`mowing`/`docked`/`paused`/`returning`/`error`) | `activity` | `lawn_mower.start_mowing` / `pause` / `dock` — `useCallService` | `START_MOWING=1`, `PAUSE=2`, `DOCK=4` | none | + `lawnMowerActivity` (5 keys) | **full** — see §6 |
| `siren` | `entityState.on/off` | `available_tones` | `siren.turn_on`, `siren.turn_off` — `useCallService` | `TURN_ON=1`, `TURN_OFF=2` | band | + `sirenOn`, `sirenOff`, confirm strings | **partial** — `TONES=4`, `VOLUME_SET=8`, `DURATION=16` deliberately left out; a wall panel is not a siren console. See §6 |
| `remote` | `entityState.on/off` + current activity | `current_activity`, `activity_list` | `remote.turn_on {activity}`, `remote.turn_off`, `remote.toggle` — `useCallService` | `ACTIVITY = 4` for the activity picker | band | + `activity` | **partial** — `send_command`, `learn_command` (`=1`), `delete_command` (`=2`) excluded: free-text IR payloads belong in HA, not on a hallway screen |
| `alarm_control_panel` | `alarmState` (10 keys, have) | `code_format` (`number`/`text`), `code_arm_required`, `changed_by` | `alarm_arm_home` / `alarm_arm_away` / `alarm_arm_night` / `alarm_disarm` (`useAlarmControl`, takes `code`); `alarm_arm_vacation`, `alarm_arm_custom_bypass` (`useCallService`) | `ARM_HOME=1`, `ARM_AWAY=2`, `ARM_NIGHT=4`, `ARM_CUSTOM_BYPASS=16`, `ARM_VACATION=32`. **`alarm_disarm` has no bit** — always present | none | have `alarmState`; + keypad copy, `codeRequired`, `wrongCode` | **partial** — `alarm_trigger` (`TRIGGER=8`) excluded outright: a panic button any passer-by can press. See §6 |

### 4.2 Actionable helpers and "one thing happens" domains

| Domain | State shown as | Attributes | Actions → service | Gate | 24h | Copy | Verdict |
|---|---|---|---|---|---|---|---|
| `scene` | **not** the raw ISO string — "Last activated 18:42", or "Never activated" when `unknown` (R1) | none useful | `scene.turn_on` (`useActivateScene`) | — | none | have `activateButton`; + `lastActivated`, `neverActivated` | **full** |
| `script` | `entityState.on/off` as "Running" / "Idle" | `last_triggered`, `mode`, `current` | `script.turn_on` (run), `script.turn_off` (stop) | — | none | have `activateButton`; + `stopButton`, `running` | **full** |
| `automation` | on/off as "Enabled" / "Disabled" | `last_triggered`, `mode`, `current`, `id` | `automation.trigger` (send `skip_condition: true` explicitly — it is HA's default and worth being explicit about), `automation.turn_on` / `turn_off` (`useToggleEntity`) | — | none | have trigger/enable/disable | **full** |
| `button` | "Last pressed 18:42" / "Never pressed" — the state *is* an ISO timestamp | `device_class`: only `identify`, `restart`, `update` | `button.press` | — | none | + `pressButton`, `lastPressed`, `neverPressed` | **full** — R1 exception, and see §6: this domain carries no semantics |
| `input_button` | as `button` | none | `input_button.press` | — | none | shares `button` copy | **full** |
| `number` | value + `unit_of_measurement`, device-class formatted | `min`, `max`, `step`, `mode` (`auto`/`box`/`slider`), `device_class` | `number.set_value {value}` | — | **area** | + `setValue` | **full** — render `mode: slider` as a slider, `box` as a stepper |
| `input_number` | as `number` | `min`, `max`, `step`, `mode` | `input_number.set_value {value}`; `increment` / `decrement` | — | area | shares `number` copy | **full** |
| `select` | the current option verbatim (it is author-defined text, already human) | `options` | `select.select_option {option}`; `select_next` / `select_previous` | — | none | + `selectOption` | **full** |
| `input_select` | as `select` | `options` | `input_select.select_option {option}` | — | none | shares `select` copy | **full** |
| `timer` | `timerState` (`active`/`paused`/`idle`) + a live countdown from `finishes_at` | `duration`, `remaining`, `finishes_at` | `timer.start {duration?}`, `timer.pause`, `timer.cancel`, `timer.finish` | — | none | + `timerState` (3), `start`/`pause`/`cancel`/`finish` | **full** — but RFC-004 already owns a timer widget; reuse its countdown, do not write a second one |
| `counter` | the number | `initial`, `step`, `minimum`, `maximum` | `counter.increment`, `counter.decrement`, `counter.reset`, `counter.set_value {value}` | — | **area** | + `increment`, `decrement`, `reset` | **full** |
| `date` | localised date via `Intl` | none | `date.set_value {date}` | — | none | + `setDate` | **full** |
| `time` | localised time via `useTimeFormat` | none | `time.set_value {time}` | — | none | + `setTime` | **full** |
| `datetime` | localised date+time | none | `datetime.set_value {datetime}` | — | none | shares the two above | **full** |
| `input_datetime` | localised, shape from `has_date` / `has_time` | `has_date`, `has_time`, `timestamp` | `input_datetime.set_datetime {date \| time \| datetime}` | — | none | shares the above | **full** — one picker serves all four |
| `text` | the value; **never render `mode: password`** | `min`, `max`, `pattern`, `mode` (`text`/`password`) | `text.set_value {value}` | — | none | + `editValue` | **partial** — display always; editing only for `mode: text`, behind an explicit Edit affordance, because a wall panel has no comfortable keyboard |
| `input_text` | as `text` | `min`, `max`, `pattern`, `mode` | `input_text.set_value {value}` | — | none | shares `text` copy | **partial** — same reason |
| `update` | "Update available" / "Up to date" (state is on/off), plus `installed_version → latest_version` | `installed_version`, `latest_version`, `title`, `release_url`, `release_summary`, `in_progress`, `update_percentage`, `auto_update`, `skipped_version` | `update.install {backup?, version?}`, `update.skip`, `update.clear_skipped` | `INSTALL=1`, `SPECIFIC_VERSION=2`, `PROGRESS=4`, `BACKUP=8` | none | + `updateAvailable`, `upToDate`, `installing`, `install`, `skip`, confirm strings | **partial** — `RELEASE_NOTES=16` is served by the WebSocket command `update/release_notes`, not a REST service, so it is out of reach of our proxy; show `release_summary` and link `release_url` instead. See §6 |
| `group` | whatever the members report — on/off, `home`/`not_home` — via the same label helper the members would use | `entity_id` (the member list) | `homeassistant.turn_on` / `turn_off` / `toggle` — the one service pair that works across mixed member domains | — | band when on/off | + `memberCount` | **partial** — on/off plus a member list; per-member controls belong to the room screen, not this sheet. `group.set` / `group.remove` are configuration, excluded |

### 4.3 Read-only domains

No actions at all; the value of the sheet here is formatting, attributes and (where R3 allows) the graph.

| Domain | State shown as | Attributes | 24h | Copy | Verdict |
|---|---|---|---|---|---|
| `sensor` | value + unit, formatted by `device_class`: `timestamp` → localised date/time, `monetary` → currency, `enum` → the option verbatim | `unit_of_measurement`, `device_class`, `state_class`, `last_reset` | **area** when `state_class` is set or `parseFloat(state)` is finite; `none` for `enum`/text sensors | `sensorDeviceClass` has 20 of HA's 62 device classes — extend with at least `aqi`, `atmospheric_pressure`, `distance`, `duration`, `precipitation`, `speed`, `water`, `wind_speed`, `data_size`, `frequency`, `irradiance`, `volume`, `weight`; unknown classes fall back to the attribute name | **read-only** |
| `binary_sensor` | `binarySensorState` pair chosen by `device_class` | `device_class` | **band** — a motion or door timeline is one of the most useful things on this screen | 17 of HA's 28 device classes covered. Missing: `battery_charging`, `connectivity`, `garage_door`, `occupancy`, `opening`, `power`, `running`, `safety`, `update`, `window`, `moving` | **read-only** |
| `person` | `presenceState`: "Home" / "Away", or the zone name when the state is neither `home` nor `not_home` | `source`, `device_trackers`, `latitude`/`longitude`/`gps_accuracy` (do not render coordinates on a wall) | none | + `presenceState.home` / `.away` | **read-only** — `person.reload` is administration |
| `device_tracker` | as `person` | `source_type` (`gps`/`router`/`bluetooth`/…), `battery_level`, `ip`, `mac`, `host_name` | none | shares `presenceState` | **read-only** — `device_tracker.see` is an ingest API, not a household action |
| `weather` | `weatherCondition` (15 keys, have — complete) + temperature large | `temperature`, `apparent_temperature`, `humidity`, `pressure`, `wind_speed`, `wind_bearing`, `visibility`, `uv_index` | none (state is an enum; the numbers are attributes) | have | **read-only** — the forecast is **no longer an attribute**; it comes only from `weather.get_forecasts`, which is `SupportsResponse.ONLY` and therefore a 400 through our proxy (R4). Forecast is blocked on a proxy change, not on HA |
| `sun` | `sunState`: "The sun is up" / "The sun is down", plus next sunrise/sunset as local times | `azimuth`, `elevation`, `rising`, `next_dawn`, `next_dusk`, `next_rising`, `next_setting`, `next_noon`, `next_midnight` | none | + `sunState` (2) | **read-only** |
| `calendar` | on/off as "Event now" / "Nothing on"; then the event itself | `message`, `start_time`, `end_time`, `all_day`, `description`, `location` — HA puts the *current or next* event here, which is free and worth showing | none | + `nextEvent`, `openInCalendar` | **read-only + link** — see §7 |
| `event` | "Doorbell rang at 18:42" — state is the ISO timestamp of the last event, `event_type` says which | `event_type`, `event_types`, `device_class` (`doorbell`/`button`/`motion`) | none | + `eventNever`, `eventLastAt`, event-type labels | **read-only** — R1 exception: `unknown` means "nothing yet", not "unreachable" |
| `image` | "Updated 18:42" today; the picture itself once a proxy route exists | `access_token` | none | + `imageUpdated` | **read-only** — the bytes live at `${haUrl}/api/image_proxy/<entity_id>?token=…`; the browser cannot reach that without going through us, same gap as `camera` |
| `zone` | "2 people here" — the state is literally the count of persons inside | `persons` (the names — show these), `latitude`, `longitude`, `radius`, `passive` | none (numeric, but a chart of "how many people were in the garden" is noise) | + `peopleHere` (pluralised) | **read-only** |
| `schedule` | on/off as "On now" / "Off", plus `next_event` | `next_event` | band | + `scheduleOnNow` | **read-only** — `schedule.get_schedule` is response-only (R4), so the week's shape is out of reach |
| `air_quality` | the AQI number | `particulate_matter_2_5`, `particulate_matter_10`, `carbon_dioxide`, `carbon_monoxide`, `ozone`, `nitrogen_dioxide` | area | none — the default renderer covers it | **read-only** — legacy domain (`quality_scale: internal`), superseded by `sensor` with `pm25`/`pm10`/`aqi` device classes. Lowest priority in this document |
| `camera` | `recording` / `streaming` / `idle` | `entity_picture`, `frontend_stream_type`, `motion_detection` | none | + `openInCameras` | **partial** — offer `camera.turn_on` / `camera.turn_off` when `ON_OFF = 1`; show a still only once an image-proxy route exists; **`STREAM = 2` live view is excluded** and links to `/cameras`. See §8 |

### 4.4 Deliberately excluded

| Domain | Why |
|---|---|
| `todo` | Kinboard owns `/todos` and `/einkaufen`. The items are not in the entity attributes at all — the state is just the count of incomplete items, and `todo.get_items` is `SupportsResponse.ONLY` (R4). Even the read is blocked. Show the count and link out; see §7 |
| `notify` | `notify.send_message` sends to somebody's phone. A screen in a hallway that anybody walks past must not be a send-message console, and RFC-005 already owns messaging to and from the screen |
| `tts` | `tts.speak` makes the house talk. Same reasoning, louder |
| `assist_satellite` | `announce`, `start_conversation`, `ask_question` — same |
| `conversation` | `conversation.process` is a text-in/text-out API, not a device control |
| `stt` | No services at all; nothing to render |

---

## 4.5 Decisions taken

Two things the matrix left to the maintainer, settled 2026-09-09:

**Scope: core first, long tail after.** This branch delivers the regression fix
and the domains a household here actually meets — the sheet freed from
`DashboardCard` and opened from every entity tile, the shape-based default case
of §5, the history classification of R3, the `hasReading` exceptions of R1, and
full support for `light`, `sensor`, `switch`, `input_boolean`, `fan`, `lock`,
`cover`, `media_player`, `climate`, `vacuum`, `binary_sensor`, `scene`,
`script`, `automation`, `alarm_control_panel` and `humidifier`. The helpers
(`number`, `select`, `text`, the date/time family, `counter`, `timer`), the
read-only exotica (`person`, `device_tracker`, `sun`, `zone`, `schedule`,
`event`, `image`, `air_quality`, `group`) and `update`, `siren`, `remote`,
`valve`, `lawn_mower`, `water_heater` follow in a second branch, against this
same matrix.

The default case is what makes that split honest: an unlisted domain in phase
one is not a blank screen, it is a state, its attributes and — where the value
is on/off — one working control. The follow-up upgrades domains from *good* to
*specific*, rather than from nothing to something.

**Confirmations: all seven of §6.** `lock.unlock`, `lock.open`,
`alarm_disarm`, `siren.turn_on`, every `button.press` / `input_button.press`,
`update.install`, and `lawn_mower.start_mowing` each get a confirmation step
naming the entity. `button.press` is the one that decides the shape: the domain
carries no semantics at all, so the sheet genuinely cannot know whether it opens
the garage or restarts Home Assistant, and the prompt must therefore quote the
entity's own name rather than describe the action.

Requiring the alarm code was offered and not taken; `alarm_disarm` gets the same
confirmation as the rest.

---

## 5. The default case

This matters more than any single domain in the matrix. Home Assistant has
hundreds of domains and custom integrations invent more, so whatever the sheet
does with a domain it has never heard of is what it does most often in the
field.

**Today it does nothing.** `renderActions()` falls through to `default: return
null` and `IMPORTANT_ATTRIBUTES[domain]` is `undefined → []`, so an unknown
entity renders a header, a raw state string, an empty attributes section, and a
24h chart of `parseFloat` fallbacks — often a flat line at zero (R3). That is
not "no support", it is a screen that looks broken.

The fallback should key off the **shape of the value**, not the domain name:

1. **State.** If `parseFloat(state)` is finite → format as a number with
   `unit_of_measurement`. If it matches ISO 8601 → render as a localised date
   and/or time. If it is exactly `on`/`off` → `entityState.on/off`. Otherwise
   render the string once, unchanged. `unavailable`/`unknown` →
   `homeAutomation.unavailable`.
2. **Attributes.** Show *all* of them — this is the one place the current thin
   sheet is better than the rich one — minus a denylist of plumbing:
   `friendly_name`, `icon`, `supported_features`, `entity_picture`,
   `attribution`, `editable`, `id`, `assumed_state`, `restored`, `device_class`
   and `unit_of_measurement` when already used above, and anything starting with
   `_`. Humanise the key (`current_position` → "Current position"), join arrays,
   put objects behind a disclosure rather than `JSON.stringify` into the row.
3. **Actions.** `supported_features` is meaningless without knowing the domain's
   flag enum, so never guess at bits. Offer exactly one thing, and only when the
   state is exactly `on` or `off`: `homeassistant.turn_on` / `turn_off`. That
   service pair is the one HA guarantees across any domain with on/off
   semantics, and it is what `group` uses for mixed members.
4. **History.** Chart only if the state parses as a number. Otherwise omit the
   section — do not render "No history data available" for an entity whose
   history is fine and simply is not a number.
5. **Tone.** The fallback should not apologise or say "unsupported device type".
   A household reading it should not be able to tell that this domain was not on
   a list.

The same rule applies to `domainLabels`, which currently covers 21 domains: an
unknown domain gets its id with underscores replaced and the first letter
capitalised, not the word "Unknown".

---

## 6. Dangerous and irreversible actions

This screen is a wall panel. It has no login, no per-person identity, and a
child can reach it. These are recommendations for the maintainer to accept or
reject, not decisions:

| Action | Risk | Recommendation |
|---|---|---|
| `lock.unlock`, `lock.open` | Unlocks the front door; `lock.open` throws the latch, which on many locks cannot be undone remotely | **Recommend a confirmation step.** `lock.open` in particular — locking again does not retract a thrown latch |
| `alarm_control_panel.alarm_disarm` | Disarms the house alarm | **Recommend requiring the code** when `code_format` is set (`useAlarmControl` already accepts one), and a confirmation when it is not. A panel that disarms on one tap is a hole in the alarm |
| `alarm_control_panel.alarm_trigger` | Sets the siren off deliberately | **Recommend excluding entirely** — already excluded above |
| `siren.turn_on` | Wakes the street; some sirens have no remote off | **Recommend a confirmation step** |
| `button.press` / `input_button.press` | The domain carries *no* semantics. `device_class` offers only `identify`, `restart`, `update`; the entity behind it may be "Open garage", "Restart Home Assistant", "Unlock car" or "Reset water filter", and the sheet cannot tell | **Recommend a confirmation step for every `button` press**, with the entity's own name in the prompt. This is the domain where a wrong guess is unbounded |
| `update.install` | Irreversible, can take a device offline for minutes, and on a panel mid-install there is no way to stop it | **Recommend a confirmation step**, showing `installed_version → latest_version`, and pre-ticking `backup` when `BACKUP = 8` is set |
| `lawn_mower.start_mowing` | Starts blades in a garden that may have a child or a pet in it | **Recommend a confirmation step** |
| `valve.open_valve` where `device_class: gas` | Opens a gas valve | **Recommend a confirmation step** for `gas`; `water` needs none |
| `vacuum.start`, `cover.open_cover` on `device_class: garage`/`gate` | Moving machinery, but visible, slow and reversible from the same screen | **No confirmation** — the friction would cost more than it buys |

One shared confirm dialog with the entity's display name in the body serves all
of these; the recommendation is about *which* rows opt in, not about building
nine dialogs.

---

## 7. Domains that duplicate a Kinboard screen

`todo` and `calendar` both have a Kinboard screen already: `/todos` (plus
`/einkaufen` and `/shopping`) and `/calendar`. Reimplementing add/complete/remove
against HA inside this sheet would give the household two list UIs over
different data that disagree with each other — and, as noted in R4, we cannot
even *read* the items without a proxy change.

**Recommendation: link, do not reimplement.** For `todo`, show the count of
incomplete items (the state) and a link to `/todos`. For `calendar`, show the
current-or-next event that HA already puts in the attributes, then link to
`/calendar`. The same argument applies to `camera` and `/cameras`, and to
`timer` and the RFC-004 timer widget.

---

## 8. Poor fits for a sheet on a wall display

- **`camera` live streams.** `CameraEntityFeature.STREAM = 2` means HLS or
  WebRTC. A modal that opens a live stream on a permanently-on panel burns
  bandwidth and battery on whatever is behind it, and Kinboard has `/cameras`
  for exactly this. Still frames and on/off only.
- **`notify`, `tts`, `assist_satellite`, `conversation`, `stt`.** Covered in
  §4.4 — every one of them is an action *aimed at a person elsewhere*, initiated
  from a screen with no identity.
- **`media_player` browse and search.** `BROWSE_MEDIA = 131072` and
  `SEARCH_MEDIA = 4194304` are a file-picker's worth of UI inside a sheet.
- **Free-text entry generally** (`text`, `input_text`, `remote.send_command`).
  There is no keyboard in a hallway.

---

## 9. Copy to be added

All three of `en`, `de`, `fr`, at parity. German is **du**.

**New namespaces under `homeAutomation`:** `humidifierAction` (4),
`lawnMowerActivity` (5), `waterHeaterOperation` (7), `presenceState` (2),
`sunState` (2), `timerState` (3), `valveState` — **not needed, reuse
`coverState`**.

**Extend existing namespaces:** `sensorDeviceClass` (+13 or so of HA's 62),
`binarySensorState` (+11 device-class pairs), `domainLabels` (+~28: `button`,
`input_button`, `number`, `input_number`, `select`, `input_select`, `text`,
`input_text`, `valve`, `siren`, `remote`, `lawn_mower`, `update`, `sun`,
`timer`, `counter`, `date`, `time`, `datetime`, `input_datetime`, `todo`,
`calendar`, `event`, `image`, `group`, `zone`, `schedule`, `air_quality`).

**Extend `entityDetail`:** action labels (`stopButton`, `pressButton`,
`openLatch`, `locate`, `cleanSpot`, `install`, `skip`, `increment`,
`decrement`, `reset`, `setValue`, `selectOption`, `editValue`, `setTemperature`,
`presetMode`, `fanMode`, `swingMode`, `awayMode`, `activity`, `volume`, `mute`,
`source`, `soundMode`, `shuffle`, `repeat`, `effect`, `stop`, `position`, tilt
trio); status wording (`lastPressed`, `neverPressed`, `lastActivated`,
`neverActivated`, `running`, `updateAvailable`, `upToDate`, `installing`,
`nextEvent`, `eventNever`, `eventLastAt`, `imageUpdated`, `peopleHere`,
`memberCount`, `noValueYet`); links (`openInTodos`, `openInCalendar`,
`openInCameras`); and the shared confirm dialog (`confirmTitle`, `confirmBody`,
`confirmAction`, `cancel`).

**Delete:** `entityDetail.climateReadOnly` in all three locales — it exists only
to apologise for the gap this document closes.

---

## 10. Open questions

1. **Should the services proxy forward `?return_response`?** Four features in
   this matrix (weather forecast, todo items, calendar event list, schedule
   shape) are blocked on nothing else. It is a small change to
   `/api/homeassistant/services/route.ts` and it widens what any future screen
   can read.
2. **Is an image proxy route worth it** for `camera` stills and `image`
   entities, or does linking to `/cameras` cover the household's actual need?
3. **How far does R1 go?** Relaxing `hasReading` per-domain is a real exception
   to a rule that was added deliberately (see the long comment at
   `page.tsx:94`). The alternative — leaving `button` greyed out until somebody
   presses it physically — is worse, but the exception list should be explicit
   in code, not implicit in a `switch`.
4. **Which domains actually get a tile?** This document says what the *sheet*
   can do. `DETAIL_DOMAINS` currently admits three domains; every domain with a
   non-empty Actions column above is a candidate, and that is a separate
   decision about the room screen.
