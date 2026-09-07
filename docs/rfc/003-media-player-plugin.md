# RFC-003 — Media player plugin

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-09-07 |
| **Target release** | unscheduled |
| **Depends on** | the plugin contract (`src/plugins/types.ts`), the Home Assistant integration |
| **Source** | Brainstorm, 2026-09-07 |

---

## 1. What this is for

A wall panel in a kitchen should be able to show what is playing and do
something about it.

### Correction: what already exists

An earlier draft of this section said Kinboard "knows nothing about media". That
was wrong, and it was wrong in a way worth recording, because it was written
after searching for a media *plugin* and finding none — while the functionality
sat under Home Assistant all along. It surfaced during implementation, when a
reviewer mentioned one of these by name in passing.

Two things are already here:

- **`useMediaPlayerControl`** (`src/hooks/use-home-assistant.ts`) — play, pause,
  stop, next, previous, setVolume, mute, selectSource. That is the same command
  surface this RFC's driver layer needs.
- **`MediaPlayerCard`** (`src/components/home-assistant/cards/media-player-card.tsx`,
  227 lines) — artwork, transport, a volume `Slider`, a source picker,
  dispatched by entity domain from `entity-card.tsx`.

Both belong to the **Home Assistant dashboard**: they take that dashboard's card
config and a raw HA entity, and they render inside its grid. They are not a
media surface of their own — there is no page, no dashboard widget, no concept
of a configured player that outlives an entity, and nothing that could ever
speak UPnP.

### How this RFC relates to them

This adds a media player as a **surface plugin**, in the shape `vehicles`
already proves: a driver interface, several drivers behind it, a page, a
settings screen and an optional dashboard widget.

**The two layers stay separate, deliberately.** `useMediaCommand` in the plugin
does not delegate to `useMediaPlayerControl`, even though their command lists
overlap almost exactly today. The plugin's layer is driver-agnostic on purpose:
M2 adds UPnP and Frontier Silicon drivers that cannot route through a hook built
on Home Assistant's `callService`, so collapsing them now buys tidiness in M1
and has to be undone in M2.

The honest cost is that a household with Home Assistant has two code paths
controlling the same speaker until M2 lands, and a reviewer meeting this fresh
will reasonably call it duplication. If M2 is ever abandoned, the right move is
to delete the plugin's command layer and delegate — not to keep both.

`MediaPlayerCard` and the plugin's `PlayerCard` are separate components for the
same reason — different data source, different surface — but the plugin's card
reuses the existing one's `Slider`, icon set and visual idiom. Two media cards
in one app that look like they came from different products would be a worse
outcome than either duplication.

### Decisions taken

Four questions were settled before design; they are recorded because each one
narrows what follows.

1. **Devices come from both Home Assistant and native protocols**, from the
   first release. Not HA alone.
2. **The dashboard widget follows activity** — it shows whatever is playing,
   one device at a time, and is absent when nothing is.
3. **Full control is in scope**, including sources and browsing, not just
   transport.
4. **The widget stays absent when idle.** Starting playback is done from the
   page. The wall panel can pause what someone else started; it is not a
   launcher.

Decision 3 is the expensive one and is the reason capabilities are declared
rather than assumed — see §4.

---

## 2. Architecture

### 2.1 Drivers are split in half

Native protocols need UDP multicast, SOAP and raw HTTP against LAN addresses. A
browser can do none of that. So every driver has:

- a **server half** — protocol I/O in `/api/media-players/*` route handlers,
  Node runtime, never edge;
- a **client half** — React components that see only normalised JSON.

The Home Assistant driver is the exception: it already proxies through
`/api/homeassistant`, so its server half is thin.

### 2.2 One state shape

```ts
type MediaPlayerState = {
  status: "playing" | "paused" | "idle" | "off" | "unavailable";
  title?: string; artist?: string; album?: string; artworkUrl?: string;
  position?: number; duration?: number; positionUpdatedAt?: string;
  volume?: number; muted?: boolean;
  source?: string; sourceList?: string[];
  capabilities: Capability[];
};

type Capability =
  | "transport" | "next" | "seek" | "volume" | "mute"
  | "sources" | "browse" | "playUrl";
```

`positionUpdatedAt` exists so the progress bar **interpolates locally** from
the last known position. Three devices polled at 1Hz to animate a moving bar is
traffic a wall panel does not need.

### 2.3 Polling

The widget shows whatever is playing, which means something has to know that
without being asked. Two rates:

- **every configured device, every 10s** — enough to notice that something
  started, cheap enough for a handful of devices;
- **the device currently on screen, every 2–3s** — enough for volume and track
  changes to feel immediate.

Position is never the reason to poll: it is interpolated from
`positionUpdatedAt` (§2.2). A device that is `unavailable` backs off to 60s.

This is adequate for a household with a handful of players and would not be for
dozens. If that ever bites, the fix is HA's WebSocket state stream (§5.1) rather
than a faster poll — the same connection browsing needs.

### 2.4 Capabilities are state, not configuration

`capabilities` is in the state payload, not a static property of the driver,
because it is genuinely dynamic: a Frontier Silicon radio can seek inside a
podcast and not in live DAB, and reports different capabilities minute to
minute. The UI draws a control **only** when the current state claims it.

This is what keeps decision 3 honest. Full control across three protocols that
disagree deeply about what a "source" or a "library" is only works if a driver
can say "not me" per command, per moment, without anybody faking a response.

---

## 3. Data model

A `media_players` table mirroring `vehicles`:

| column | notes |
|---|---|
| `id` | uuid |
| `family_id` | uuid, not null |
| `position` | int, ordering on the page |
| `driver` | text — `home_assistant`, `upnp`, `frontier_silicon` |
| `nickname` | text, not null |
| `config` | jsonb, driver-specific |
| `created_at` / `updated_at` | timestamps |

Naming and ordering therefore survive a driver swap. **Credentials do not go in
`config`** — the Frontier Silicon PIN, an LG pairing key, a Plex token all
belong in `integration_secrets`, the same lesson the settings PIN taught this
repo when it lived in an anon-readable table.

---

## 4. Discovery and autoconfiguration

**Constraint that shapes everything here:** the webapp runs on a Docker bridge
network (`NetworkMode=kinboard_kinboard` in production). SSDP and mDNS are UDP
multicast to the LAN, and that traffic does not leave the bridge. A naive "Scan"
button finds nothing on most installations. This is almost certainly why the
DLNA photo source asks for a pasted address rather than offering a scan.

So there are three tiers, and only the first is real autoconfiguration today.

**Tier 1 — Home Assistant.** `useHomeAssistantEntities("media_player")` already
returns every player HA knows about, discovered and named. Each entity carries a
`supported_features` bitmask that maps directly onto `Capability`, so the driver
derives capabilities from the device rather than guessing. Nothing to build.

**Tier 2 — native discovery, deferred.** Needs a network path we do not have.
Host networking on the webapp would break the Traefik setup. The right shape is
an optional **discovery sidecar** with `network_mode: host` doing SSDP and mDNS
and handing results over HTTP — but it is a new container in everyone's compose
file, so it ships after the plugin works, not with it.

**Tier 3 — manual add, always present.** Paste an IP or description URL. Works
everywhere, needs no infrastructure. For Frontier Silicon the default PIN
(`1234` on most UNDOK devices) is probed, so "manual" is one field and a tap.

### 4.1 Deduplication

Choosing both device sources means one physical speaker can legitimately appear
twice — a Frontier Silicon radio as `media_player.*` from HA and again natively;
likewise a Sonos.

Devices are keyed on stable identity (HA `entity_id`, UPnP `UDN`) with IP held
only as a cache, re-resolved on failure — that is what stops a device breaking
when DHCP moves it. Where a native candidate plausibly matches an existing HA
entity the two are **grouped and confirmed by the user**, with HA recommended.

Never silently merge. Two drivers for one speaker is confusing but the user can
see and fix it; a silent merge that picks the worse driver is neither visible
nor fixable.

---

## 5. Drivers in the first release (M1–M2)

| capability | Home Assistant | UPnP renderer | Frontier Silicon |
|---|---|---|---|
| now playing + artwork | attributes | `GetPositionInfo` → DIDL | `netRemote.play.info.*` |
| transport | yes | AVTransport | `play.control` |
| seek | if flagged | yes | not on live radio |
| volume / mute | yes | RenderingControl | yes |
| sources | `source_list` | **none — no such concept** | modes (DAB/FM/Spotify/AUX) |
| browse | see §5.1 | via a paired server | `netRemote.nav.*` + presets |

### 5.1 The Home Assistant browse capability is the expensive part

HA exposes `media_player/browse_media` over its **WebSocket API only**. The REST
API has no equivalent, and Kinboard talks to HA purely over REST today
(`/api/states`, `/api/services`). Browsing an Apple TV's library therefore means
adding a WebSocket client to the HA integration.

That is new infrastructure, not a driver detail, and it is the single largest
cost in this RFC. Everything else in the HA driver is wiring to hooks that
already exist. **It is the one item that could reasonably be cut from a first
release**, leaving browse unsupported for HA devices and drawn only for
Frontier Silicon.

### 5.2 UPnP has no renderer-side browsing, by design

A UPnP renderer cannot browse; browsing lives on a ContentDirectory *server*,
which is a different device. The driver's browse capability therefore means
"pair this speaker with a media server you have already configured", reusing
`dlna-client.ts` almost wholesale.

`parseDeviceDescription` needs widening to find `AVTransport` and
`RenderingControl` alongside `ContentDirectory`. The SOAP envelope helpers
generalise unchanged.

### 5.3 Frontier Silicon is reverse-engineered

FSAPI was never published. Firmware differs between badge-engineered radios, and
one working UNDOK proves nothing about someone's Hama. The driver ships with a
"tested against" list and degrades to now-playing-only when an expected call is
absent.

---

## 6. Later drivers

Cheap precisely because the capability interface exists. In order:

1. **Sonos** — verify it rides the UPnP driver. `node-sonos` is essentially
   UPnP AVTransport with conveniences, so this is likely a config entry rather
   than a driver. High value: Sonos is overrepresented in exactly the
   households that mount a tablet in a kitchen.
2. **Roku** — ECP is plain HTTP on port 8060; `roku-client` maintained
   (2026-02). The largest install base we can actually reach.
3. **Kodi and Jellyfin** — trivial HTTP APIs, high overlap with self-hosters.
4. **LG webOS** — `lgtv2` maintained (2026-09); needs a pairing flow.

**Deferred with reasons, so nobody re-investigates:**

- **Chromecast** — ~15% of streaming devices plus much of Android TV's ~40% of
  smart-TV OS share, but the JS ecosystem is frozen: `castv2-client` last
  published 2016. High value, real work, not "easy".
- **Amazon Echo / Fire TV** — no local control API exists. HA's support is an
  unofficial HACS component. Permanently HA-only.
- **Apple TV / HomePod** — AirPlay 2 and Companion are unpublished. Every
  JavaScript library is a fork of one 2013-era AirPlay 1 project
  (`airplay-js` last published 2016). `pyatv` is the only serious
  implementation, it is Python, and Home Assistant already wraps it.
  Permanently HA-only unless we ship pyatv as a sidecar.

---

## 7. UI surfaces

**Dashboard widget.** Absent when nothing plays — the rule the attention panel
already follows, and what earns it its space. When something starts it becomes
that device: artwork, title, artist, interpolated progress, transport controls
at the 44px touch target the accessibility audit settled on. Two things playing
at once, the most recently started wins — measured as the first poll in which we
observed the device as `playing`, held per device for the session, since not
every driver reports a start time. A chip row switches between them. Needs a
`mediaPlayer` key in `WidgetVisibility`.

**Artwork proxy — not optional.** HA's `entity_picture` is a relative path
needing the access token; UPnP artwork sits on a LAN address the browser may not
reach. `/api/media-players/[id]/artwork` fetches server-side and caches. Without
it artwork is broken for both major drivers.

**The page (`/media`) is the remote.** Configured devices as cards — now
playing, controls, volume, source picker — and tapping one opens its detail with
browse. Nav gating copies vehicles: the item appears only once a device exists,
so nothing changes for households that never configure one.

**Settings (`/settings/media-players`).** List with reorder, rename and hide;
add-player flow per §4; the dedup grouping from §4.1.

**Browse is one uniform tree** — `{ id, title, type, artworkUrl, playable }` —
with each driver mapping its own concept in. Drivers lacking the capability do
not draw the button.

---

## 8. Failure handling

A wall display must not shout.

- An unreachable device is `status: "unavailable"`: the card dims and keeps its
  name. No toast, no red.
- **Per-device isolation.** A driver that throws takes out its own card and
  nothing else. One dead radio cannot blank the widget or the page.
- **Short timeouts** (2–3s, reusing the `EXTERNAL_TIMEOUT_MS` convention in
  `attention/external-signals.ts`). A kitchen panel that hangs on a powered-off
  amplifier is worse than one that says nothing. Polling backs off once a device
  is unreachable.
- **Commands are optimistic with rollback** and a quiet inline mark on failure
  — not a modal, on a screen nobody is standing at.

---

## 9. Testing

Most of this is pure and testable without a device:

- `supported_features` bitmask → `Capability[]`
- DIDL-Lite and FSAPI response parsing
- state normalisation per driver
- the dedup heuristic in §4.1

**A shared driver contract suite** is the important piece: one set of "given
this raw payload, produce this state" cases that every driver must pass, so a
new driver is proven against the same bar rather than its author's
understanding of it. Fixtures are captured once from real hardware and replayed;
no live devices in CI.

Two browser-level guards, run under **WebKit as well as Chromium**:

1. the widget is absent when idle and present when playing;
2. **controls appear only for declared capabilities** — the guard that stops the
   capability system rotting into "draw everything and hope".

---

## 10. Out of scope

- The discovery sidecar (§4, tier 2) — after the plugin works.
- Chromecast, Echo, Apple native support (§6).
- Multi-room grouping. It needs a room concept Kinboard does not have, and the
  chosen widget behaviour (one device at a time) does not require one.
- Starting playback from the dashboard (decision 4).

## 11. Delivery order

This RFC is too large for a single implementation plan. Three increments, each
shippable on its own:

**M1 — one driver, read and control.** Home Assistant driver, the
`media_players` table, the artwork proxy, the dashboard widget and the `/media`
page with transport, volume and sources. No browsing, no native drivers. This
alone covers every device in a household that runs HA, which is most of them.

**M2 — native drivers.** UPnP renderer and Frontier Silicon, manual add, the
dedup grouping. Proves the driver interface against protocols that disagree,
which is the thing M1 cannot prove on its own.

**M3 — browsing.** The HA WebSocket client (§5.1), the uniform tree, the browse
UI, and the Frontier Silicon nav lists. The largest and most cuttable piece.

Each gets its own plan. M1 is the one to write first.

## 12. Open risks

- **The HA WebSocket client (§5.1)** is the largest single cost and the most
  likely thing to slip. Cutting it costs HA browsing only.
- **Frontier Silicon firmware variance (§5.3)** cannot be tested away; the
  mitigation is graceful degradation, not coverage.
- **Bridge networking (§4)** means native discovery does not work for most
  installations until the sidecar exists. Manual add must therefore be a
  first-class path, not a fallback nobody polished.
