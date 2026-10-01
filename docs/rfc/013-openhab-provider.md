# RFC-013 — openHAB as a second home provider

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-10-01 |
| **Target release** | unscheduled — phase 1 is worth doing on its own; phases 2+ wait for demand (§11) |
| **Depends on** | RFC-001 (Integration API), RFC-003 (media drivers), RFC-006 (device catalogue), RFC-007 (rooms), RFC-008 (entity detail, dangerous actions), RFC-011 (assistant actions, on `feat/mcp-integration-api`) |
| **Source** | Survey of `main` at `940b009` and `feat/mcp-integration-api`; openHAB core sources (`openhab-core@main`) and docs at openhab.org, read 2026-10-01 |

---

## 1. What this is for

Kinboard's smart-home side is Home Assistant all the way down; an openHAB
household gets an Automation screen it cannot use. This RFC proposes (1) a
**"home provider" seam** with HA as provider #1 and no behaviour change — worth
doing whether or not openHAB ships, since the coupling spans ~63 files and
RFC-011 is about to add a safety policy written in HA's domains and services —
and (2) an **openHAB adapter** behind it. A design document; no code.

---

## 2. What exists today

### 2.1 On `main`

Counted at `940b009`. "Files" means files under `webapp/src` that import
`@/types/home-assistant` or call `/api/homeassistant/*`: **63**.

| Area | Where | Size | HA-specific in what way |
|---|---|---|---|
| Cards per HA domain | `components/home-assistant/cards/*` — alarm, camera, climate, cover, fan, generic, light, lock, media-player, person, scene, sensor, switch, vacuum, weather | 15 files, 2,632 lines | each takes an `HAEntity` and reads HA attribute names (`brightness` 0–255, `current_position`, `hvac_modes`, `supported_features`) |
| Detail, actions, pickers, charts | `components/home-assistant/*.tsx` — `entity-actions` (1,664), `entity-detail-sheet` (677), `entity-browser`, `entity-selector`, `dangerous-action-gate`, energy/power/battery charts | 16 files, ~5,200 lines | domain switch statements, service names |
| Service calls | `useCallService` and its wrappers in `hooks/use-home-assistant.ts` (1,406 lines, 11 control hooks); call sites in `floating-lights-fab`, `switch-control-item`, `climate-card`, `generic-card`, `entity-actions`, `dangerous-action-gate`, `use-media-player-state` | 64 call sites in 10 files | `{domain, service, entity_id, service_data}` |
| Domain from id | `entity_id.split(".")[0]` and `startsWith("light.")` style checks | 20 sites in 9 files | assumes HA's `domain.object` shape |
| State reads | `useHomeAssistantEntityStates` → `GET /api/homeassistant/states`, polled every 15 s (`POLL_MS`, `lib/home-assistant-optimism.ts`) on `/home-automation`, 30–60 s elsewhere | — | **no push today**: Kinboard has never subscribed to HA's event stream |
| WebSocket | `lib/ha-websocket.ts` (148) — one `browse_media` command per connection, for RFC-003 browsing only | 1 file | HA protocol |
| Session routes | `app/api/homeassistant/{route,states,services,history,statistics,camera}` | 6 routes, 874 lines | proxy to HA REST with the family's token |
| Settings and setup | `settings/homeassistant` (634), `…/rooms` (520), `…/energy` (6), `setup/homeassistant` (118), `settings/catalogue` (795), `api/catalogue/import-rooms` (259, HA template API `areas()`) | — | URL + long-lived token; HA areas |
| Screens | `app/home-automation/page.tsx` (1,026) | — | HA states |
| Plugins | energy `generic-ha-energy.tsx` (1,454), vehicles `tesla.tsx` (1,575) and `generic-ev.tsx` (474) + `entity-read.ts`, media `drivers/home-assistant.ts` (154). Cameras use go2rtc and do **not** touch HA. | — | entity ids in config, HA history/statistics |
| Server-side readers | `lib/attention/external-signals.ts`, `api/setup/state`, `api/media-players/*` | — | read HA directly |
| Danger list | `lib/ha-dangerous-actions.ts` — 9 `domain.service` keys (`lock.unlock`, `lock.open`, `alarm_control_panel.alarm_disarm`, `siren.*`, `button.press`, `input_button.press`, `update.install`, `lawn_mower.start_mowing`) | 139 lines | HA service names |

**Credentials.** `settings` row `key='home_assistant'` holds `url` and
non-secret config; `access_token` lives in `integration_secrets` and reaches
the browser only as `SECRET_SENTINEL` (`lib/integration-secrets.ts`,
`SECRET_FIELDS`). The token never leaves the server. Any second provider must
reuse this exactly.

**Stored HA ids** (from `webapp/docker/migration*.sql`, 52 files):

| Where | What |
|---|---|
| `catalogue_items.entity_id` with `kind = 'ha_entity'` | the catalogue (RFC-006); unique on `(family_id, entity_id)` |
| `settings.home_assistant → energy_config` | ~20 entity ids for the energy plugin |
| `vehicles.config` (jsonb) | entity ids per car |
| `media_players` | `driver CHECK (driver IN ('home_assistant'))`, entity id in `config` |
| `settings.home_assistant → rooms_config, dashboards` | legacy copies kept by RFC-006/007, read by nothing |
| `cameras` setting | no HA ids |

### 2.2 On `feat/mcp-integration-api` (unmerged, 84 commits)

`webapp/src/lib/home/` adds ~2,100 lines that RFC-011 relies on:

| File | Lines | HA assumption |
|---|---|---|
| `policy.ts` | 308 | `ALLOWED_SERVICES` keyed by HA domain → service; `ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/`; sensitivity `always / never / unless_blind / unless_outlet` decided from HA `device_class` |
| `catalogue.ts` | 86 | `kind = 'ha_entity'` and the `ENTITY_ID` regex, re-checked in code |
| `ha-client.ts` | 232 | `GET /api/states`, `POST /api/services/{domain}/{service}` |
| `devices.ts` | 362 | `HomeDeps` (an injectable seam already), attribute whitelist of HA names |
| `action-requests.ts` | 754 | `assistant_action_requests.{entity_id, domain, service, data}`; `kind` (`home`, `pocket_money`) with handlers |
| `live.ts` | 58 | wires `HomeDeps` to the HA client |

`HomeDeps` is already a provider seam in all but name: the routes never call
HA directly. And because `catalogue.ts` re-checks ids against `ENTITY_ID`, **an
openHAB item name (no dot, mixed case) is filtered out today** — the branch
fails closed for a provider it does not know, which is right until §7 lands.

### 2.3 The reverse direction

`kinboard-homeassistant` (HACS, MIT, ~2,960 lines of Python) polls
`/api/integration/v1/{info, family/summary, events, calendar/events, lists/*}`
every 60 s with a bearer token and exposes calendar, todo, sensor and
binary_sensor platforms plus services that write back through
`/lists/{list}` and `/services/{service}`.

---

## 3. openHAB, as far as it affects this

Sources are listed in §13. Versions 4.x and 5.x behave the same for everything
below unless noted.

**Items, not entities.** An Item has a `name` (`[a-zA-Z_0-9]+`, case-sensitive,
no dot), a `type`, a `state`, a `label`, `tags`, `groupNames`, and metadata.

| Item type | State | Commands it accepts |
|---|---|---|
| Switch | `ON` / `OFF` | OnOff |
| Dimmer | `0`–`100` | OnOff, IncreaseDecrease, Percent |
| Color | `H,S,B` | OnOff, IncreaseDecrease, Percent, HSB |
| Rollershutter | `0`–`100`, **0 = open, 100 = closed** | UpDown, StopMove, Percent |
| Number / Number:\<Dimension\> | decimal / quantity with unit (`21.5 °C`) | Decimal / Quantity |
| Contact | `OPEN` / `CLOSED` | none (read-only) |
| String | text | String |
| DateTime | ISO timestamp | DateTime |
| Player | `PLAY` / `PAUSE` | PlayPause, NextPrevious, RewindFastforward |
| Location | `lat,lon[,alt]` | Point |
| Image | raw bytes, base64 in REST | none |
| Group | derived from members (optional base type and function) | forwarded to **every member** |

**State and command descriptions.** An item may carry a *state description*
(pattern, min/max/step, read-only flag, options: value → label) and a *command
description* (command options: command → label). These are how openHAB says
"this String accepts `HEAT`, `COOL`, `OFF`" or "this Number is 5–30 in 0.5
steps". Option labels are localised by `Accept-Language` on `/rest/items`.

**The semantic model.** Optional, household-maintained tags in three trees plus
properties: **Location** (`Room`, `Kitchen`, `Floor` …), **Equipment**
(`Lightbulb`, `Lock`, `GarageDoor`, `Blinds`, `Thermostat`, `PowerOutlet`,
`AlarmSystem`, `Siren`, `CleaningRobot`, `MediaPlayer`, `Camera` …), **Point**
(`Control`, `Switch`, `Setpoint`, `Measurement`, `Status`, `Alarm`) and
**Property** (`Temperature`, `Light`, `ColorTemperature`, `Opening`, `Presence`,
`SoundVolume`, `Power` …). `core.semantics/model/SemanticTags.csv` has 267
tags. An item's `tags` carry the short name (`Lightbulb`); the `semantics`
metadata namespace carries the full id (`Equipment_LightSource_Lightbulb`,
`Location_Indoor_Room`, `Point_Control_Switch`, `Property_Temperature`) and
the relations `hasLocation`, `isPartOf`, `isPointOf`, `relatesTo`. Locations
and Equipment are Group items; Points are plain items inside them. **A physical
lamp is therefore usually an Equipment group of several items** (a Switch, a
Dimmer, a colour-temperature Dimmer), where HA has one entity with attributes.

**REST.**

- `GET /rest/items?recursive=false&fields=name,type,state,label,tags,groupNames,stateDescription,commandDescription&metadata=semantics`
  — the whole model in one call; `type=` and `tags=` filter.
- `GET /rest/items/{name}/state` — `text/plain` state.
- `POST /rest/items/{name}` with `Content-Type: text/plain`, body `ON`, `50`,
  `UP`, `21 °C` — a command. `PUT …/state` is a state *update*, which bypasses
  the device; Kinboard must never use it.
- `POST /rest/rules/{uid}/runnow` — run a rule's actions. openHAB has no
  service registry like HA's `script.*`/`scene.*`; behaviour lives in rules,
  triggered by item changes or this endpoint. Main UI **Scenes** are rules
  tagged `Scene`, run the same way.
- `GET /rest/persistence/items/{name}?starttime=&endtime=&serviceId=` — history,
  from whichever persistence service is configured (rrd4j is the default).

**Live updates.** `GET /rest/events?topics=openhab/items/*/statechanged` is a
Server-Sent Events stream whose `payload` is a JSON string
`{type, value, oldType, oldValue}`. Newer and better suited:
`GET /rest/events/states` opens a stream whose first `ready` event carries a
connection id; `POST /rest/events/states/{connectionId}` with a JSON array of
item names sets which items it tracks, and each event is a map of name →
`{state, displayState, type}`. That second form lets the server subscribe to
exactly the catalogue and nothing else. Both send an `alive` event every 10 s.

**Auth.** API tokens are created per user on the Main UI profile page,
prefixed `oh.`, sent as `Authorization: Bearer oh.…` (or as the Basic username
with an empty password, or `X-OPENHAB-TOKEN`). Username/password Basic auth
works only with `allowBasicAuth` enabled. Commands and `runnow` need the `user`
role — and **`implicitUserRole` defaults to true, so an unauthenticated LAN
request gets that role**: an out-of-the-box openHAB accepts commands with no
token at all (§6.3).

**CORS** is off unless `org.openhab.cors` is configured, and irrelevant: the
token stays server-side, as HA's does. **myopenHAB** (the openHAB Cloud
connector) proxies an instance without opened ports; whether it holds
long-lived SSE connections is unverified (§11).

**Locks and alarms** have no item type of their own. A lock is a Switch
(conventionally `ON` = locked — the binding's choice) in an Equipment tagged
`Lock`; an alarm is a Switch or String in an `AlarmSystem` Equipment, arm
modes as command options. Alarm codes are not modelled.

---

## 4. The home provider seam (phase 1)

### 4.1 The interface

```ts
interface HomeProvider {
  id: "ha" | "openhab";
  testConnection(): Promise<{ ok: true; name: string; version: string } | { ok: false; error: string }>;
  listDevices(): Promise<HomeDevice[]>;                    // for pickers and the catalogue
  getStates(ids: readonly string[]): Promise<Map<string, HomeDevice>>;
  getState(id: string): Promise<HomeDevice | undefined>;
  command(id: string, command: HomeCommand): Promise<{ ok: boolean; status: number }>;
  history(id: string, from: Date, to: Date): Promise<HistoryPoint[] | null>;
  importRooms?(): Promise<{ room: string; deviceIds: string[] }[]>;
  subscribe?(ids: readonly string[], onChange: (d: HomeDevice) => void): () => void;   // phase 4
}
```

Server-side only. One instance per family per request, built from the family's
settings and secret, exactly as `ha-client.ts` builds its connection now. The
MCP branch's `HomeDeps` becomes a thin wrapper over it.

### 4.2 The normalised device

| Field | Meaning |
|---|---|
| `id` | **`<provider>:<native id>`** — `ha:light.kitchen`, `openhab:Kitchen_Light`, `openhab:rule:morning-scene`. Computed, never stored (§4.4). |
| `kind` | `light`, `switch`, `outlet`, `cover`, `climate`, `lock`, `alarm`, `sensor`, `binary_sensor`, `media_player`, `fan`, `vacuum`, `activator` (scene/script/rule/button), `camera`, `person`, `other` |
| `tags` | provider-neutral hints that decide sensitivity: `garage`, `gate`, `door`, `window`, `blind`, `outlet`, `siren`, `mower` … (§7) |
| `state` | normalised: `on`/`off`, `open`/`closed`/`opening`/`closing`, `locked`/`unlocked`/`jammed`, `armed_home`/`armed_away`/`disarmed`/`triggered`, `playing`/`paused`/`idle`, a number with unit, or `unavailable`. **Never** a raw provider string. |
| `attributes` | typed, Kinboard-named: `brightnessPct`, `colorTempK`, `rgb`, `positionPct` (100 = open, always), `currentTemp`, `targetTemp`, `hvacModes`, `volume`, `mediaTitle`, `unit`, `deviceClass` |
| `capabilities` | what `command` will accept for this device right now: a set of command types, with ranges (`setTargetTemp: {min, max, step}`) — the RFC-003 `Capability` idea generalised |
| `label` | the provider's name for it (the catalogue's `name` still wins on screen) |
| `raw` | the provider's object, for cards not yet migrated. Removed when the last one is. |

`HomeCommand` is a discriminated union, one member per thing a person can do:
`turnOn`, `turnOff`, `toggle`, `setBrightness(pct)`, `setColorTemp(kelvin)`,
`setColor(rgb)`, `open`, `close`, `stop`, `setPosition(pct)`, `setTargetTemp`,
`setHvacMode`, `mediaPlay`/`Pause`/`Stop`/`Next`/`Previous`, `setVolume`,
`mute`, `selectSource`, `setFanSpeed(pct)`, `lock`, `unlock`, `openLatch`,
`arm(mode)`, `disarm`, `activate`, `press`, `vacuumStart`/`Pause`/`Dock`,
`mowerStart`/`Dock`. Each adapter translates; the HA adapter's translation
table is today's `ALLOWED_SERVICES` turned inside out, so the HA calls on the
wire are byte-for-byte what they are now.

### 4.3 How the app consumes it

- **Session routes** `GET /api/home/states`, `POST /api/home/command`,
  `GET /api/home/history` replace the six `/api/homeassistant/*` routes (kept
  as aliases for a release). `command` is validated against `capabilities`,
  closing the gap RFC-011 §6 noted in `/api/homeassistant/services`.
- **Hooks.** `useHomeDevices(ids)` and `useHomeCommand()` replace
  `useHomeAssistantEntityStates` and `useCallService`; the 11 control hooks
  become one-liners. Polling and `POLL_MS` are unchanged.
- **Cards** move to `components/home/cards/<kind>-card.tsx` one at a time,
  reading `capabilities`, never `supported_features`. Weather and the HA
  camera card stay HA-only on `raw` (§6.4).
- **Plugins.** Energy and the generic EV driver need "a number with a unit",
  which `vehicles/entity-read.ts` already reduces HA entities to. Tesla stays
  HA-only (`tesla_custom`). Media already has a driver registry (RFC-003);
  openHAB would be a second driver.
- **Danger gate.** `ha-dangerous-actions.ts` keys become `(kind, command)`, so
  the screen's confirmation and the assistant policy (§7) share one vocabulary.

### 4.4 Stored ids: no rewrite

```sql
ALTER TABLE public.catalogue_items
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'ha'
  CHECK (provider IN ('ha', 'openhab'));
DROP INDEX IF EXISTS catalogue_items_family_entity_idx;
CREATE UNIQUE INDEX IF NOT EXISTS catalogue_items_family_provider_entity_idx
  ON public.catalogue_items (family_id, provider, entity_id) WHERE entity_id IS NOT NULL;
```

Existing rows become `provider = 'ha'` by default and keep their native
`entity_id`; the §4.2 `id` is `provider || ':' || entity_id`, computed on read.
Nothing is rewritten, so nothing can be lost, and the statement is idempotent
(migrations here run twice). `kind = 'ha_entity'` keeps its value, read as "a
provider device" — renaming a CHECK value buys nothing.

Other stores follow only when their plugin gains a second provider:
`media_players.driver` gains `'openhab'` (DROP + ADD CONSTRAINT, as its comment
says); `vehicles.config` and `energy_config` gain an optional `provider` key,
absent meaning `ha`. On the MCP branch, `assistant_action_requests` gains
`provider` (default `'ha'`) and `command` jsonb; `domain`/`service` stay for HA
rows. The `home_assistant` settings key is untouched; openHAB gets its own
(`openhab`, secret field `api_token` in `SECRET_FIELDS`).

### 4.5 Rooms and live updates

Rooms stay Kinboard's (RFC-007); `importRooms` only *suggests* them — HA's
template call, or openHAB's semantic Locations (§6.2) — once, never as a sync
(RFC-006 §3.3). Phase 1 keeps polling: Kinboard has never had push from HA, so
streaming would be new behaviour, not a refactor. `subscribe` waits for phase 4.

---

## 5. One provider per family

**Recommendation: one at a time.** A family picks Home Assistant *or*
openHAB in setup; switching is possible and leaves the other provider's
catalogue rows in place, shown as unavailable (the RFC-006 §6 rule for a
vanished entity).

Households running both usually bridge them already (MQTT, or both
integrating the same devices), so "both" would mostly show the same lamp twice.
One provider gives every failure message, the setup wizard, the rooms import
and `list_home_devices` one answer instead of a merge, and gives the
sensitivity policy (§7) one source of truth per household. Rows are
provider-tagged anyway, so allowing both later is a settings change.

---

## 6. The openHAB adapter (phase 2)

### 6.1 Building a device

1. Read the model once: `GET /rest/items?…&metadata=semantics` (§3).
2. **An Equipment group is one device.** Its kind comes from the Equipment
   tag; its points are the items whose `isPointOf` is that group, and each
   point's role comes from its Point + Property tags.
3. **An untagged item, or a Point outside any Equipment, is its own device**,
   with a kind from its item type alone (table 6.1b).
4. Group items without an Equipment tag (`gLights`, `gAll`) are **not
   devices**. A command to a group fans out to every member, which the
   catalogue boundary cannot see (the same reason RFC-011 refuses `area_id`).

**6.1a — Equipment tag → kind**

| Equipment tag (and children) | Kind | Points used |
|---|---|---|
| `LightSource`, `Lamp`, `Lightbulb`, `LightStripe` | light | Switch / Dimmer / Color with `Light`; Dimmer or Number with `ColorTemperature` |
| `PowerOutlet` | outlet | Switch with `Power` or untagged |
| `Blinds`, `WindowCovering` | cover, tag `blind` | Rollershutter |
| `GarageDoor` / `Gate` / `Door` / `Window` | cover or binary_sensor, tag `garage` / `gate` / `door` / `window` | Rollershutter or Switch (control), Contact with `Opening` (status) |
| `Thermostat`, `HVAC` | climate | Number:Temperature `Setpoint`+`Temperature`; `Measurement`+`Temperature`; String with command options as modes |
| `Fan` | fan | Switch, Dimmer |
| `Lock` | lock | Switch (control), Contact or Switch (status) |
| `AlarmSystem` | alarm | Switch (arm/disarm) or String with options (modes) |
| `Siren` | switch, tag `siren` | Switch |
| `Speaker`, `Receiver`, `MediaPlayer`, `Screen`, `Television` | media_player | Player, Dimmer `SoundVolume`, Switch (power), String (title) |
| `CleaningRobot` | vacuum | binding-specific String commands — see 6.4 |
| `LawnMower` | other, tag `mower` | binding-specific |
| `Camera` | camera | Image (snapshot) only |
| anything else | other | each point shown as a sensor or switch |

**6.1b — Item type alone → kind and commands**

| Item type | Kind | Commands sent (`POST /rest/items/{name}`) |
|---|---|---|
| Switch | switch | `turnOn`→`ON`, `turnOff`→`OFF`, `toggle`→read then send |
| Dimmer | light if tagged `Light`, else switch | `setBrightness(p)`→`p`, on/off as Switch |
| Color | light | `setColor(rgb)`→`H,S,B`, `setBrightness`→`p` |
| Rollershutter | cover | `open`→`UP`, `close`→`DOWN`, `stop`→`STOP`, `setPosition(p)`→`100−p` |
| Number:Temperature with `Setpoint` | climate | `setTargetTemp(t)`→`t °C` (unit from the state, so °F works, unlike RFC-011 §4) |
| Number, Number:\<Dim\> | sensor | none |
| Contact | binary_sensor | none |
| String with command options | other | the options, verbatim |
| String without | sensor | none |
| Player | media_player | `PLAY`, `PAUSE`, `NEXT`, `PREVIOUS` |
| DateTime | sensor | none |
| Switch with `Presence` | person | none (home / away only) |
| Location | — | **never read** (RFC-002: no location) |
| Image | camera | none |
| Rule (from `/rest/rules`, tag `Scene` or chosen by hand) | activator | `activate`→`POST /rest/rules/{uid}/runnow` |

`toggle` has no openHAB command; it is read-then-write, and the adapter says so
(`capabilities` includes it, at the cost of a race the HA version does not
have). `setPosition` inverts because openHAB's 0 is open; Kinboard's
`positionPct` is HA's convention, 100 = open, and the inversion lives in the
adapter only.

### 6.2 Rooms

Semantic Locations become room suggestions: each Location group whose tag is
`Room` or a child of it (`Kitchen`, `Bedroom`, `LivingRoom` …) is a room, named
by its label, containing every device whose `hasLocation` resolves to it
(walking `isPartOf` up from sub-Equipment). Floors and outdoor Locations are
not rooms. An install with no semantic model offers nothing to import, and
rooms are typed, as they are for an HA install without areas.

### 6.3 Connection settings and setup

`setup/openhab` and `settings/openhab` mirror the HA pages: URL, API token, and
a **Test** calling `GET /rest/` (version) and `GET /rest/items?fields=name`.
The token goes through `integration_secrets` with the sentinel. The setup step
"Do you use Home Assistant?" becomes "Which smart home do you use?". If the test
*also succeeds without the token* (`implicitUserRole` at its default), the page
says that anyone on the LAN can command this house. Username/password is a
fallback only where `allowBasicAuth` is on, stored like a token.

### 6.4 What does not map

| Kinboard feature | Why not |
|---|---|
| Vacuum card (start/pause/dock, fan speed) | no standard vacuum item model; each binding names its own String commands. Shown as `other` with its command options. |
| Media browsing (RFC-003 M3) | no browse API in openHAB. Transport, volume and source only. |
| Weather card | weather bindings produce plain Number items; they show as sensors. |
| HA camera proxy / live view | no camera stream in the item model. Image snapshots only; live video stays with the go2rtc camera plugin, which is provider-independent. |
| Alarm codes | not modelled in openHAB, and refused by the assistant policy anyway. Arm/disarm only. |
| Lock `openLatch` | only if the binding exposes a separate point; usually absent. |
| HA long-term statistics (energy plugin daily bars) | computed from persistence instead, which needs a persistence service storing the item; rrd4j's default retention is coarse. |
| Tesla driver | built on HA's `tesla_custom` entity set. |
| Lock polarity | `ON` = locked is a convention, not a rule. The adapter uses the state description's option labels when present; a per-device "inverted" flag is an open question (§11). |

---

## 7. The assistant layer in neutral terms (phase 3)

RFC-011's boundary does not change: catalogue only, an allowlist, live
sensitivity, PIN confirmation on a household screen, fail closed. What changes
is the vocabulary it is written in.

**`policy.ts` keys on `(kind, command)`, not `(domain, service)`.** The table
becomes:

| Kind | Commands | Sensitive |
|---|---|---|
| light | turnOn, turnOff, toggle, setBrightness, setColorTemp, setColor | |
| outlet | turnOn, turnOff, toggle | |
| switch | turnOn, turnOff, toggle | **always** |
| fan, climate, media_player, vacuum | as RFC-011 §4 | |
| cover | open, close, stop, setPosition | **unless tagged `blind`** |
| lock | lock, unlock, openLatch | **always** |
| alarm | arm, disarm | **always** |
| activator | activate, press | **always** |
| siren / mower tags | any | **always** |

For HA this is a re-expression: the adapter derives `outlet` from `switch` +
`device_class: outlet`, `blind` from the six harmless cover classes,
`activator` from scene/script/button/input_button, and maps `input_boolean` to
`switch` — the decisions `isSensitive` makes today. `e2e/home-policy.spec.ts`
must pass unchanged against the HA adapter before anything else moves.

**For openHAB, "sensitive" is decided from the semantic model, read live:**

- the Equipment the item belongs to is `Lock`, `AlarmSystem`, `Siren`,
  `Door`, `GarageDoor`, `Gate`, `Window`, `LawnMower` or `Valve` → always;
- a Rollershutter is harmless only inside `Blinds`/`WindowCovering`; an
  untagged Rollershutter asks (garage openers are often Rollershutters);
- a Switch is harmless only inside `PowerOutlet` or a `LightSource`; an
  untagged Switch asks — the openHAB equivalent of HA's "Show as";
- every rule (`activate`) asks: a rule can do anything;
- a String item's command options always ask, because their meaning is the
  binding's;
- **Group items are never commandable** by an assistant (§6.1);
- the tags are read from openHAB at call time; a tag in the request is ignored.

Default-deny is the point: a thinly tagged install gets PIN prompts, and the
fix is tagging in openHAB — the trade RFC-011 made for unclassified HA covers.

**Elsewhere on the branch:** `catalogue.ts` validates ids per provider
(`ENTITY_ID` for HA; `[a-zA-Z_0-9]+` or `rule:<uid>` for openHAB);
`devices.ts` returns neutral `id`, `kind` and command names;
`action-requests.ts` stores `provider` and `command` and re-checks the stored
command on approval, as now. PIN confirmation, the 2-minute expiry,
deny-without-PIN and the per-assistant budgets are untouched. The MCP tools are
unreleased: if phase 1 is ready first, ship them neutral; otherwise add neutral
names alongside later — assistants re-read tool schemas every session.

---

## 8. openHAB reading Kinboard (out of scope; a later phase)

| Option | Cost | Verdict |
|---|---|---|
| A Kinboard binding (Java/OSGi, openHAB add-on marketplace) | a second codebase in a third language, openHAB's review process, a release train per openHAB major | not credible for the demand we can show |
| **HTTP binding + JSONPATH** against the Integration API (RFC-001) | a documented `.things` / `.items` example: `Authorization: Bearer kbi_…` header, `GET /api/integration/v1/family/summary` polled every 60 s, JSONPATH channels for next event, open tasks, shopping count; a `POST /lists/shopping` command channel | **recommended** — no new Kinboard code, the scopes already exist |
| MQTT (Kinboard publishes to the household's broker) | a broker client, retained topics, reconnection, a new outbound credential | only if Kinboard ever publishes for other reasons |

Recommendation: a wiki page and an example `kinboard.things` / `kinboard.items`
using the HTTP binding, written after phase 2 and tested against the same
openHAB container (§10). It is a day or two, and it is out of scope here.

---

## 9. Phasing

| Phase | What | Effort (focused days) | Ships behaviour? |
|---|---|---|---|
| **0** | Land `feat/mcp-integration-api` (RFC-010/011/012) as it is | — (existing work) | yes, unrelated to this RFC |
| **1** | Provider seam, HA only: interface, normalised device, `/api/home/*` routes, hooks, cards one by one, danger gate on `(kind, command)`, `catalogue_items.provider`, `lib/home/*` on the merged branch re-expressed in kinds | **10–14** | **no** — HA wire calls identical |
| **2** | openHAB adapter: settings, setup, token storage, model reader, mappings 6.1a/b, catalogue picker, rooms import, polling, commands, history via persistence | **8–12** | yes, behind the provider choice |
| **3** | Assistant policy for openHAB (§7) | **3–4** | yes |
| **4** | Live updates: a server-held `/rest/events/states` subscription per family limited to catalogue items, fanned out to screens; optionally HA's `subscribe_entities` for parity | **4–6** | yes — faster screens for both |
| **5** | Plugins on demand: generic EV and energy readings from openHAB items; media driver `openhab` | **3–5 each** | yes |

**What to build first, and the explicit recommendation:** land the MCP branch
first, unchanged. Phase 1 is a refactor across ~63 files and 64 call sites;
doing it while 84 unmerged commits sit on `lib/home/*` guarantees a painful
rebase in the one area where a mistake opens a door. Then **do phase 1 whether
or not openHAB is ever built**: it gives the session `services` route the
validation it lacks, puts the screen's danger gate and the assistant policy on
one vocabulary, replaces 20 ad-hoc `split(".")[0]` domain checks with a typed
`kind`, and makes RFC-008's per-domain matrix a per-kind one. Phases 2–3 start
only if §11's demand question comes back positive.

---

## 10. Testing

- **Unit specs, with fakes.** The policy stays pure and imported by the
  Playwright specs. A `FakeProvider` with counting stubs serves
  `home-routes.spec.ts` and `assistant-actions.spec.ts`, so every "the provider
  was never called" assertion carries over. The openHAB mapping runs against
  recorded `GET /rest/items` fixtures: a well-tagged install, one with no
  semantic model, a Group of mixed members, a Rollershutter at 0 and at 100.
- **A real openHAB in Docker for e2e** — `openhab/openhab` pinned to a 4.x and
  a 5.x tag as a CI service; the first real smart-home backend in CI (HA is
  only stubbed today). There is no demo *add-on*: the demo is the
  `openhab-demo` distribution's `conf/`, fine as a smoke test but shallowly
  tagged (Switches carry only `Light`; no Lock, AlarmSystem or GarageDoor), so
  it cannot exercise §7. The suite mounts **our own `kinboard-test.items`**
  covering every row of 6.1a/b, unbound so `autoupdate` reflects commands; a
  user and token are created at start via the Karaf console (`openhab:users`).
- **Prove each guard fails:** untag the garage door and see the assistant
  request go pending; put a Switch tagged `Power` inside a `Lock` Equipment and
  see it stay sensitive, because the Equipment decides. WebKit for any card
  whose layout moves.

---

## 11. Risks and open questions

- **Demand is unknown.** No issue has asked for openHAB. The poll is open as
  Discussion #305 ("Would you use Kinboard with openHAB?", opened 2026-10-01,
  no votes yet); give it a month and read the comments for which device
  kinds people want first. Phase 1 does not depend on the answer.
- **Two providers is a permanent cost.** Every new card, RFC-008 row and
  assistant capability needs two mappings and two sets of tests. Writing
  features against `kind`s limits the code cost, not the testing cost, and
  the openHAB side will lag.
- **Parity expectations.** openHAB households will compare against the HA
  screenshots; §6.4 belongs in the wiki on day one.
- **Model quality decides the experience.** An untagged install gets a flat
  item list and a PIN prompt on most switches — safe, and it will read as
  "Kinboard is annoying".
- **Localisation.** Item labels are the household's own words and are not
  translated; option labels and `displayState` follow `Accept-Language`.
  Kinboard sends the family's locale, translates normalised states itself and
  shows option labels verbatim. Mixed-language screens are likely.
- **Lock polarity** (§6.4): use state-description options, add a per-device
  "inverted" flag, or both?
- **myopenHAB as the URL**: does its proxy keep `/rest/events/states` open for
  hours? If not, phase 4 falls back to polling for those installs.
- **`implicitUserRole`**: warn only (proposed), or refuse to save a connection
  to an openHAB that accepts commands without a token?
- **Rules as catalogue rows**: every rule, only those tagged `Scene`, or only
  those the household picks? Proposed: picked by hand, Scenes listed first.

---

## 12. Out of scope

Both providers in one family (§5); an openHAB binding (§8); sitemaps, HABPanel,
Things/Channels administration; any write to the openHAB model; Location items.

---

## 13. Sources

Docs (openhab.org): [items](https://www.openhab.org/docs/concepts/items.html),
[item configuration, state/command descriptions](https://www.openhab.org/docs/configuration/items.html),
[semantic model](https://www.openhab.org/docs/tutorial/model.html),
[REST](https://www.openhab.org/docs/configuration/restdocs.html),
[API tokens](https://www.openhab.org/docs/configuration/apitokens.html),
[scenes](https://www.openhab.org/docs/tutorial/rules_scenes.html),
[persistence](https://www.openhab.org/docs/configuration/persistence.html),
[openHAB Cloud](https://www.openhab.org/addons/integrations/openhabcloud/),
[Docker](https://www.openhab.org/docs/installation/docker.html),
[HTTP binding](https://www.openhab.org/addons/bindings/http/),
[JSONPATH](https://www.openhab.org/addons/transformations/jsonpath/).

Source (`github.com/openhab/openhab-core`, `main`): `core.semantics/model/SemanticTags.csv`;
`SemanticsMetadataProvider.java`, `SemanticTagRegistryImpl.java` (relations, tag ids);
`ItemResource.java` (items, `fields`, `metadata`, `Accept-Language`);
`SseResource.java` (`/rest/events`, `/rest/events/states`); `AuthFilter.java`
(`oh.` prefix, `allowBasicAuth`, `implicitUserRole`); `CorsFilter.java`;
`RuleResource.java` (`runnow`); `PersistenceResource.java`. Demo config:
`openhab-distro/distributions/openhab-demo`.
