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

1. **All data is family-scoped.** A `family_id` UUID gates every row via [Row-Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security). See [Database schema](#database-schema) below.
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

## Database schema

Quick reference for the tables in `public`. The full source is `webapp/docker/init.sql`.

```
families  (id, name, join_code)
   │
   ├── devices              one row per joined device
   ├── people               family members (kids, parents)
   ├── calendars            local + Google-synced calendars
   │     └── events
   ├── todos
   ├── shopping_items
   │     └── item_catalog   per-family product memory
   ├── recipes
   │     ├── recipe_ingredients
   │     ├── recipe_tags + recipe_tag_assignments
   │     └── meal_plans → meal_plan_entries
   ├── subjects (school subjects)
   │     └── schedules     weekly per-person periods
   ├── birthdays
   ├── notes
   └── settings (key, value JSONB)
```

### RLS policies

Every table has a policy of the form:

```sql
CREATE POLICY "<table> belong to families" ON public.<table>
  FOR ALL
  USING (family_id IN (SELECT id FROM families WHERE join_code = current_setting('app.join_code', true)))
  WITH CHECK (family_id IN (SELECT id FROM families WHERE join_code = current_setting('app.join_code', true)));
```

The Next.js server sets the `app.join_code` GUC on each connection from the active family's join code (read from cookies). Without that GUC, RLS denies everything.

The `families` table itself has policies allowing `SELECT` for any client whose join code matches, and `INSERT` for everyone (so new families can be created via `/join`). The `devices` table allows `SELECT` / `UPDATE` / `DELETE` if `family_id` matches the active family, and `INSERT` for joining (no family-scope check on insert; the insert payload determines the family).

### Migrations

`webapp/docker/init.sql` runs **once**, on first DB init. Every schema change since ships as a `webapp/docker/migration*.sql` file, and migrations apply automatically on every `start.sh up` — each file uses `IF NOT EXISTS` / `IF EXISTS` guards so re-applying is a no-op. After running, the script restarts the `rest` (PostgREST) container so the schema cache reloads. See `webapp/docker/migration*.sql` for the current, always-up-to-date list; `./start.sh migrate` re-applies them by hand if you ever need to (rarely — `up` already does it).

### Typed access

Run after schema changes:

```bash
cd webapp
npm run db:generate
```

This regenerates `webapp/src/lib/database.types.ts` from a running local Supabase, consumed by the typed `createClient<Database>(...)` calls for autocomplete + type-checking. If you're not running Supabase CLI locally, hand-editing `database.types.ts` is fine — it's a plain TypeScript types file.

### Seeding demo data

```bash
cd webapp/docker
./start.sh seed-demo
```

Applies `seed-demo.sql`, which creates a "Demo Family" (join code `DEMO01`) with four locale-neutral people and 11 school subjects. Idempotent.

## Settings storage

Per-family settings live in the `public.settings` table as `(family_id, key, value JSONB)`. The shape is intentionally loose — the app reads with `useSetting<T>("key", default)` and writes with `useUpdateSetting`. This avoids schema migrations for settings shape changes.

### Settings keys at a glance

| Key | Shape (TypeScript-ish) | Where used |
|---|---|---|
| `theme` | `{ themeOverride: number? \| null, use24Hour: boolean, showSeconds: boolean }` | `/settings/theme` |
| `weather_location` | `{ type: "city" \| "coordinates", city?: string, lat?: number, lon?: number }` | `/settings/weather` |
| `widget_visibility` | `Record<WidgetKey, boolean>` | `/settings/widgets` |
| `screensaver` | `{ screensaverTimeout, presenceTimeout, presenceControlMode, photoRotationInterval }` | `/settings/screensaver` |
| `home_assistant` | `{ url, access_token, dashboards: Dashboard[], rooms: Room[] }` | `/settings/homeassistant` |
| `cameras` | `{ cameras: CameraConfig[] }` | `/settings/cameras` |
| `bring_settings` | `{ credentials, selectedListId, autoSync, twoWaySync, syncCategories }` | `/settings/bring` |
| `google_calendar` | `{ access_token, refresh_token, expiry_date, enabled_calendars[], mapping_rules[], auto_sync, last_sync, ... }` | `/settings/google` |
| `immich` | `{ url, api_key, selected_album }` | `/settings/photos` |
| `unsplash` | `{ access_key, monthly_terms }` | `/settings/photos` |
| `photo_source` | `{ source: "immich" \| "unsplash" }` | `/settings/photos` |
| `tesla` | per-entity ID mapping | `/settings/tesla` (plugin) |
| `energy` | per-entity ID mapping for solar/battery/grid | `/settings/homeassistant/energy` |
| `schedule_periods` | `PeriodConfig[]` | `/settings/schedule` |
| `schedule_pack_items` | `PackItemConfig[]` | `/settings/schedule` |
| `notification_preferences` | per-device push prefs | `/settings/notifications` |
| `settings_pin` | `string \| null` (4 digits) | `/settings` (PIN gate) |

The schema is intentionally not normalized into per-feature tables — settings shapes evolve faster than schema migrations are worth.

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

- [Self-hosting](Self-hosting) — production deployment specifics
- [Plugin-Development](Plugin-Development) — how niche integrations are packaged as plugins
