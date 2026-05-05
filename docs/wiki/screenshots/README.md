# Screenshot toolchain

Automated capture of the wiki's `> TODO: screenshot` markers using a local
Kinboard demo stack seeded with anonymized prod data, with mock external
services for HA, Tesla, and cameras.

## TL;DR

```bash
# 0. one-time, requires SSH key to NAS at ~/.ssh/id_ed25519_unraid
./scripts/1-clone-prod-db.sh

# 1. start the demo stack (postgres + supabase) — slow first time, pulls images
./scripts/2-bringup.sh

# 2. restore prod dump into demo DB
./scripts/3-restore.sh

# 3. scrub PII (REQUIRED before any screenshots)
node scripts/4-anonymize.mjs

# 4. seed sample notes + todos (prod has none)
node scripts/4b-seed-extras.mjs

# 5. start webapp + mock servers
./scripts/5-bringup-app.sh

# 6. capture screenshots — kiosk-portrait + mobile, into docs/wiki/images/
npx playwright install --with-deps chromium    # first time only
npm run capture

# 7. composite mobile shots into iPhone 17 Pro frame for hero/marketing
#    (requires frames/iphone-17-pro.png — see scripts/6-frame-mobile.mjs)
node scripts/6-frame-mobile.mjs
```

## What it does

Real prod data has the right shape (event density, recipe count, message
length) that hand-seeded fixtures never quite get right. So we clone the
prod DB, anonymize it locally, and screenshot against that.

Mock external services fill in the live-data surfaces (`/home-automation`,
`/energy`, `/cameras`, `/tesla`) so all wiki pages render with believable
content even though no real HA/Tesla account is involved.

```
prod NAS                              dev machine
────────                              ───────────
  ┌─────────────────┐                 ┌──────────────────────┐
  │ kinboard-db  │                 │ docker stack         │
  │ (your prod      │ ──── pg_dump ──►│  ↓                   │
  │  Kinboard    │                 │  postgres (demo)     │
  │  install)       │                 │  ↓ restore + anonymize│
  └─────────────────┘                 │  webapp:3201         │
                                      │  mock-ha:8123        │
                                      │  mock-tesla:8124     │
                                      │  mock-go2rtc:1984    │
                                      └──────────────────────┘
                                                ↓
                                      ┌──────────────────────┐
                                      │ Playwright           │
                                      │ ↓                    │
                                      │ docs/wiki/images/    │
                                      └──────────────────────┘
```

## File layout

```
docs/wiki/screenshots/
├── README.md                   # this file
├── docker-compose.override.yml # demo overlay on the prod compose
├── demo.env(.example)          # env: PROJECT_NAME=kinboard-demo, ports, secrets
├── empty-init.sql              # placeholder to neutralize a problematic prod mount
├── package.json                # screenshot toolchain deps
├── .gitignore                  # gitignores dump/, data/, demo.env, storageState.json
├── dump/
│   ├── prod-dump.sql.gz        # pulled from NAS — gitignored, has REAL DATA
│   └── prod-schema.sql         # also from NAS, used for diffing schemas
├── scripts/
│   ├── 1-clone-prod-db.sh      # SSH to NAS + pg_dump
│   ├── 2-bringup.sh            # demo stack up (db + supabase)
│   ├── 3-restore.sh            # apply migrations + restore data
│   ├── 4-anonymize.mjs         # scrub PII (schema-aware)
│   ├── 4b-seed-extras.mjs      # add notes + todos (prod has none)
│   ├── 5-bringup-app.sh        # webapp + mocks up
│   ├── 6-frame-mobile.mjs      # composite mobile shots into iPhone 17 Pro frame
│   ├── check.sh                # diff Screenshots-needed.md vs images/
│   └── embed.sh                # replace TODO lines with image embeds
├── mocks/
│   ├── ha/                     # Mock Home Assistant: REST + WS, ~30 entities
│   ├── tesla/                  # Mock Tesla Fleet API: silver Model Y Juniper data
│   └── go2rtc/                 # nginx + a demo SVG stream
├── frames/
│   └── iphone-17-pro.png       # device frame for marketing shots (BYO asset)
├── playwright/
│   ├── playwright.config.ts    # kiosk-portrait + mobile + bootstrap projects
│   ├── helpers.ts              # killAnimations, waitForReady, snap()
│   ├── 00-bootstrap.spec.ts    # joins family once, writes storageState.json
│   ├── 10-dashboard.kiosk.spec.ts
│   ├── 10-dashboard.mobile.spec.ts
│   └── … one spec per wiki feature page
└── data/                       # demo postgres + storage volumes (gitignored)
```

## Anonymization

`scripts/4-anonymize.mjs` is schema-aware and idempotent. Per table:

| Table | Treatment |
|---|---|
| `families` | Renamed to "Demo Family", new random join code |
| `people` | Stable Faker names (same UUID → same fake name everywhere); avatars cleared |
| `devices` | Renamed; `fingerprint`, `hardware_id` cleared |
| `events` | Title replaced from a 30-template list (Doctor / Swim class / Piano lesson / …); `description` + `location` nulled; **dates shifted by a random month offset** so even calendar density doesn't match prod |
| `birthdays` | Stable Faker names |
| `recipes` | Notes nulled; titles + ingredients preserved (not PII) |
| `shopping_items`, `item_catalog` | Notes nulled; item names kept (Milch, Brot are useful) |
| `meal_plan_entries` | `free_form_name` cleared |
| `settings` | OAuth tokens + API keys + PIN hashes cleared; `home_assistant.url` rewired to `http://mock-ha:8123`; nested `tesla_config.api_url` rewired to `http://mock-tesla:8124`; **rooms_config / dashboards / energy_config / mappingRules preserved** so the demo has the same UI shape as prod |
| `push_subscriptions` | DELETED |
| `scheduled_notifications` | DELETED |

What's left after anonymization is genuinely safe to publish.

## Mocks

### Mock HA (`mocks/ha/server.js`)

Implements just enough of the HA REST + WebSocket API for Kinboard to
render `/home-automation`, `/energy`, and `/cameras`:

- `GET /api/states` — full entity list (~30 entities: lights in 4 rooms,
  climate, covers, locks, scenes, the SolarFlow energy sensors, person
  trackers, cameras)
- `GET /api/states/:id`
- `POST /api/services/:domain/:service` — accepts toggle/set commands and
  updates the in-memory entity state for visual feedback
- `GET /api/history/period` — generates believable curves: sine for solar
  (peaks at noon, zero at night), ramp for battery SoC, ±10% jitter for
  other sensors
- `GET /api/camera_proxy/<id>` — returns a labeled SVG placeholder so
  `<img>` tags render
- WebSocket `/api/websocket` — minimal `auth` + `subscribe_events` +
  `get_states` support so Kinboard's live-update path works

### Mock Tesla (`mocks/tesla/server.js`)

Returns canned state for one demo Model Y (silver, parked at "home", 67%
battery, currently charging at 11 kW). Implements:
- `POST /oauth2/v3/token` — returns a permanent demo bearer
- `GET /api/1/vehicles`, `/api/1/products`
- `GET /api/1/vehicles/:id`, `/data_request/:bucket`, `/vehicle_data`
- `POST /api/1/vehicles/:id/wake_up`, `/command/*` — accepts everything

The car render image already lives at `webapp/public/images/tesla-model-y.png`
in the main repo, so the widget renders correctly without any extra setup.

### Mock go2rtc (`mocks/go2rtc/`)

nginx with a static SVG that doubles as a demo MJPEG stream. Implements:
- `GET /api/streams` — returns 3 fake streams
- `GET /api/stream.mjpeg?src=*` — redirects to the SVG
- everything else under `/api/` returns `{}` so probes don't error

## Tracking + embedding

After `npm run capture`:

```bash
./scripts/check.sh   # report ✅ DONE / ⏳ PENDING / ⚠ ORPHAN status
./scripts/embed.sh   # replace `> TODO: screenshot of X` with ![X](images/X.png)
```

The wiki's `Screenshots-needed.md` is the source-of-truth checklist.

## Known caveats

- **iPhone 17 Pro frame asset** is BYO. Drop a free-licensed mockup PNG at
  `frames/iphone-17-pro.png` (with transparency on the screen area) before
  running `6-frame-mobile.mjs`. Sources: Mockuphone, Facebook Design
  Resources, Figma Community.
- **iOS Add-to-Home-Screen flow + native install prompt screenshots**
  cannot be captured by Playwright — those are real-device shots only.
- **The dump in `dump/prod-dump.sql.gz` contains real prod data** until
  step 4 has run against the imported copy. Don't share it.

## Re-running

The pipeline is idempotent. Re-runs are appropriate when:
- The UI changed and screenshots need refreshing → re-run from step 5
- The prod data shape changed materially → re-run from step 1
- Adding a new wiki feature page that needs new screenshots → write the
  spec, run from step 5

```bash
# Quick refresh (UI changes, same data):
docker compose --project-name kinboard-demo restart webapp
npm run capture
./scripts/embed.sh
```
