# Architecture

A 30,000-foot view of how the pieces fit together. Read this once before you change anything non-trivial.

## Shape

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Wall display    │    │  Phone / tablet  │    │  Desktop browser │
│  (Edge --kiosk)  │    │  (PWA)           │    │                  │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                          ┌──────▼──────┐
                          │   Traefik   │  ← reverse proxy, optional
                          │   (HTTPS)   │
                          └──────┬──────┘
                                 │
                  ┌──────────────┴───────────────┐
                  │                              │
          ┌───────▼────────┐            ┌────────▼────────┐
          │  Next.js app   │            │  Supabase Kong  │
          │  (port 3001)   │            │  (port 8100)    │
          │                │            │                 │
          │  /pages        │            │  /rest    /auth │
          │  /api/* routes │            │  /storage /realt│
          └───────┬────────┘            └────┬───────┬────┘
                  │                          │       │
                  │ server-side reads        │       │ websocket
                  │ via Kong (internal)      │       │
                  └──────────────────────────┴───────┘
                                                    │
                                          ┌─────────▼──────────┐
                                          │     PostgreSQL     │
                                          │    + Realtime      │
                                          │    + Storage       │
                                          └────────────────────┘
```

## Frontend stack

- **Next.js 14** with the **App Router**. Almost all pages are client components (`"use client"`) because the dashboard is interactive end-to-end.
- **shadcn/ui** primitives + **Tailwind CSS**. Components live in `webapp/src/components/ui/` (don't modify directly) and `webapp/src/components/` (project-specific).
- **TanStack Query** for server state (cached, background-refetched, optimistic updates). Hooks live in `webapp/src/hooks/`.
- **Zustand** for ephemeral client state — currently just `family-store.ts` for the active family + device.
- **next-intl** for i18n. Cookie-based locale switching, no `[locale]` URL prefix. EN + DE shipped; see [Themes](Themes) for adding more.
- **Framer Motion** for the slide/fade transitions across pages.

## Data flow

1. **All data is family-scoped.** A `family_id` UUID gates every row via [Row-Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security). See [Database-Schema](Database-Schema).
2. **Devices join families via 6-character join codes.** Stored in `families.join_code`. Auth model is "device fingerprint + join code" — see [Security-and-Threat-Model](Security-and-Threat-Model).
3. **Real-time updates** use Supabase Realtime (Postgres logical replication → WebSocket). The hook `use-realtime.ts` subscribes to a table and the relevant TanStack Query cache invalidates automatically.
4. **Server-side data access** uses two Supabase clients:
   - `createClient()` — anon-key client, RLS-enforced, used inside API routes that should respect family scoping
   - `createAdminClient()` — service-role client, bypasses RLS, used only in clearly bounded routes (`/api/setup/status`, cron endpoints)

## Project layout

```
.
├── webapp/                      # the Next.js app + Docker stack
│   ├── src/
│   │   ├── app/                 # App Router pages + API routes
│   │   │   ├── api/             # /api/* endpoints (proxies, cron, internal)
│   │   │   ├── settings/        # Settings hub + 17 sub-pages
│   │   │   └── [feature]/       # Calendar, Shopping, Recipes, Energy, etc.
│   │   ├── components/
│   │   │   ├── ui/              # shadcn primitives
│   │   │   ├── widgets/         # Dashboard widgets
│   │   │   ├── home-assistant/  # HA entity cards + energy charts
│   │   │   └── …                # Shared components
│   │   ├── hooks/               # TanStack Query hooks + custom hooks
│   │   ├── stores/              # Zustand stores
│   │   ├── lib/
│   │   │   ├── supabase/        # Client / server / admin helpers
│   │   │   ├── german-holidays.ts
│   │   │   ├── shopping-categories.ts
│   │   │   ├── unsplash-defaults.ts
│   │   │   └── utils.ts         # Including monthly-theme logic
│   │   └── types/               # Database + HA + recipe types
│   ├── messages/                # next-intl bundles: en.json, de.json
│   └── docker/                  # docker-compose stack + helpers
│       ├── docker-compose.yml
│       ├── docker-compose.traefik.yml.example
│       ├── init.sql             # Schema + RLS policies
│       ├── seed-demo.sql        # Optional demo dataset
│       ├── start.sh             # up/down/logs/restart/migrate/seed-demo
│       ├── migrate-prod.sh      # Live-host upgrade helper
│       └── kong.yml             # Supabase API gateway config
├── kiosk/                       # Kiosk-side scripts (presence sensor)
├── tools/                       # Debugging / development helpers
├── docs/wiki/                   # This wiki
├── setup.sh                     # First-run bootstrap
├── README.md
├── LICENSE                      # MIT
└── …
```

## Settings storage

Per-family settings live in the `public.settings` table as `(family_id, key, value JSONB)`. The shape is intentionally loose — the app reads with `useSetting<T>("key", default)` and writes with `useUpdateSetting`. This avoids schema migrations for settings shape changes.

Full key-by-key catalog: [Database-Schema → Settings keys at a glance](Database-Schema#settings-keys-at-a-glance).

## API routes

All under `webapp/src/app/api/`. Highlights:

- `/api/setup/status` — public, returns `{ hasFamilies }`. Used by `/join` to detect fresh installs.
- `/api/google/*` — OAuth flow + sync ([Google-Calendar](Google-Calendar)).
- `/api/homeassistant/*` — HA REST proxy with the family's stored token ([Home-Assistant](Home-Assistant)).
- `/api/immich/*`, `/api/bring/*` — photo / shopping integration proxies.
- `/api/weather`, `/api/cities` — OpenWeatherMap proxies (server-side keeps the API key).
- `/api/cameras/*` — camera proxy (digest auth, snapshot caching).
- `/api/cameras/webrtc` — WebRTC SDP exchange with go2rtc.
- `/api/notifications/*` — web push subscription management.
- `/api/cron/*` — invoked by the Ofelia container; gated by `CRON_SECRET`.
- `/api/presence` — POST endpoint for the LD2410 sensor ([Presence-Sensor](Presence-Sensor)).

## Real-time invalidation

When any row in a watched table changes (insert / update / delete), Supabase Realtime emits an event over WebSocket. The `use-realtime.ts` hook listens, identifies the affected table, and calls `queryClient.invalidateQueries(...)` on the TanStack Query keys for that table. Components re-render with fresh data within ~100 ms of the DB write.

Tables published via the `supabase_realtime` PUBLICATION (see `init.sql`):

```
events, todos, shopping_items, subjects, schedules, birthdays, notes,
settings, recipes, recipe_ingredients, recipe_tags, meal_plans,
meal_plan_entries, item_catalog, push_subscriptions,
notification_preferences
```

## What's intentionally absent

- **No user accounts.** Identity is the device + family-code pair. See [Security-and-Threat-Model](Security-and-Threat-Model) for the rationale.
- **No tenancy beyond family.** Multi-family is a sharing model (one device joins multiple families) rather than an account hierarchy.
- **No ORM.** Direct Supabase queries via the typed client. Schema typing is generated by `npm run db:generate`.
- **No SSR data fetching outside API routes.** Pages are client-rendered; API routes do server-side work where needed.
- **No telemetry, no analytics, no error reporting.** Self-hosted means self-hosted.

## Where to next

- [Database-Schema](Database-Schema) — table-by-table reference
- [Self-hosting](Self-hosting) — production deployment specifics
- [Plugin-Authoring](Plugin-Authoring) — how niche integrations will be packaged in v1.1
