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
                                 │  one address per device:
                                 │  the LAN address, or the
                                 │  tunnel / Traefik name
                          ┌──────▼──────┐
                          │   Traefik   │  ← reverse proxy or tunnel,
                          │   (HTTPS)   │    optional
                          └──────┬──────┘
                                 │
                       ┌─────────▼──────────┐
                       │    Supabase Kong   │  the front door
                       │    (port 3001)     │
                       │                    │
                       │  /rest  /auth      │──────────────┐
                       │  /storage /realtime│              │
                       │  everything else ──┼──┐           │
                       └────────────────────┘  │           │
                                               │           │
                                     ┌─────────▼──────┐    │
                                     │  Next.js app   │    │
                                     │  (3000, inside │    │
                                     │   the stack)   │    │
                                     │  /pages        │    │
                                     │  /api/* routes │    │
                                     └───────┬────────┘    │
                                             │ server-side │ websocket
                                             │ via Kong    │
                                             │ (internal)  │
                                   ┌─────────▼─────────────▼──┐
                                   │       PostgreSQL         │
                                   │  + Realtime + Storage    │
                                   └──────────────────────────┘
```

Since 1.13 Kong is the front door ([RFC-018](https://github.com/svenger87/kinboard/blob/main/docs/rfc/018-same-origin-api.md)): the app and its API share one address, so the browser makes no cross-origin requests and a screen at home never leaves the house for data. Kong also keeps its own port, 8100, so an `API_EXTERNAL_URL` pointing there keeps working. An install with `KINBOARD_ENTRY=webapp` (including any behind Traefik that hasn't opted in) still has the older layout: the webapp answers on 3001 and the browser fetches data from `API_EXTERNAL_URL`. See [Self-hosting → How it works](Self-hosting#how-it-works).

## Frontend stack

- **Next.js 16** (React 19) with the **App Router**. Almost all pages are client components (`"use client"`) because the dashboard is interactive end-to-end.
- **shadcn/ui** primitives + **Tailwind CSS**. Components live in `webapp/src/components/ui/` (don't modify directly) and `webapp/src/components/` (project-specific).
- **TanStack Query** for server state (cached, background-refetched, optimistic updates). Hooks live in `webapp/src/hooks/`.
- **Zustand** for ephemeral client state — currently just `family-store.ts` for the active family + device.
- **next-intl** for i18n. Cookie-based locale switching, no `[locale]` URL prefix. EN/DE/FR shipped; see [Themes](Themes) for adding more.
- **Framer Motion** for the slide/fade transitions across pages.

## Data flow

1. **All data is family-scoped.** A `family_id` UUID column exists on every row. The browser reads and writes through PostgREST with a short-lived family-scoped token, and **row-level security** limits every query to that family; API routes establish the family from the device session and filter on it themselves. See [Row-Level Security](#row-level-security) below and [Security-and-Threat-Model](Security-and-Threat-Model) for the full threat model.
2. **Devices join families via 6-character join codes.** Stored in `families.join_code`. Auth model is "device fingerprint + join code" — see [Security-and-Threat-Model](Security-and-Threat-Model).
3. **Real-time updates** use Supabase Realtime (Postgres logical replication → WebSocket). The hook `use-realtime.ts` subscribes to a table and the relevant TanStack Query cache invalidates automatically.
4. **Server-side data access** uses the service-role client, `createAdminClient()` (`src/lib/supabase/server.ts`). It bypasses row-level security, so every API route and cron job establishes the family from the device session (or the integration token) first and filters on `family_id` itself. The anon-key `createClient()` in the same file is not used by any route: under RLS, with no family claim, it would read nothing.

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
│   │   │   ├── holidays/        # date-holidays adapter, regions, curated names
│   │   │   ├── shopping-categories.ts
│   │   │   ├── unsplash-defaults.ts
│   │   │   └── utils.ts         # Including monthly-theme logic
│   │   └── types/               # Database + HA + recipe types
│   ├── messages/                # next-intl bundles: en.json, de.json, fr.json
│   └── docker/                  # docker-compose stack + helpers
│       ├── docker-compose.yml
│       ├── docker-compose.traefik.yml.example
│       ├── init.sql                 # Base schema (RLS comes from migration_zz_row_level_security.sql)
│       ├── seed-demo.sql            # Optional demo dataset
│       ├── start.sh                 # up/down/logs/restart/migrate/seed-demo
│       ├── kinboard-self-update.sh  # Live-host upgrade helper (Diun webhook or by hand)
│       └── kong.yml                 # Supabase API gateway config
├── kiosk/                       # Kiosk-side scripts (presence sensor)
├── tools/                       # Debugging / development helpers
├── docs/wiki/                   # This wiki
├── setup.sh                     # First-run bootstrap
├── README.md
├── LICENSE                      # PolyForm Noncommercial 1.0.0
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

### Row-Level Security

The browser talks to PostgREST directly, so the Next.js API is not in that request path and can't police it. The database does. Row-level security is **on** for every family-scoped table (52 of the 59 tables in `public`), and every policy resolves the caller's family from a `family_id` claim on the request's JWT:

- **The anon key that ships in the browser bundle carries no `family_id`**, so on its own it reads nothing.
- **A device that has joined gets a family-scoped token** from `/api/session/token`, which is gated by the HttpOnly device-session cookie. The token is signed with the stack's JWT secret, lasts an hour, and the client refreshes it well before then, so a kiosk never needs attention (`src/lib/family-jwt.ts`, `src/lib/supabase/family-token.ts`).
- **The service role bypasses RLS.** Every API route and cron job uses it and establishes the family server-side, so RLS is the backstop for the direct-PostgREST path, not a replacement for the `family_id` filtering in the routes.

The policies live in `webapp/docker/migration_zz_row_level_security.sql`. It sorts after every other migration on purpose: it drops any policy that isn't one of its own family-scope policies, so a later migration that creates a policy is cleaned up instead of quietly widening access.

**Some tables only the server writes.** Row-level security limits a token to its own family, but within that family it would let any screen write anything, a child's wall panel included. Where a rule matters, the browser roles have no write privilege at all and the change goes through an API route that enforces it:

- `families`: no insert or delete from the browser (`migration_zzzzzz_families_server_only.sql`); creating and deleting a family go through `/api/family`.
- Pocket money, points, rewards and creatures: read-only from the browser (`migration_zzzzzzzz_pocket_money_server_only.sql` and the points/creatures migrations), so a balance, a purchase or a reward decision can't be written past the settings PIN.
- `settings`, `device_sessions`, `todo_occurrences` and `todo_events` are written only by the server too, and `devices` is created and changed only by it (a screen can still remove a device of its own family).

**The seven tables without RLS have no browser privileges at all**: `integration_tokens`, `integration_clients`, `integration_idempotency`, the two OAuth tables, `domain_events` and `system_heartbeats`. `integration_secrets` has RLS on *and* its privileges revoked. And no browser role holds `TRUNCATE` on anything (`migration_zzzz_revoke_truncate.sql`): it isn't a row operation, so no policy would stop it emptying a table for every family on the instance.

The join code is still the household's key: anyone who has it can join a device and get a token for that family. RLS stops the *public* key and other families from reaching your data; it does not make the join code less important. [Security-and-Threat-Model](Security-and-Threat-Model) covers what that means in practice.

### Soft delete

Nine tables — `birthdays`, `birthday_gift_ideas`, `notes`, `todos`, `subjects`, `meal_plan_entries`, `pocket_money_goals`, `recipes`, `people` — carry a `deleted_at timestamptz` and a `BEFORE DELETE` trigger that stamps it and returns `NULL`, cancelling the delete. `deleted_at IS NULL` is appended to each table's family-scope policy, so binned rows disappear from every read.

This is done in the database rather than the application on purpose: deletes do not go through API routes at all. Seventeen files call PostgREST `.delete()` straight from the browser and reads are just as direct, so rewriting every call site would have been both the larger change and the one where a single miss leaves a hole. Two database-level changes cover all of them.

Cancelling the delete also cancels its `ON DELETE CASCADE`, which is what makes a restore whole — a soft-deleted recipe keeps its ingredients, a soft-deleted person keeps their schedule and pocket-money account.

Purging is the inverse and needs every trigger to stand down at once, cascades included, so it runs through `purge_deleted(table, id)` and `purge_expired()`. Both set `kinboard.hard_delete` for their transaction. A plain `DELETE` on a binned row does get through, but its cascaded children hit their own triggers with `deleted_at` still `NULL`, survive, and are left pointing at a parent that no longer exists — Postgres does not re-check the constraint once a cascade is suppressed, so nothing complains.

`events` is deliberately out of scope: the syncers reconcile against the upstream calendar, and a soft-deleted event either returns on the next sync or fights it. `recipe_ingredients` and `recipe_tag_assignments` are out because editing a recipe deletes and re-inserts them, which would fill the bin on every save.

The migration is `migration_zzz_soft_delete.sql`, named to sort **after** `migration_zz_row_level_security.sql` — that one recreates every family-scope policy on each boot, so anything amending those policies has to run last. Retention lives in `settings` under `recycle_bin`; the nightly `purge-recycle-bin` job enforces it. User-facing docs: [Recycle-Bin](Recycle-Bin).

### Migrations

`webapp/docker/init.sql` runs **once**, on first DB init. Every schema change since ships as a `webapp/docker/migration*.sql` file, and each uses `IF NOT EXISTS` / `IF EXISTS` guards so re-applying is a no-op.

**The webapp container applies them, on every start**, from `webapp-entrypoint.sh` — one runner, deliberately. It works for deployments that never invoke `start.sh` (image-only, Watchtower, Diun), and it refuses to start the app if a migration fails rather than serving against a half-applied schema. It then issues `NOTIFY pgrst, 'reload schema'` so new columns are queryable without restarting PostgREST. `start.sh up` watches that log rather than applying anything itself: until 1.8.0 it applied the same files from the host *at the same time*, and the two runners collided (issue #152). See `webapp/docker/migration*.sql` for the current, always-up-to-date list; `./start.sh migrate` re-applies them by hand if you ever need to (rarely — `up` already does it).

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

`settings` is readable by every screen of the family (it's in the Realtime publication for live sync), so it's the wrong place for secrets. Since v1.4.0, integration credentials live in a separate server-only table instead — see [Integration credentials](#integration-credentials) below. The table here shows the non-secret shape as it exists today; fields marked *(secret, moved)* are no longer present under these keys.

### Settings keys at a glance

| Key | Shape (TypeScript-ish) | Where used |
|---|---|---|
| `theme` | `{ themeOverride: number? \| null, use24Hour: boolean, showSeconds: boolean }` — text size is per-device (`localStorage`), not part of this blob | `/settings/theme` |
| `weather_location` | `{ type: "city" \| "coordinates", city?: string, lat?: number, lon?: number }` | `/settings/weather` |
| `widget_visibility` | `Record<WidgetKey, boolean>` | `/settings/widgets` |
| `screensaver` | `{ screensaverTimeout, presenceTimeout, presenceControlMode, photoRotationInterval }` | `/settings/screensaver` |
| `home_assistant` | `{ url, dashboards: Dashboard[], rooms: Room[] }` — `access_token` is *(secret, moved)* | `/settings/homeassistant` |
| `cameras` | `{ cameras: CameraConfig[] }` | `/settings/cameras` |
| `bring_settings` | `{ selectedListId, autoSync, twoWaySync, syncCategories }` — `credentials` is *(secret, moved)* | `/settings/bring` |
| `google_calendar` | `{ enabled_calendars[], mapping_rules[], auto_sync, last_sync, expiry_date, ... }` — `access_token`/`refresh_token` are *(secret, moved)* | `/settings/google` |
| `immich` | `{ url, selected_album }` — `api_key` is *(secret, moved)* | `/settings/photos` |
| `unsplash` | `{ monthly_terms }` — `access_key` is *(secret, moved)* | `/settings/photos` |
| `photo_source` | `{ source: "immich" \| "unsplash" }` | `/settings/photos` |
| `tesla` | per-entity ID mapping | `/settings/tesla` (plugin) |
| `energy` | per-entity ID mapping for solar/battery/grid | `/settings/homeassistant/energy` |
| `schedule_periods` | `PeriodConfig[]` | `/settings/schedule` |
| `schedule_pack_items` | `PackItemConfig[]` | `/settings/schedule` |
| `notification_preferences` | per-device push prefs | `/settings/notifications` |
| `recycle_bin` | `{ retentionDays: number }` — 0 keeps deleted items forever | `/settings/recycle-bin` |
| `settings_pin` | *(secret, moved — no longer written under this key; see below)* | `/settings` (PIN gate) |

The schema is intentionally not normalized into per-feature tables — settings shapes evolve faster than schema migrations are worth.

### Integration credentials

OAuth tokens, API keys, and the settings PIN live in `public.integration_secrets` (`family_id, key, value JSONB`), added in v1.4.0 (`webapp/docker/migration_integration_secrets.sql`, `migration_pin_secret.sql`). Unlike `settings`, this table has `anon`/`authenticated` privileges revoked and is excluded from the Realtime publication — only the service-role client (`createAdminClient()`) can read it, so a browser on the LAN can no longer read another device's Google/Home Assistant/Immich/Bring tokens or the PIN via PostgREST. Settings pages that need to show "connected" state read a merged view (`getMergedSetting`) that overlays the secret on top of the public settings shape without ever sending the secret value itself to the browser — a PUT that includes the sentinel placeholder means "keep the stored secret unchanged." Existing installs migrate their previously-exposed values into this table automatically on upgrade. Full reasoning: [Security-and-Threat-Model → Integration credentials](Security-and-Threat-Model#integration-credentials).

CalDAV credentials are the one entry keyed per *object* rather than per integration: each connected calendar stores its username/password under `caldav:<calendar_id>`, because a family can have calendars on different servers with different logins. That dynamic key doesn't fit `SECRET_FIELDS`' static path filter in `lib/integration-secrets.ts`, so `lib/caldav-credentials.ts` writes the row directly with the service-role client. The storage guarantee is identical — the table is the same locked-down one — and no API response ever contains a CalDAV password, which is why changing one means re-entering it rather than round-tripping a sentinel.

## API routes

All under `webapp/src/app/api/`. Highlights:

- `/api/setup/status` — public, returns `{ hasFamilies }`. Used by `/join` to detect fresh installs.
- `/api/google/*` — OAuth flow + sync ([Google-Calendar](Google-Calendar)).
- `/api/caldav/*` — CalDAV discovery, calendar CRUD, and event write-through ([CalDAV](CalDAV)). Calendar rows go through the API rather than PostgREST because the password must land in `integration_secrets`.
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
