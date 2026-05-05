# Database schema

Quick reference for the tables in `public`. The full source is `webapp/docker/init.sql` — this page gives you a navigable overview.

## Top of the tree

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

## Settings keys at a glance

The `settings` table is a flexible JSONB store keyed by `(family_id, key)`. The expected keys + shapes:

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

## RLS policies

Every table has a policy of the form:

```sql
CREATE POLICY "<table> belong to families" ON public.<table>
  FOR ALL
  USING (family_id IN (SELECT id FROM families WHERE join_code = current_setting('app.join_code', true)))
  WITH CHECK (family_id IN (SELECT id FROM families WHERE join_code = current_setting('app.join_code', true)));
```

The Next.js server sets the `app.join_code` GUC on each connection from the active family's join code (read from cookies). Without that GUC, RLS denies everything.

The `families` table itself has policies allowing:

- `SELECT` for any client whose join code matches one of `families.join_code`
- `INSERT` for everyone (so new families can be created via `/join`)

The `devices` table allows:

- `SELECT` / `UPDATE` / `DELETE` if `family_id` matches the active family
- `INSERT` for joining (no family-scope check on insert; the insert payload determines the family)

## Realtime publication

The publication `supabase_realtime` adds tables that the Realtime service should broadcast on:

```sql
events, todos, shopping_items, subjects, schedules, birthdays, notes,
settings, recipes, recipe_ingredients, recipe_tags, meal_plans,
meal_plan_entries, item_catalog, push_subscriptions,
notification_preferences
```

To add a new table to realtime updates, append `ALTER PUBLICATION supabase_realtime ADD TABLE public.<your_table>;` to a new migration file.

## Migrations

`webapp/docker/init.sql` runs **once**, on first DB init. Subsequent schema changes go in `webapp/docker/migration*.sql` and are applied via:

```bash
cd webapp/docker
./start.sh migrate
```

Convention: each migration file uses `IF NOT EXISTS` / `IF EXISTS` so re-applying is a no-op. After running migrations, the script restarts the `rest` (PostgREST) container so the schema cache reloads.

The current shipped migrations:

| File | What |
|---|---|
| `migration.sql` | Catch-all from earlier schema evolution (kiosk mode, recipes, item_catalog, etc.) |
| `migration_calendar_is_holidays.sql` | Adds `calendars.is_holidays` flag |
| `migration_fingerprint.sql` | Adds `devices.hardware_id` for device recognition |
| `migration_server_notifications.sql` | Adds `scheduled_notifications` + `push_subscriptions` for server-side push |
| `migrations/add_kiosk_mode.sql` | Sub-folder migration (kiosk-mode flag on devices) |

## Typed access

Run after schema changes:

```bash
cd webapp
npm run db:generate
```

This regenerates `webapp/src/lib/database.types.ts` from a running local Supabase. The output is consumed by the typed `createClient<Database>(...)` calls so all queries get IDE autocomplete + type-checking.

If you're not running Supabase CLI locally, you can hand-edit `database.types.ts` for new fields — the file is a plain TypeScript types file.

## Seeding demo data

Optional, only if you want a populated dataset for development:

```bash
cd webapp/docker
./start.sh seed-demo
```

This applies `seed-demo.sql` which creates a "Demo Family" with join code `DEMO01`, four locale-neutral people (Alex, Sam, Riley, Jordan), and 11 school subjects. Idempotent.
